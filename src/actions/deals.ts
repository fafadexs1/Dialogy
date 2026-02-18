
'use server';

import { db } from '@/lib/db';
import type { Deal, DealMetrics } from '@/lib/types';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getAuthUser() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user;
}

// ─── READ ───────────────────────────────────────────────────────────────────

export async function getDeals(
    workspaceId: string,
    filters: { stage?: string; ownerId?: string; contactId?: string; won?: boolean | null } = {}
): Promise<{ deals: Deal[]; error?: string }> {
    const user = await getAuthUser();
    if (!user) return { deals: [], error: 'Não autenticado.' };

    try {
        let query = `
            SELECT d.*,
                   c.name as contact_name, c.avatar_url as contact_avatar,
                   u.full_name as owner_name
            FROM deals d
            LEFT JOIN contacts c ON c.id = d.contact_id
            LEFT JOIN users u ON u.id = d.owner_id
            WHERE d.workspace_id = $1
        `;
        const values: any[] = [workspaceId];
        let paramIdx = 2;

        if (filters.stage) {
            query += ` AND d.stage = $${paramIdx++}`;
            values.push(filters.stage);
        }
        if (filters.ownerId) {
            query += ` AND d.owner_id = $${paramIdx++}`;
            values.push(filters.ownerId);
        }
        if (filters.contactId) {
            query += ` AND d.contact_id = $${paramIdx++}`;
            values.push(filters.contactId);
        }
        if (filters.won !== undefined && filters.won !== null) {
            query += ` AND d.won = $${paramIdx++}`;
            values.push(filters.won);
        }

        query += ' ORDER BY d.created_at DESC';

        const res = await db.query(query, values);

        const deals: Deal[] = res.rows.map(row => ({
            ...row,
            value: parseFloat(row.value),
            contact: row.contact_name ? { id: row.contact_id, name: row.contact_name, avatar_url: row.contact_avatar } : undefined,
            owner: row.owner_name ? { id: row.owner_id, name: row.owner_name } : undefined,
        }));

        return { deals };
    } catch (error) {
        console.error('[GET_DEALS] Error:', error);
        return { deals: [], error: 'Falha ao buscar deals.' };
    }
}

export async function getDealsByContact(contactId: string): Promise<{ deals: Deal[]; error?: string }> {
    const user = await getAuthUser();
    if (!user) return { deals: [], error: 'Não autenticado.' };

    try {
        const res = await db.query(
            `SELECT d.*, u.full_name as owner_name
             FROM deals d
             LEFT JOIN users u ON u.id = d.owner_id
             WHERE d.contact_id = $1
             ORDER BY d.created_at DESC`,
            [contactId]
        );

        const deals: Deal[] = res.rows.map(row => ({
            ...row,
            value: parseFloat(row.value),
            owner: row.owner_name ? { id: row.owner_id, name: row.owner_name } : undefined,
        }));

        return { deals };
    } catch (error) {
        console.error('[GET_DEALS_BY_CONTACT] Error:', error);
        return { deals: [], error: 'Falha ao buscar deals do contato.' };
    }
}

// ─── WRITE ──────────────────────────────────────────────────────────────────

export async function createDeal(data: {
    workspace_id: string;
    contact_id: string;
    title: string;
    value: number;
    currency?: string;
    stage?: string;
    probability?: number;
    expected_close_date?: string | null;
    owner_id?: string | null;
    notes?: string | null;
}): Promise<{ deal: Deal | null; error?: string }> {
    const user = await getAuthUser();
    if (!user) return { deal: null, error: 'Não autenticado.' };

    try {
        const res = await db.query(
            `INSERT INTO deals (workspace_id, contact_id, title, value, currency, stage, probability, expected_close_date, owner_id, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING *`,
            [
                data.workspace_id,
                data.contact_id,
                data.title,
                data.value,
                data.currency || 'BRL',
                data.stage || 'novo',
                data.probability ?? 50,
                data.expected_close_date || null,
                data.owner_id || user.id,
                data.notes || null,
            ]
        );

        const deal = { ...res.rows[0], value: parseFloat(res.rows[0].value) };

        revalidatePath('/crm');
        return { deal };
    } catch (error) {
        console.error('[CREATE_DEAL] Error:', error);
        return { deal: null, error: 'Falha ao criar deal.' };
    }
}

