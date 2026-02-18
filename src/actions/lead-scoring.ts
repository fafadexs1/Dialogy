'use server';

import { db } from '@/lib/db';
import { createClient } from '@/lib/supabase/server';

// ─── SCORE CALCULATION ──────────────────────────────────────────────────────

/**
 * Calcula o lead score de um contato individual (0-100).
 * Critérios:
 * - Completude do perfil (email, telefone, owner)
 * - Deals abertos e valor total
 * - Atividade recente (7d / 30d)
 * - Estágio avançado no funil
 */
export async function calculateLeadScore(contactId: string): Promise<{ score: number; error?: string }> {
    try {
        const result = await db.query(`
            WITH contact_data AS (
                SELECT
                    c.id,
                    c.workspace_id,
                    c.email,
                    c.phone_number_jid,
                    c.owner_id,
                    c.created_at
                FROM contacts c
                WHERE c.id = $1
            ),
            deal_data AS (
                SELECT
                    COUNT(*) FILTER (WHERE won IS NULL) AS open_deals,
                    COALESCE(SUM(value) FILTER (WHERE won IS NULL), 0) AS total_open_value,
                    COUNT(*) FILTER (WHERE won = true) AS won_deals
                FROM deals
                WHERE contact_id = $1
            ),
            activity_data AS (
                SELECT
                    COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') AS recent_7d,
                    COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') AS recent_30d
                FROM activities
                WHERE contact_id = $1
            ),
            stage_data AS (
                SELECT to_stage
                FROM contact_stage_log
                WHERE contact_id = $1
                ORDER BY changed_at DESC
                LIMIT 1
            ),
            chat_data AS (
                SELECT
                    COUNT(*) FILTER (WHERE ch.updated_at > NOW() - INTERVAL '7 days') AS chats_7d,
                    COUNT(*) FILTER (WHERE ch.updated_at > NOW() - INTERVAL '30 days') AS chats_30d
                FROM chats ch
                WHERE ch.contact_id = $1
            )
            SELECT
                cd.*,
                dd.open_deals,
                dd.total_open_value,
                dd.won_deals,
                COALESCE(ad.recent_7d, 0) AS activities_7d,
                COALESCE(ad.recent_30d, 0) AS activities_30d,
                sd.to_stage AS current_stage,
                COALESCE(cht.chats_7d, 0) AS chats_7d,
                COALESCE(cht.chats_30d, 0) AS chats_30d
            FROM contact_data cd
            LEFT JOIN deal_data dd ON true
            LEFT JOIN activity_data ad ON true
            LEFT JOIN stage_data sd ON true
            LEFT JOIN chat_data cht ON true
        `, [contactId]);

        if (result.rows.length === 0) {
            return { score: 0, error: 'Contato não encontrado.' };
        }

        const row = result.rows[0];
        let score = 0;

        // ── Profile Completeness (max 25) ──
        if (row.email) score += 10;
        if (row.phone_number_jid) score += 10;
        if (row.owner_id) score += 5;

        // ── Deal Activity (max 30) ──
        const openDeals = parseInt(row.open_deals) || 0;
        score += Math.min(openDeals * 10, 30);

        // ── Deal Value Bonus (max 10) ──
        const totalValue = parseFloat(row.total_open_value) || 0;
        if (totalValue >= 1000) score += 10;
        else if (totalValue >= 500) score += 5;

        // ── Won Deals Bonus (max 5) ──
        const wonDeals = parseInt(row.won_deals) || 0;
        if (wonDeals > 0) score += 5;

        // ── Recent Activity (max 15) ──
        const activities7d = parseInt(row.activities_7d) || 0;
        const chats7d = parseInt(row.chats_7d) || 0;
        const activities30d = parseInt(row.activities_30d) || 0;
        const chats30d = parseInt(row.chats_30d) || 0;

        if (activities7d > 0 || chats7d > 0) {
            score += 15;
        } else if (activities30d > 0 || chats30d > 0) {
            score += 10;
        }

        // ── Funnel Stage (max 10) ──
        const advancedStages = ['proposta', 'negociacao', 'negociação', 'fechamento', 'contrato'];
        const midStages = ['qualificado', 'qualificacao', 'qualificação', 'reuniao', 'reunião'];
        const currentStage = (row.current_stage || '').toLowerCase();

        if (advancedStages.includes(currentStage)) {
            score += 10;
        } else if (midStages.includes(currentStage)) {
            score += 5;
        }

        // Clamp 0-100
        score = Math.min(Math.max(score, 0), 100);

        // Persist
        await db.query(
            'UPDATE contacts SET lead_score = $1, lead_score_updated_at = NOW() WHERE id = $2',
            [score, contactId]
        );

        return { score };
    } catch (error) {
        console.error('[LEAD_SCORING] Error calculating score:', error);
        return { score: 0, error: 'Falha ao calcular score.' };
    }
}

