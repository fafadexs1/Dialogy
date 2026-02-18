import { db } from '@/lib/db';
import type { AutomationAction, CrmAutomation } from '@/actions/automations';

// ─── Event Types ────────────────────────────────────────────────────────────

export interface AutomationEvent {
    type: 'stage_changed' | 'deal_created' | 'lead_score_above' | 'contact_created';
    contactId: string;
    workspaceId: string;
    data?: {
        from_stage?: string;
        to_stage?: string;
        lead_score?: number;
        deal_id?: string;
        name?: string;
        phone?: string;
        [key: string]: any;
    };
}

// ─── Engine ─────────────────────────────────────────────────────────────────

/**
 * Avalia todas as automações ativas do workspace que matcham o evento.
 * Executa as actions de cada automação que passa no filtro.
 */
export async function evaluateAutomations(event: AutomationEvent): Promise<void> {
    try {
        const result = await db.query(
            `SELECT * FROM crm_automations WHERE workspace_id = $1 AND is_active = true AND trigger_type = $2`,
            [event.workspaceId, event.type]
        );

        const automations: CrmAutomation[] = result.rows;

        for (const automation of automations) {
            if (matchesTrigger(automation, event)) {
                console.log(`[AUTOMATION] Firing "${automation.name}" for contact ${event.contactId}`);
                await executeActions(automation.actions, event);
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
        case 'deal_created':
        case 'contact_created':
            return true;
        default:
            return false;
    }
}

// ─── Action Execution ───────────────────────────────────────────────────────

async function executeActions(actions: AutomationAction[], event: AutomationEvent): Promise<void> {
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
