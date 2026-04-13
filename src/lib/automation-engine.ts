import { db } from '@/lib/db';
import type { AutomationAction, CrmAutomation } from '@/actions/automations';
import {
    ensurePipelineTagSchema,
    getDefaultPipelineStageValueForWorkspace,
} from '@/lib/crm-pipeline-server';
import { PIPELINE_STAGE_CATEGORY } from '@/lib/crm-pipeline';

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
        changed_fields?: Record<string, string>;
        contact_custom_fields?: Record<string, string>;
        actor_user_id?: string;
        actor_full_name?: string;
        [key: string]: any;
    };
}

type TriggerCustomFieldCondition = {
    field_id?: string;
    field_value?: string;
};

type ContactCustomFieldEntry = {
    id?: string;
    label?: string;
    value?: unknown;
};

function normalizeComparableValue(value: unknown): string {
    if (value === null || value === undefined) return '';
    return String(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_');
}

function valuesMatch(expected: unknown, actual: unknown): boolean {
    const expectedValue = String(expected ?? '');
    const actualValue = String(actual ?? '');
    if (expectedValue === actualValue) return true;
    return normalizeComparableValue(expectedValue) === normalizeComparableValue(actualValue);
}

function hasValue(value: unknown): boolean {
    return value !== null && value !== undefined && String(value).trim() !== '';
}

function toCustomFieldVariableBaseKey(label: unknown): string {
    if (label === null || label === undefined) return '';
    return String(label)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .replace(/_+/g, '_');
}

function toCustomFieldVariableKey(baseKey: string, fieldId: string, totalByBase: Record<string, number>): string {
    if (!baseKey) return '';
    if ((totalByBase[baseKey] || 0) <= 1) return baseKey;
    const shortId = fieldId.replace(/-/g, '').slice(0, 8).toLowerCase();
    return shortId ? `${baseKey}_${shortId}` : baseKey;
}

function buildContactCustomFieldVariableMap(entries: ContactCustomFieldEntry[]): Record<string, string> {
    const byBaseCount: Record<string, number> = {};
    for (const entry of entries) {
        const baseKey = toCustomFieldVariableBaseKey(entry.label);
        if (!baseKey) continue;
        byBaseCount[baseKey] = (byBaseCount[baseKey] || 0) + 1;
    }

    const map: Record<string, string> = {};
    for (const entry of entries) {
        const fieldId = String(entry.id || '');
        const value = entry.value === null || entry.value === undefined ? '' : String(entry.value);
        if (fieldId) {
            // Backward-compatible access: {{contact.custom_fields.<uuid>}}
            map[fieldId] = value;
        }

        const baseKey = toCustomFieldVariableBaseKey(entry.label);
        const variableKey = toCustomFieldVariableKey(baseKey, fieldId, byBaseCount);
        if (variableKey && !Object.prototype.hasOwnProperty.call(map, variableKey)) {
            // Friendly access by label-based key: {{contact.custom_fields.como_conheceu}}
            map[variableKey] = value;
        }
    }

    return map;
}

function extractCustomFieldConditions(config: Record<string, any>): {
    changedConditions: TriggerCustomFieldCondition[];
    stateConditions: TriggerCustomFieldCondition[];
} {
    const changedConditions = Array.isArray(config.changed_conditions)
        ? config.changed_conditions
        : config.field_id
            ? [{ field_id: config.field_id, field_value: config.field_value }]
            : [];

    const stateConditions = Array.isArray(config.state_conditions)
        ? config.state_conditions
        : [];

    return {
        changedConditions: changedConditions.filter((condition: TriggerCustomFieldCondition) => condition?.field_id),
        stateConditions: stateConditions.filter((condition: TriggerCustomFieldCondition) => condition?.field_id),
    };
}

async function loadContactCustomFields(event: AutomationEvent): Promise<Record<string, string>> {
    const fieldsFromEvent = event.data?.contact_custom_fields;
    if (fieldsFromEvent && typeof fieldsFromEvent === 'object') {
        return fieldsFromEvent;
    }

    const res = await db.query(
        'SELECT field_id, value FROM contact_custom_field_values WHERE contact_id = $1',
        [event.contactId]
    );
    return res.rows.reduce((acc: Record<string, string>, row: { field_id: string; value: string }) => {
        acc[row.field_id] = row.value;
        return acc;
    }, {});
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
            if (await matchesTrigger(automation, eventWithActor)) {
                console.log(`[AUTOMATION] Firing "${automation.name}" for contact ${eventWithActor.contactId}`);
                await executeActions(automation.actions, eventWithActor);
            }
        }
    } catch (error) {
        console.error('[AUTOMATION_ENGINE] Error evaluating:', error);
    }
}