// ─── BATCH RECALCULATION ────────────────────────────────────────────────────

/**
 * Recalcula o score de todos os contatos de um workspace.
 * Usa uma query batch eficiente com subqueries.
 */
export async function recalculateWorkspaceScores(workspaceId: string): Promise<{ updated: number; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { updated: 0, error: 'Não autenticado.' };

    try {
        const result = await db.query(`
            WITH score_calc AS (
                SELECT
                    c.id,
                    (
                        -- Profile completeness (max 25)
                        CASE WHEN c.email IS NOT NULL AND c.email != '' THEN 10 ELSE 0 END +
                        CASE WHEN c.phone_number_jid IS NOT NULL AND c.phone_number_jid != '' THEN 10 ELSE 0 END +
                        CASE WHEN c.owner_id IS NOT NULL THEN 5 ELSE 0 END +

                        -- Deal activity (max 30)
                        LEAST(COALESCE(d.open_deals, 0) * 10, 30) +

                        -- Deal value bonus (max 10)
                        CASE
                            WHEN COALESCE(d.total_value, 0) >= 1000 THEN 10
                            WHEN COALESCE(d.total_value, 0) >= 500 THEN 5
                            ELSE 0
                        END +

                        -- Won deals bonus (max 5)
                        CASE WHEN COALESCE(d.won_deals, 0) > 0 THEN 5 ELSE 0 END +

                        -- Recent activity (max 15)
                        CASE
                            WHEN COALESCE(a.recent_7d, 0) > 0 OR COALESCE(ch.chats_7d, 0) > 0 THEN 15
                            WHEN COALESCE(a.recent_30d, 0) > 0 OR COALESCE(ch.chats_30d, 0) > 0 THEN 10
                            ELSE 0
                        END +

                        -- Stage bonus (max 10)
                        CASE
                            WHEN LOWER(COALESCE(sl.to_stage, '')) IN ('proposta', 'negociacao', 'negociação', 'fechamento', 'contrato') THEN 10
                            WHEN LOWER(COALESCE(sl.to_stage, '')) IN ('qualificado', 'qualificacao', 'qualificação', 'reuniao', 'reunião') THEN 5
                            ELSE 0
                        END
                    ) AS calculated_score
                FROM contacts c
                LEFT JOIN LATERAL (
                    SELECT
                        open_deals, total_value, won_deals
                    FROM (
                        SELECT
                            COUNT(*) FILTER (WHERE won IS NULL) AS open_deals,
                            COALESCE(SUM(value) FILTER (WHERE won IS NULL), 0) AS total_value,
                            COUNT(*) FILTER (WHERE won = true) AS won_deals
                        FROM deals WHERE contact_id = c.id
                    ) sub
                ) d ON true
                LEFT JOIN LATERAL (
                    SELECT
                        recent_7d, recent_30d
                    FROM (
                        SELECT
                            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') AS recent_7d,
                            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') AS recent_30d
                        FROM activities WHERE contact_id = c.id
                    ) sub
                ) a ON true
                LEFT JOIN LATERAL (
                    SELECT to_stage
                    FROM contact_stage_log
                    WHERE contact_id = c.id
                    ORDER BY changed_at DESC
                    LIMIT 1
                ) sl ON true
                LEFT JOIN LATERAL (
                    SELECT
                        chats_7d, chats_30d
                    FROM (
                        SELECT
                            COUNT(*) FILTER (WHERE updated_at > NOW() - INTERVAL '7 days') AS chats_7d,
                            COUNT(*) FILTER (WHERE updated_at > NOW() - INTERVAL '30 days') AS chats_30d
                        FROM chats WHERE contact_id = c.id
                    ) sub
                ) ch ON true
                WHERE c.workspace_id = $1
            )
            UPDATE contacts
            SET lead_score = LEAST(score_calc.calculated_score, 100),
                lead_score_updated_at = NOW()
            FROM score_calc
            WHERE contacts.id = score_calc.id
        `, [workspaceId]);

        return { updated: result.rowCount || 0 };
    } catch (error) {
        console.error('[LEAD_SCORING] Batch recalculation error:', error);
        return { updated: 0, error: 'Falha ao recalcular scores.' };
    }
}
