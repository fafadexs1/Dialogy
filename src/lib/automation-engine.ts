import { db } from '@/lib/db';
import type { AutomationAction, CrmAutomation } from '@/actions/automations';

// ─── Event Types ────────────────────────────────────────────────────────────

export interface AutomationEvent {
    type: 'stage_changed' | 'deal_created' | 'lead_score_above' | 'contact_created' | 'custom_field_changed';
    contactId: string;
    workspaceId: string;
    data?: {
        from_stage?: string;
        to_stage?: string;
        lead_score?: number;
        deal_id?: string;
        name?: string;
        phone?: string;
        custom_field_id?: string;
        new_value?: string;
        actor_user_id?: string;
        actor_full_name?: string;
        [key: string]: any;
    };
}

function normalizeComparableValue(value: unknown): string {
    if (value === null || value === undefined) return '';
    return String(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_');
}

function getValueByPath(source: any, path: string): unknown {
    if (!source) return undefined;
    const keys = path.split('.');
    let current: any = source;

    for (const key of keys) {
        if (current === null || current === undefined) {
            return undefined;
        }
        current = current[key];
    }

    return current;
}

async function enrichEventActor(event: AutomationEvent): Promise<AutomationEvent> {
    const actorUserId = event.data?.actor_user_id;
    if (!actorUserId) return event;

    try {
        const actorRes = await db.query(
            `SELECT full_name FROM users WHERE id = $1 LIMIT 1`,
            [actorUserId]
        );

        return {
            ...event,
            data: {
                ...event.data,
                actor_full_name: actorRes.rows[0]?.full_name || event.data?.actor_full_name || actorUserId,
            }
        };
    } catch (error) {
        console.error('[AUTOMATION] Failed to resolve event actor full_name:', error);
        return event;
    }
}

// ─── Engine ─────────────────────────────────────────────────────────────────

/**
 * Avalia todas as automações ativas do workspace que matcham o evento.
 * Executa as actions de cada automação que passa no filtro.
 */
export async function evaluateAutomations(event: AutomationEvent): Promise<void> {
    try {
        const eventWithActor = await enrichEventActor(event);

        const result = await db.query(
            `SELECT * FROM crm_automations WHERE workspace_id = $1 AND is_active = true AND trigger_type = $2`,
            [eventWithActor.workspaceId, eventWithActor.type]
        );

        const automations: CrmAutomation[] = result.rows;

        for (const automation of automations) {
            if (matchesTrigger(automation, eventWithActor)) {
                console.log(`[AUTOMATION] Firing "${automation.name}" for contact ${eventWithActor.contactId}`);
                await executeActions(automation.actions, eventWithActor);
            }
        }
    } catch (error) {
        console.error('[AUTOMATION_ENGINE] Error evaluating:', error);
    }
}

// ─── Trigger Matching ───────────────────────────────────────────────────────

function matchesTrigger(automation: CrmAutomation, event: AutomationEvent): boolean {
    const config = automation.trigger_config || {};

    switch (event.type) {
        case 'stage_changed': {
            if (config.from_stage && config.from_stage !== event.data?.from_stage) return false;
            if (config.to_stage && config.to_stage !== event.data?.to_stage) return false;
            return true;
        }
        case 'lead_score_above': {
            const threshold = config.threshold || 0;
            return (event.data?.lead_score || 0) >= threshold;
        }
        case 'custom_field_changed': {
            if (config.field_id && config.field_id !== event.data?.custom_field_id) return false;
            // Optionally check configured value, tolerating case/spacing differences (e.g. "NOVO" vs "novo")
            if (config.field_value) {
                const expectedValue = String(config.field_value);
                const actualValue = String(event.data?.new_value ?? '');
                const exactMatch = expectedValue === actualValue;
                const normalizedMatch = normalizeComparableValue(expectedValue) === normalizeComparableValue(actualValue);
                if (!exactMatch && !normalizedMatch) return false;
            }
            return true;
        }
        case 'deal_created':
        case 'contact_created':
            return true;
        default:
            return false;
    }
}

// ─── Variable Replacement ──────────────────────────────────────────────────

function replaceVariables(template: string, context: { contact?: any; event?: any; actor?: any }): string {
    if (!template) return template;

    return template.replace(/\{\{(contact|event|actor)\.([\w.]+)\}\}/g, (match, root, path) => {
        const source = root === 'contact'
            ? context.contact
            : root === 'event'
                ? context.event
                : context.actor;

        const resolved = getValueByPath(source, path);
        return resolved !== undefined && resolved !== null ? String(resolved) : '';
    });
}

// ─── Action Execution ───────────────────────────────────────────────────────

async function executeActions(actions: AutomationAction[], event: AutomationEvent): Promise<void> {
    // Optimization: Fetch full contact payload once if actions potentially need variables
    let fullContactData: any = null;
    const needsContactData = actions.some(a =>
        a.type === 'api_call' || a.type === 'send_notification'
    );

    if (needsContactData) {
        try {
            const contactRes = await db.query(`
                SELECT c.*, 
                       u.full_name as owner_name,
                       COALESCE(
                           (SELECT json_object_agg(ccfv.field_id, ccfv.value)
                            FROM contact_custom_field_values ccfv
                            WHERE ccfv.contact_id = c.id
                           ), '{}'
                       ) as custom_fields
                FROM contacts c
                LEFT JOIN users u ON c.owner_id = u.id
                WHERE c.id = $1
            `, [event.contactId]);
            fullContactData = contactRes.rows[0];
        } catch (e) {
            console.error('[AUTOMATION] Failed to fetch contact context for variables', e);
        }
    }

    const variableContext = {
        contact: fullContactData || {},
        event: event.data || {},
        actor: {
            user_id: event.data?.actor_user_id || '',
            full_name: event.data?.actor_full_name || '',
        },
    };

    for (const action of actions) {
        try {
            switch (action.type) {
                case 'move_to_stage':
                    await executeMoveTo(event, action.config);
                    break;
                case 'assign_owner':
                    await executeAssignOwner(event, action.config);
                    break;
                case 'create_deal':
                    await executeCreateDeal(event, action.config);
                    break;
                case 'update_custom_field':
                    await executeUpdateCustomField(event, action.config);
                    break;
                case 'api_call':
                    await executeApiCall(event, action.config, variableContext);
                    break;
                case 'send_notification':
                    // Notifications are client-side only — log for now
                    console.log(`[AUTOMATION] Notification: ${action.config.message || 'Automação disparada'} for contact ${event.contactId}`);
                    break;
            }
        } catch (error) {
            console.error(`[AUTOMATION] Error executing action ${action.type}:`, error);
        }
    }
}

async function executeMoveTo(event: AutomationEvent, config: Record<string, any>): Promise<void> {
    const targetStage = config.stage;
    if (!targetStage) return;

    // Find the tag for the target stage
    const tagRes = await db.query(
        `SELECT id FROM tags WHERE workspace_id = $1 AND value = $2 LIMIT 1`,
        [event.workspaceId, targetStage]
    );

    if (tagRes.rows.length === 0) return;
    const tagId = tagRes.rows[0].id;

    // Remove any existing stage tags and add the new one
    await db.query(
        `DELETE FROM contact_tags WHERE contact_id = $1 AND tag_id IN (
            SELECT id FROM tags WHERE workspace_id = $2 AND value IN ('novo', 'qualificado', 'proposta', 'negociacao', 'fechamento')
        )`,
        [event.contactId, event.workspaceId]
    );

    await db.query(
        `INSERT INTO contact_tags (contact_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [event.contactId, tagId]
    );

    // Log stage change
    await db.query(
        `INSERT INTO contact_stage_log (contact_id, from_stage, to_stage, changed_by)
         VALUES ($1, $2, $3, NULL)`,
        [event.contactId, event.data?.from_stage || event.data?.to_stage || null, targetStage]
    );
}

async function executeAssignOwner(event: AutomationEvent, config: Record<string, any>): Promise<void> {
    const ownerId = config.owner_id;
    if (!ownerId) return;

    await db.query(
        'UPDATE contacts SET owner_id = $1 WHERE id = $2',
        [ownerId, event.contactId]
    );
}

async function executeCreateDeal(event: AutomationEvent, config: Record<string, any>): Promise<void> {
    const title = config.title || 'Deal Automático';
    const value = config.value || 0;
    const stage = config.stage || 'novo';

    await db.query(
        `INSERT INTO deals (workspace_id, contact_id, title, value, stage)
         VALUES ($1, $2, $3, $4, $5)`,
        [event.workspaceId, event.contactId, title, value, stage]
    );
}

async function executeUpdateCustomField(event: AutomationEvent, config: Record<string, any>): Promise<void> {
    const fieldId = config.field_id;
    const fieldValue = config.field_value;

    if (!fieldId) return;

    await db.query(
        'DELETE FROM contact_custom_field_values WHERE contact_id = $1 AND field_id = $2',
        [event.contactId, fieldId]
    );

    if (fieldValue) {
        await db.query(
            'INSERT INTO contact_custom_field_values (contact_id, field_id, value) VALUES ($1, $2, $3)',
            [event.contactId, fieldId, fieldValue]
        );
    }
}

async function executeApiCall(
    event: AutomationEvent,
    config: Record<string, any>,
    variableContext: { contact?: any; event?: any; actor?: any }
): Promise<void> {
    const method = config.method || 'GET';
    const rawUrl = config.url;
    if (!rawUrl) return;

    const url = replaceVariables(rawUrl, variableContext);

    const headers: Record<string, string> = {
        'User-Agent': 'Dialogy-Automation/1.0',
    };

    if (Array.isArray(config.headers)) {
        for (const h of config.headers) {
            if (h.key && h.value) {
                headers[h.key] = replaceVariables(h.value, variableContext);
            }
        }
    }

    let requestBody: any = undefined;
    const bodyType = config.bodyType || 'json';

    if (method !== 'GET') {
        if (bodyType === 'json') {
            headers['Content-Type'] = headers['Content-Type'] || 'application/json';
            const rawPayload = config.payload || '{}';
            requestBody = replaceVariables(rawPayload, variableContext);
        } else if (bodyType === 'form-data') {
            headers['Content-Type'] = headers['Content-Type'] || 'application/x-www-form-urlencoded';
            const params = new URLSearchParams();
            if (Array.isArray(config.formData)) {
                for (const d of config.formData) {
                    if (d.key && d.value) {
                        params.append(d.key, replaceVariables(d.value, variableContext));
                    }
                }
            }
            requestBody = params.toString();
        }
    }

    try {
        console.log(`[API_CALL] Executing ${method} to ${url}`);
        const response = await fetch(url, {
            method,
            headers,
            body: requestBody,
        });

        if (!response.ok) {
            console.warn(`[API_CALL] Webhook returned status ${response.status} for ${url}`);
        } else {
            console.log(`[API_CALL] Webhook successful for ${url}`);
        }
    } catch (e) {
        console.error(`[API_CALL] Network error executing webhook for ${url}:`, e);
    }
}