// ─── Trigger Matching ───────────────────────────────────────────────────────

async function matchesTrigger(automation: CrmAutomation, event: AutomationEvent): Promise<boolean> {
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
            const { changedConditions, stateConditions } = extractCustomFieldConditions(config);
            const changedFields = event.data?.changed_fields || {};
            let contactCustomFieldsCache: Record<string, string> | null = null;
            const getContactCustomFields = async (): Promise<Record<string, string>> => {
                if (contactCustomFieldsCache) return contactCustomFieldsCache;
                contactCustomFieldsCache = await loadContactCustomFields(event);
                return contactCustomFieldsCache;
            };

            // "Quando fizer X e Y":
            // - at least one configured field must change in this event
            // - all configured values must be true in the current contact state
            if (changedConditions.length > 0) {
                let hasAnyConfiguredFieldChanged = false;
                const contactCustomFields = await getContactCustomFields();

                for (const condition of changedConditions) {
                    const fieldId = condition.field_id!;
                    const hasDirectChangedField = Object.prototype.hasOwnProperty.call(changedFields, fieldId);
                    const isLegacyChangedField = event.data?.custom_field_id === fieldId;
                    const hasChangedInThisEvent = hasDirectChangedField || isLegacyChangedField;

                    if (hasChangedInThisEvent) {
                        hasAnyConfiguredFieldChanged = true;
                    }

                    if (hasValue(condition.field_value)) {
                        const currentValue = contactCustomFields[fieldId];
                        if (!valuesMatch(condition.field_value, currentValue)) {
                            return false;
                        }
                    } else if (!hasChangedInThisEvent) {
                        return false;
                    }
                }

                if (!hasAnyConfiguredFieldChanged) return false;
            } else {
                // Legacy fallback (single field/value) when no new changed_conditions were configured.
                if (config.field_id) {
                    const hasDirectChangedField = Object.prototype.hasOwnProperty.call(changedFields, config.field_id);
                    const hasChangedInThisEvent = hasDirectChangedField || event.data?.custom_field_id === config.field_id;
                    if (!hasChangedInThisEvent) return false;

                    if (hasValue(config.field_value)) {
                        const contactCustomFields = await getContactCustomFields();
                        const currentValue = contactCustomFields[config.field_id];
                        if (!valuesMatch(config.field_value, currentValue)) {
                            return false;
                        }
                    }
                } else if (hasValue(config.field_value) && !valuesMatch(config.field_value, event.data?.new_value)) {
                    return false;
                }
            }

            // "E estiver X e Y": all configured state conditions must match current contact custom fields.
            if (stateConditions.length > 0) {
                const contactCustomFields = await getContactCustomFields();
                for (const condition of stateConditions) {
                    const fieldId = condition.field_id!;
                    const currentValue = contactCustomFields[fieldId];

                    if (hasValue(condition.field_value)) {
                        if (!valuesMatch(condition.field_value, currentValue)) return false;
                    } else if (!hasValue(currentValue)) {
                        return false;
                    }
                }
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

    return template.replace(/\{\{(contact|event|actor)\.([\w.-]+)\}\}/g, (match, root, path) => {
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
                           (SELECT json_agg(
                               json_build_object(
                                   'id', ccfv.field_id,
                                   'label', cfd.label,
                                   'value', ccfv.value
                               )
                           )
                            FROM contact_custom_field_values ccfv
                            LEFT JOIN custom_field_definitions cfd ON cfd.id = ccfv.field_id
                            WHERE ccfv.contact_id = c.id
                           ), '[]'
                       ) as custom_field_entries
                FROM contacts c
                LEFT JOIN users u ON c.owner_id = u.id
                WHERE c.id = $1
            `, [event.contactId]);
            fullContactData = contactRes.rows[0];
            const entries = Array.isArray(fullContactData?.custom_field_entries)
                ? (fullContactData.custom_field_entries as ContactCustomFieldEntry[])
                : [];
            fullContactData.custom_fields = buildContactCustomFieldVariableMap(entries);
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
    await ensurePipelineTagSchema();

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
            SELECT id FROM tags WHERE workspace_id = $2 AND category = $3
        )`,
        [event.contactId, event.workspaceId, PIPELINE_STAGE_CATEGORY]
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
    const stage = config.stage || await getDefaultPipelineStageValueForWorkspace(event.workspaceId);

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