export async function updateDeal(
    dealId: string,
    data: Partial<{
        title: string;
        value: number;
        currency: string;
        stage: string;
        probability: number;
        expected_close_date: string | null;
        won: boolean | null;
        closed_at: string | null;
        owner_id: string | null;
        notes: string | null;
    }>
): Promise<{ deal: Deal | null; error?: string }> {
    const user = await getAuthUser();
    if (!user) return { deal: null, error: 'Não autenticado.' };

    try {
        // If marking as won/lost, also set closed_at
        if (data.won !== undefined && data.won !== null && !data.closed_at) {
            data.closed_at = new Date().toISOString();
        }

        const setClauses: string[] = [];
        const values: any[] = [];
        let paramIdx = 1;

        for (const [key, val] of Object.entries(data)) {
            if (val !== undefined) {
                setClauses.push(`${key} = $${paramIdx++}`);
                values.push(val);
            }
        }

        if (setClauses.length === 0) {
            return { deal: null, error: 'Nenhuma alteração fornecida.' };
        }

        setClauses.push(`updated_at = NOW()`);
        values.push(dealId);

        const res = await db.query(
            `UPDATE deals SET ${setClauses.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
            values
        );

        if (res.rows.length === 0) {
            return { deal: null, error: 'Deal não encontrado.' };
        }

        const deal = { ...res.rows[0], value: parseFloat(res.rows[0].value) };

        revalidatePath('/crm');
        return { deal };
    } catch (error) {
        console.error('[UPDATE_DEAL] Error:', error);
        return { deal: null, error: 'Falha ao atualizar deal.' };
    }
}

export async function deleteDeal(dealId: string): Promise<{ success: boolean; error?: string }> {
    const user = await getAuthUser();
    if (!user) return { success: false, error: 'Não autenticado.' };

    try {
        await db.query('DELETE FROM deals WHERE id = $1', [dealId]);
        revalidatePath('/crm');
        return { success: true };
    } catch (error) {
        console.error('[DELETE_DEAL] Error:', error);
        return { success: false, error: 'Falha ao excluir deal.' };
    }
}

// ─── CLOSE / REOPEN ─────────────────────────────────────────────────────────

export async function closeDeal(
    dealId: string,
    won: boolean
): Promise<{ deal: Deal | null; error?: string }> {
    return updateDeal(dealId, {
        won,
        stage: won ? 'ganho' : 'perdido',
        closed_at: new Date().toISOString(),
    });
}

export async function reopenDeal(dealId: string): Promise<{ deal: Deal | null; error?: string }> {
    return updateDeal(dealId, {
        won: null,
        stage: 'negociacao',
        closed_at: null,
    });
}

// ─── METRICS ────────────────────────────────────────────────────────────────

export async function getDealMetrics(workspaceId: string): Promise<{ metrics: DealMetrics | null; error?: string }> {
    const user = await getAuthUser();
    if (!user) return { metrics: null, error: 'Não autenticado.' };

    try {
        // Run all aggregation queries in parallel
        const [pipelineRes, wonRes, stagesRes, cycleRes, trendsRes] = await Promise.all([
            // 1. Open pipeline totals
            db.query(
                `SELECT
                    COALESCE(SUM(value), 0) as total_pipeline,
                    COALESCE(SUM(value * probability / 100.0), 0) as weighted_pipeline
                 FROM deals
                 WHERE workspace_id = $1 AND won IS NULL`,
                [workspaceId]
            ),

            // 2. Won deals stats
            db.query(
                `SELECT
                    COUNT(*) as total_won,
                    COUNT(*) FILTER (WHERE won = false) as total_lost,
                    COALESCE(AVG(value) FILTER (WHERE won = true), 0) as avg_ticket,
                    COALESCE(SUM(value) FILTER (WHERE won = true), 0) as total_revenue
                 FROM deals
                 WHERE workspace_id = $1 AND won IS NOT NULL`,
                [workspaceId]
            ),

            // 3. Deals by stage
            db.query(
                `SELECT stage, COUNT(*) as count, COALESCE(SUM(value), 0) as total_value
                 FROM deals
                 WHERE workspace_id = $1 AND won IS NULL
                 GROUP BY stage
                 ORDER BY total_value DESC`,
                [workspaceId]
            ),

            // 4. Average cycle time (days from creation to close)
            db.query(
                `SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (closed_at - created_at)) / 86400), 0) as avg_days
                 FROM deals
                 WHERE workspace_id = $1 AND closed_at IS NOT NULL`,
                [workspaceId]
            ),

            // 5. Trends: last 7 days vs previous 7 days
            db.query(
                `SELECT
                    COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as new_current,
                    COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '14 days' AND created_at < NOW() - INTERVAL '7 days') as new_previous,
                    COUNT(*) FILTER (WHERE won = true AND closed_at >= NOW() - INTERVAL '7 days') as won_current,
                    COUNT(*) FILTER (WHERE won = true AND closed_at >= NOW() - INTERVAL '14 days' AND closed_at < NOW() - INTERVAL '7 days') as won_previous,
                    COALESCE(SUM(value) FILTER (WHERE won = true AND closed_at >= NOW() - INTERVAL '7 days'), 0) as rev_current,
                    COALESCE(SUM(value) FILTER (WHERE won = true AND closed_at >= NOW() - INTERVAL '14 days' AND closed_at < NOW() - INTERVAL '7 days'), 0) as rev_previous
                 FROM deals
                 WHERE workspace_id = $1`,
                [workspaceId]
            ),
        ]);

        const pipeline = pipelineRes.rows[0];
        const won = wonRes.rows[0];
        const trends = trendsRes.rows[0];
        const totalWon = parseInt(won.total_won) || 0;
        const totalLost = parseInt(won.total_lost) || 0;
        const totalDecided = totalWon + totalLost;

        function calcChange(current: number, previous: number): number {
            if (previous === 0) return current > 0 ? 100 : 0;
            return Math.round(((current - previous) / previous) * 100);
        }

        const metrics: DealMetrics = {
            totalPipelineValue: parseFloat(pipeline.total_pipeline),
            weightedPipelineValue: parseFloat(pipeline.weighted_pipeline),
            averageTicket: parseFloat(won.avg_ticket),
            winRate: totalDecided > 0 ? Math.round((totalWon / totalDecided) * 100) : 0,
            averageCycleTimeDays: Math.round(parseFloat(cycleRes.rows[0].avg_days)),
            dealsByStage: stagesRes.rows.map(r => ({
                stage: r.stage,
                count: parseInt(r.count),
                totalValue: parseFloat(r.total_value),
            })),
            trends: {
                newDeals: {
                    current: parseInt(trends.new_current),
                    previous: parseInt(trends.new_previous),
                    change: calcChange(parseInt(trends.new_current), parseInt(trends.new_previous)),
                },
                closedWon: {
                    current: parseInt(trends.won_current),
                    previous: parseInt(trends.won_previous),
                    change: calcChange(parseInt(trends.won_current), parseInt(trends.won_previous)),
                },
                revenue: {
                    current: parseFloat(trends.rev_current),
                    previous: parseFloat(trends.rev_previous),
                    change: calcChange(parseFloat(trends.rev_current), parseFloat(trends.rev_previous)),
                },
            },
        };

        return { metrics };
    } catch (error) {
        console.error('[GET_DEAL_METRICS] Error:', error);
        return { metrics: null, error: 'Falha ao buscar métricas.' };
    }
}

// ─── STAGE LOG ──────────────────────────────────────────────────────────────

export async function logStageChange(
    contactId: string,
    fromStage: string | null,
    toStage: string,
    changedBy?: string,
    workspaceId?: string
): Promise<void> {
    try {
        await db.query(
            `INSERT INTO contact_stage_log (contact_id, from_stage, to_stage, changed_by)
             VALUES ($1, $2, $3, $4)`,
            [contactId, fromStage, toStage, changedBy || null]
        );

        // Fire automations if workspaceId is provided
        if (workspaceId) {
            const { evaluateAutomations } = await import('@/lib/automation-engine');
            evaluateAutomations({
                type: 'stage_changed',
                contactId,
                workspaceId,
                data: { from_stage: fromStage || undefined, to_stage: toStage },
            }).catch(err => console.error('[AUTOMATION] Error in stage_changed trigger:', err));
        }
    } catch (error) {
        console.error('[LOG_STAGE_CHANGE] Error:', error);
    }
}

export async function getContactTimeline(contactId: string): Promise<{
    events: Array<{
        id: string;
        type: 'activity' | 'stage_change' | 'deal_created' | 'deal_closed' | 'chat';
        date: string;
        data: any;
    }>;
    error?: string;
}> {
    const user = await getAuthUser();
    if (!user) return { events: [], error: 'Não autenticado.' };

    try {
        // Fetch all event types in parallel
        const [activitiesRes, stageLogRes, dealsRes] = await Promise.all([
            db.query(
                `SELECT id, type, date, notes, user_id FROM activities WHERE contact_id = $1 ORDER BY date DESC LIMIT 50`,
                [contactId]
            ),
            db.query(
                `SELECT sl.id, sl.from_stage, sl.to_stage, sl.changed_at, u.full_name as changed_by_name
                 FROM contact_stage_log sl
                 LEFT JOIN users u ON u.id = sl.changed_by
                 WHERE sl.contact_id = $1
                 ORDER BY sl.changed_at DESC LIMIT 50`,
                [contactId]
            ),
            db.query(
                `SELECT id, title, value, stage, won, created_at, closed_at FROM deals WHERE contact_id = $1 ORDER BY created_at DESC LIMIT 20`,
                [contactId]
            ),
        ]);

        const events: any[] = [];

        for (const a of activitiesRes.rows) {
            events.push({
                id: a.id,
                type: 'activity',
                date: a.date,
                data: { activityType: a.type, notes: a.notes, userId: a.user_id },
            });
        }

        for (const sl of stageLogRes.rows) {
            events.push({
                id: sl.id,
                type: 'stage_change',
                date: sl.changed_at,
                data: { fromStage: sl.from_stage, toStage: sl.to_stage, changedByName: sl.changed_by_name },
            });
        }

        for (const d of dealsRes.rows) {
            events.push({
                id: `deal-created-${d.id}`,
                type: 'deal_created',
                date: d.created_at,
                data: { dealId: d.id, title: d.title, value: parseFloat(d.value), stage: d.stage },
            });
            if (d.closed_at) {
                events.push({
                    id: `deal-closed-${d.id}`,
                    type: 'deal_closed',
                    date: d.closed_at,
                    data: { dealId: d.id, title: d.title, value: parseFloat(d.value), won: d.won },
                });
            }
        }

        // Sort all events by date descending
        events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        return { events };
    } catch (error) {
        console.error('[GET_CONTACT_TIMELINE] Error:', error);
        return { events: [], error: 'Falha ao buscar timeline.' };
    }
}
