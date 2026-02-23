'use server';

import { db } from '@/lib/db';
import { createClient } from '@/lib/supabase/server';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AutomationTriggerConfig {
    from_stage?: string;
    to_stage?: string;
    threshold?: number;
    field_id?: string;
    field_value?: string;
}

export interface AutomationAction {
    type: 'move_to_stage' | 'assign_owner' | 'create_deal' | 'send_notification' | 'update_custom_field' | 'api_call';
    config: Record<string, any>;
}

export interface CrmAutomation {
    id: string;
    workspace_id: string;
    name: string;
    trigger_type: 'stage_changed' | 'deal_created' | 'lead_score_above' | 'contact_created' | 'custom_field_changed';
    trigger_config: AutomationTriggerConfig;
    actions: AutomationAction[];
    is_active: boolean;
    created_at: string;
    updated_at: string;
}

// ─── READ ───────────────────────────────────────────────────────────────────

export async function getAutomations(workspaceId: string): Promise<{ automations: CrmAutomation[]; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { automations: [], error: 'Não autenticado.' };

    try {
        const result = await db.query(
            'SELECT * FROM crm_automations WHERE workspace_id = $1 ORDER BY created_at DESC',
            [workspaceId]
        );
        return { automations: result.rows };
    } catch (error) {
        console.error('[AUTOMATIONS] Error fetching:', error);
        return { automations: [], error: 'Falha ao buscar automações.' };
    }
}

// ─── CREATE ─────────────────────────────────────────────────────────────────

export async function createAutomation(data: {
    workspace_id: string;
    name: string;
    trigger_type: string;
    trigger_config: AutomationTriggerConfig;
    actions: AutomationAction[];
}): Promise<{ automation: CrmAutomation | null; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { automation: null, error: 'Não autenticado.' };

    try {
        const result = await db.query(
            `INSERT INTO crm_automations (workspace_id, name, trigger_type, trigger_config, actions)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [data.workspace_id, data.name, data.trigger_type, JSON.stringify(data.trigger_config), JSON.stringify(data.actions)]
        );
        return { automation: result.rows[0] };
    } catch (error) {
        console.error('[AUTOMATIONS] Error creating:', error);
        return { automation: null, error: 'Falha ao criar automação.' };
    }
}

// ─── UPDATE ─────────────────────────────────────────────────────────────────

export async function updateAutomation(
    automationId: string,
    data: Partial<{
        name: string;
        trigger_type: string;
        trigger_config: AutomationTriggerConfig;
        actions: AutomationAction[];
        is_active: boolean;
    }>
): Promise<{ automation: CrmAutomation | null; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { automation: null, error: 'Não autenticado.' };

    try {
        const sets: string[] = [];
        const values: any[] = [];
        let idx = 1;

        if (data.name !== undefined) { sets.push(`name = $${idx++}`); values.push(data.name); }
        if (data.trigger_type !== undefined) { sets.push(`trigger_type = $${idx++}`); values.push(data.trigger_type); }
        if (data.trigger_config !== undefined) { sets.push(`trigger_config = $${idx++}`); values.push(JSON.stringify(data.trigger_config)); }
        if (data.actions !== undefined) { sets.push(`actions = $${idx++}`); values.push(JSON.stringify(data.actions)); }
        if (data.is_active !== undefined) { sets.push(`is_active = $${idx++}`); values.push(data.is_active); }

        sets.push(`updated_at = NOW()`);
        values.push(automationId);

        const result = await db.query(
            `UPDATE crm_automations SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
            values
        );
        return { automation: result.rows[0] || null };
    } catch (error) {
        console.error('[AUTOMATIONS] Error updating:', error);
        return { automation: null, error: 'Falha ao atualizar automação.' };
    }
}

// ─── DELETE ─────────────────────────────────────────────────────────────────

export async function deleteAutomation(automationId: string): Promise<{ success: boolean; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Não autenticado.' };

    try {
        await db.query('DELETE FROM crm_automations WHERE id = $1', [automationId]);
        return { success: true };
    } catch (error) {
        console.error('[AUTOMATIONS] Error deleting:', error);
        return { success: false, error: 'Falha ao excluir automação.' };
    }
}

// ─── TOGGLE ─────────────────────────────────────────────────────────────────

export async function toggleAutomation(automationId: string): Promise<{ automation: CrmAutomation | null; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { automation: null, error: 'Não autenticado.' };

    try {
        const result = await db.query(
            `UPDATE crm_automations SET is_active = NOT is_active, updated_at = NOW() WHERE id = $1 RETURNING *`,
            [automationId]
        );
        return { automation: result.rows[0] || null };
    } catch (error) {
        console.error('[AUTOMATIONS] Error toggling:', error);
        return { automation: null, error: 'Falha ao alternar automação.' };
    }
}
