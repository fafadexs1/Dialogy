'use server';

import { db } from '@/lib/db';
import {
    getAnalyticsChannelColor,
    normalizeAnalyticsChannel,
    type AnalyticsChannelName,
} from '@/lib/analytics-channels';
import type { AnalyticsData, AgentPerformance, User } from '@/lib/types';
import { createClient } from '@/lib/supabase/server';
import type { ConversionCounterMode, ConversionMetrics, ConversionSettings } from '@/lib/types';
import { hasWorkspacePermission } from '@/lib/workspace-permissions';

type AnalyticsFilters = { teamId?: string; agentId?: string };

const UUID_REGEX_SQL = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

function optionalUuid(value: string | undefined): string | null {
    return value || null;
}

function toNumber(value: unknown): number {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

function formatSeconds(value: unknown): string {
    const seconds = Math.max(0, Math.floor(toNumber(value)));
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function parseJsonArray<T>(value: unknown): T[] {
    if (Array.isArray(value)) return value as T[];
    if (typeof value !== 'string') return [];

    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed as T[] : [];
    } catch (_error) {
        return [];
    }
}

function normalizeConversionCounterMode(mode: unknown): ConversionCounterMode {
    return mode === 'unique_converted_contacts' ? 'unique_converted_contacts' : 'won_deals';
}

async function ensureConversionSchema(): Promise<void> {
    // Applied by Prisma migration before runtime.
}

async function hasWorkspaceAccess(userId: string, workspaceId: string): Promise<boolean> {
    return hasWorkspacePermission(userId, workspaceId, 'analytics:view');
}

export async function getAnalyticsData(
    workspaceId: string,
    filters: AnalyticsFilters,
    dateRange: { from: string, to: string }
): Promise<AnalyticsData | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    try {
        if (!await hasWorkspaceAccess(user.id, workspaceId)) {
            return null;
        }

        const analyticsRes = await db.query(
            `
            WITH filtered_agents AS MATERIALIZED (
                SELECT u.id
                FROM users u
                JOIN user_workspace_roles uwr ON uwr.user_id = u.id
                WHERE uwr.workspace_id = $1
                  AND ($4::uuid IS NULL OR u.id = $4::uuid)
                  AND (
                    $5::uuid IS NULL
                    OR EXISTS (
                        SELECT 1
                        FROM team_members tm
                        WHERE tm.user_id = u.id
                          AND tm.team_id = $5::uuid
                    )
                  )
            ),
            active_chat_ids AS MATERIALIZED (
                SELECT c.id
                FROM chats c
                WHERE c.workspace_id = $1
                  AND c.created_at BETWEEN $2 AND $3
                UNION
                SELECT m.chat_id AS id
                FROM messages m
                WHERE m.workspace_id = $1
                  AND m.created_at BETWEEN $2 AND $3
            ),
            scoped_chat_ids AS MATERIALIZED (
                SELECT ac.id
                FROM active_chat_ids ac
                JOIN chats c ON c.id = ac.id
                WHERE c.workspace_id = $1
                  AND (
                    ($4::uuid IS NULL AND $5::uuid IS NULL)
                    OR (
                        c.status <> 'encerrados'
                        AND c.agent_id IN (SELECT id FROM filtered_agents)
                    )
                    OR EXISTS (
                        SELECT 1
                        FROM messages involvement_m
                        WHERE involvement_m.workspace_id = $1
                          AND involvement_m.chat_id = c.id
                          AND involvement_m.created_at BETWEEN $2 AND $3
                          AND (
                            (
                                involvement_m.sender_user_id IN (SELECT id FROM filtered_agents)
                                AND involvement_m.from_me = TRUE
                                AND COALESCE(involvement_m.type, '') <> 'system'
                                AND COALESCE(involvement_m.api_message_status, '') <> 'internal'
                            )
                            OR (
                                CASE
                                    WHEN involvement_m.metadata->>'to_agent_id' ~* $6
                                    THEN (involvement_m.metadata->>'to_agent_id')::uuid
                                END
                            ) IN (SELECT id FROM filtered_agents)
                            OR (
                                CASE
                                    WHEN involvement_m.metadata->>'closed_by' ~* $6
                                    THEN (involvement_m.metadata->>'closed_by')::uuid
                                END
                            ) IN (SELECT id FROM filtered_agents)
                          )
                    )
                  )
            ),
            scoped_chats AS MATERIALIZED (
                SELECT c.*
                FROM chats c
                JOIN scoped_chat_ids sci ON sci.id = c.id
            ),
            scoped_messages AS MATERIALIZED (
                SELECT m.*
                FROM messages m
                JOIN scoped_chat_ids sci ON sci.id = m.chat_id
                WHERE m.workspace_id = $1
                  AND m.created_at BETWEEN $2 AND $3
            ),
            resolved_chat_ids AS MATERIALIZED (
                SELECT sc.id
                FROM scoped_chats sc
                WHERE ($4::uuid IS NULL AND $5::uuid IS NULL)
                  AND sc.status = 'encerrados'
                  AND sc.closed_at BETWEEN $2 AND $3

                UNION

                SELECT close_events.chat_id
                FROM (
                    SELECT
                        CASE
                            WHEN m.metadata->>'closed_by' ~* $6
                            THEN (m.metadata->>'closed_by')::uuid
                        END AS closed_by,
                        m.chat_id
                    FROM messages m
                    JOIN scoped_chat_ids sci ON sci.id = m.chat_id
                    WHERE m.workspace_id = $1
                      AND m.created_at BETWEEN $2 AND $3
                      AND m.metadata->>'event' = 'close'
                ) close_events
                WHERE ($4::uuid IS NOT NULL OR $5::uuid IS NOT NULL)
                  AND close_events.closed_by IN (SELECT id FROM filtered_agents)

                UNION

                SELECT sc.id
                FROM scoped_chats sc
                WHERE ($4::uuid IS NOT NULL OR $5::uuid IS NOT NULL)
                  AND sc.status = 'encerrados'
                  AND sc.closed_at BETWEEN $2 AND $3
                  AND sc.agent_id IN (SELECT id FROM filtered_agents)
            ),
            response_times AS MATERIALIZED (
                SELECT EXTRACT(EPOCH FROM (ordered_messages.next_created_at - ordered_messages.created_at)) AS seconds
                FROM (
                    SELECT
                        sm.chat_id,
                        sm.created_at,
                        sm.from_me,
                        LEAD(sm.created_at) OVER (PARTITION BY sm.chat_id ORDER BY sm.created_at, sm.id) AS next_created_at,
                        LEAD(sm.from_me) OVER (PARTITION BY sm.chat_id ORDER BY sm.created_at, sm.id) AS next_from_me,
                        LEAD(sm.sender_user_id) OVER (PARTITION BY sm.chat_id ORDER BY sm.created_at, sm.id) AS next_sender_user_id,
                        LEAD(sm.type) OVER (PARTITION BY sm.chat_id ORDER BY sm.created_at, sm.id) AS next_type,
                        LEAD(sm.api_message_status) OVER (PARTITION BY sm.chat_id ORDER BY sm.created_at, sm.id) AS next_api_message_status
                    FROM scoped_messages sm
                ) ordered_messages
                WHERE ordered_messages.from_me = FALSE
                  AND ordered_messages.next_from_me = TRUE
                  AND ordered_messages.next_sender_user_id IS NOT NULL
                  AND COALESCE(ordered_messages.next_type, '') <> 'system'
                  AND COALESCE(ordered_messages.next_api_message_status, '') <> 'internal'
                  AND (
                    ($4::uuid IS NULL AND $5::uuid IS NULL)
                    OR ordered_messages.next_sender_user_id IN (SELECT id FROM filtered_agents)
                  )
            ),
            conversations_by_hour AS (
                SELECT
                    EXTRACT(HOUR FROM COALESCE(first_activity.first_activity_at, sc.created_at))::int AS hour,
                    COUNT(*)::int AS count
                FROM scoped_chats sc
                LEFT JOIN LATERAL (
                    SELECT MIN(m.created_at) AS first_activity_at
                    FROM messages m
                    WHERE m.chat_id = sc.id
                      AND m.created_at BETWEEN $2 AND $3
                ) first_activity ON TRUE
                GROUP BY 1
            ),
            channel_counts AS (
                SELECT
                    COALESCE(
                        NULLIF(meta_conversation_platform.platform_signal, 'unknown'),
                        NULLIF(meta_contact_platform.platform_signal, 'unknown'),
                        CASE
                            WHEN ct.phone_number_jid ILIKE '%@s.whatsapp.net'
                              OR ct.phone_number_jid ILIKE '%@g.us'
                              OR ct.phone_number_jid ILIKE '%@lid'
                            THEN 'whatsapp'
                            ELSE NULL
                        END,
                        NULLIF(last_platform.platform_signal, 'unknown'),
                        NULLIF(LOWER(NULLIF(to_jsonb(sc)->>'source', '')), 'unknown'),
                        NULLIF(LOWER(NULLIF(to_jsonb(sc)->>'instance_type', '')), 'unknown'),
                        'unknown'
                    ) AS channel_signal,
                    COUNT(*)::int AS count
                FROM scoped_chats sc
                LEFT JOIN contacts ct ON sc.contact_id = ct.id
                LEFT JOIN LATERAL (
                    SELECT LOWER(mc.platform::text) AS platform_signal
                    FROM meta_conversations mc
                    WHERE mc.chat_id = sc.id
                    ORDER BY mc.last_message_at DESC NULLS LAST, mc.updated_at DESC NULLS LAST, mc.created_at DESC NULLS LAST
                    LIMIT 1
                ) meta_conversation_platform ON TRUE
                LEFT JOIN LATERAL (
                    SELECT LOWER(COALESCE(
                        NULLIF(m.platform::text, ''),
                        NULLIF(m.source_from_api, ''),
                        NULLIF(m.instance_name, '')
                    )) AS platform_signal
                    FROM messages m
                    WHERE m.chat_id = sc.id
                      AND COALESCE(
                        NULLIF(m.platform::text, ''),
                        NULLIF(m.source_from_api, ''),
                        NULLIF(m.instance_name, '')
                      ) IS NOT NULL
                    ORDER BY m.created_at DESC
                    LIMIT 1
                ) last_platform ON TRUE
                LEFT JOIN LATERAL (
                    SELECT LOWER(mch.type::text) AS platform_signal
                    FROM meta_contacts mct
                    JOIN meta_channels mch ON mch.id = mct.channel_id
                    WHERE mct.contact_id = sc.contact_id
                    ORDER BY mct.created_at DESC
                    LIMIT 1
                ) meta_contact_platform ON TRUE
                GROUP BY 1
            )
            SELECT
                (SELECT COUNT(*)::int FROM scoped_chats) AS total_conversations,
                (SELECT COUNT(*)::int FROM contacts WHERE workspace_id = $1 AND created_at BETWEEN $2 AND $3) AS new_contacts,
                (SELECT COUNT(*)::int FROM resolved_chat_ids) AS resolved_conversations,
                (SELECT COUNT(*)::int FROM scoped_chats WHERE status <> 'encerrados') AS open_conversations,
                (
                    SELECT COUNT(*)::int
                    FROM scoped_chats
                    WHERE assigned_system_agent_id IS NOT NULL
                       OR COALESCE(is_autopilot_active, FALSE) = TRUE
                ) AS automation_conversations,
                (SELECT COUNT(*)::int FROM scoped_messages) AS total_messages,
                (SELECT COUNT(*)::int FROM scoped_messages WHERE from_me = FALSE) AS customer_messages,
                (SELECT COUNT(*)::int FROM scoped_messages WHERE from_me = TRUE) AS agent_messages,
                COALESCE(
                    (SELECT COUNT(*)::numeric FROM scoped_messages)
                    / NULLIF((SELECT COUNT(*)::numeric FROM scoped_chats), 0),
                    0
                ) AS avg_messages_per_conversation,
                (SELECT AVG(seconds) FROM response_times) AS avg_response_seconds,
                COALESCE(
                    (
                        SELECT jsonb_agg(jsonb_build_object('hour', hour, 'count', count) ORDER BY hour)
                        FROM conversations_by_hour
                    ),
                    '[]'::jsonb
                ) AS conversations_by_hour,
                COALESCE(
                    (
                        SELECT jsonb_agg(jsonb_build_object('channel_signal', channel_signal, 'count', count) ORDER BY count DESC)
                        FROM channel_counts
                    ),
                    '[]'::jsonb
                ) AS conversations_by_channel
            `,
            [
                workspaceId,
                dateRange.from,
                dateRange.to,
                optionalUuid(filters.agentId),
                optionalUuid(filters.teamId),
                UUID_REGEX_SQL,
            ]
        );

        const row = analyticsRes.rows[0] || {};
        const totalConversations = toNumber(row.total_conversations);
        const resolvedCount = toNumber(row.resolved_conversations);
        const firstContactResolutionRate = totalConversations > 0 ? (resolvedCount / totalConversations) * 100 : 0;

        const channelRows = parseJsonArray<{ channel_signal: string | null; count: number | string }>(row.conversations_by_channel);
        const channelTotals = channelRows.reduce<Map<AnalyticsChannelName, number>>((acc, channel) => {
                const name = normalizeAnalyticsChannel(channel.channel_signal);
                const current = acc.get(name) || 0;
                acc.set(name, current + toNumber(channel.count));
                return acc;
            }, new Map<AnalyticsChannelName, number>());

        const conversationsByChannel: AnalyticsData['conversationsByChannel'] = [...channelTotals.entries()]
            .map(([name, value]) => ({
                name,
                value,
                color: getAnalyticsChannelColor(name)
            }))
            .sort((a, b) => b.value - a.value);

        return {
            totalConversations,
            newContacts: toNumber(row.new_contacts),
            avgFirstResponseTime: formatSeconds(row.avg_response_seconds),
            firstContactResolutionRate,
            resolvedConversations: resolvedCount,
            openConversations: toNumber(row.open_conversations),
            automationConversations: toNumber(row.automation_conversations),
            totalMessages: toNumber(row.total_messages),
            customerMessages: toNumber(row.customer_messages),
            agentMessages: toNumber(row.agent_messages),
            avgMessagesPerConversation: toNumber(row.avg_messages_per_conversation),
            conversationsByHour: parseJsonArray<{ hour: number | string; count: number | string }>(row.conversations_by_hour)
                .map((item) => ({ hour: `${item.hour}h`, count: toNumber(item.count) })),
            conversationsByChannel
        };
    } catch (error) {
        console.error("[GET_ANALYTICS_DATA] Error:", error);
        return null;
    }
}

export async function getConversionSettings(workspaceId: string): Promise<{ settings: ConversionSettings | null; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { settings: null, error: "Usuário não autenticado." };

    try {
        if (!await hasWorkspaceAccess(user.id, workspaceId)) {
            return { settings: null, error: "Acesso não autorizado." };
        }

        const res = await db.query(
            `
            SELECT COALESCE(to_jsonb(w)->>'conversion_counter_mode', 'won_deals') AS conversion_counter_mode
            FROM workspaces w
            WHERE w.id = $1
            `,
            [workspaceId]
        );

        if ((res.rowCount || 0) === 0) {
            return { settings: { counterMode: 'won_deals' } };
        }

        return {
            settings: {
                counterMode: normalizeConversionCounterMode(res.rows[0].conversion_counter_mode),
            }
        };
    } catch (error) {
        console.error('[GET_CONVERSION_SETTINGS] Error:', error);
        return { settings: null, error: "Falha ao buscar configuração de conversão." };
    }
}

export async function updateConversionSettings(
    workspaceId: string,
    counterMode: ConversionCounterMode
): Promise<{ success: boolean; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Usuário não autenticado." };

    try {
        if (!await hasWorkspaceAccess(user.id, workspaceId)) {
            return { success: false, error: "Acesso não autorizado." };
        }

        await ensureConversionSchema();

        const res = await db.query(
            `UPDATE workspaces SET conversion_counter_mode = $1 WHERE id = $2`,
            [normalizeConversionCounterMode(counterMode), workspaceId]
        );
        if ((res.rowCount || 0) === 0) {
            return { success: false, error: "Workspace não encontrado." };
        }

        return { success: true };
    } catch (error) {
        console.error('[UPDATE_CONVERSION_SETTINGS] Error:', error);
        return { success: false, error: "Falha ao salvar configuração de conversão." };
    }
}

export async function getConversionMetrics(
    workspaceId: string,
    filters: { teamId?: string; agentId?: string },
    dateRange: { from: string; to: string },
    counterMode?: ConversionCounterMode
): Promise<ConversionMetrics | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    try {
        if (!await hasWorkspaceAccess(user.id, workspaceId)) {
            return null;
        }
        await ensureConversionSchema();

        const workspaceRes = await db.query(
            `
            SELECT
                COALESCE(to_jsonb(w)->>'conversion_counter_mode', 'won_deals') AS conversion_counter_mode,
                COALESCE(to_jsonb(w)->>'conversion_custom_field_id', '') AS conversion_custom_field_id,
                COALESCE(to_jsonb(w)->>'conversion_custom_field_value', '') AS conversion_custom_field_value
            FROM workspaces w
            WHERE w.id = $1
            `,
            [workspaceId]
        );

        const workspaceRow = workspaceRes.rows[0] || {};
        const mode = normalizeConversionCounterMode(counterMode || workspaceRow.conversion_counter_mode);
        const conversionFieldId = String(workspaceRow.conversion_custom_field_id || '');
        const conversionFieldValue = String(workspaceRow.conversion_custom_field_value || '').trim();

        const dealParams: Array<string> = [workspaceId, dateRange.from, dateRange.to];
        const dealWhereClauses = [
            `d.workspace_id = $1`,
            `d.won = true`,
            `d.closed_at BETWEEN $2 AND $3`,
        ];

        if (filters.agentId) {
            dealWhereClauses.push(`d.owner_id = $${dealParams.length + 1}`);
            dealParams.push(filters.agentId);
        } else if (filters.teamId) {
            dealWhereClauses.push(
                `EXISTS (
                    SELECT 1
                    FROM team_members tm
                    WHERE tm.user_id = d.owner_id
                      AND tm.team_id = $${dealParams.length + 1}
                )`
            );
            dealParams.push(filters.teamId);
        }

        const dealsRes = await db.query(
            `
            SELECT
                COUNT(*)::int AS won_deals,
                COUNT(DISTINCT d.contact_id)::int AS converted_contacts_from_deals,
                COALESCE(SUM(d.value), 0)::numeric AS total_revenue,
                MAX(d.closed_at) AS last_conversion_at_from_deals
            FROM deals d
            WHERE ${dealWhereClauses.join(' AND ')}
            `,
            dealParams
        );

        const dealsRow = dealsRes.rows[0] || {};
        const wonDeals = Number(dealsRow.won_deals || 0);
        let convertedContacts = Number(dealsRow.converted_contacts_from_deals || 0);
        let lastConversionAt = dealsRow.last_conversion_at_from_deals || null;

        if (conversionFieldId) {
            const contactParams: Array<string> = [workspaceId, dateRange.from, dateRange.to, conversionFieldId];
            const contactWhereClauses = [
                `c.workspace_id = $1`,
                `c.converted_at BETWEEN $2 AND $3`,
                `cfv.field_id = $4`,
            ];

            if (conversionFieldValue) {
                contactWhereClauses.push(`LOWER(TRIM(cfv.value)) = LOWER(TRIM($${contactParams.length + 1}))`);
                contactParams.push(conversionFieldValue);
            } else {
                contactWhereClauses.push(`NULLIF(TRIM(cfv.value), '') IS NOT NULL`);
            }

            if (filters.agentId) {
                contactWhereClauses.push(`c.owner_id = $${contactParams.length + 1}`);
                contactParams.push(filters.agentId);
            } else if (filters.teamId) {
                contactWhereClauses.push(
                    `EXISTS (
                        SELECT 1
                        FROM team_members tm
                        WHERE tm.user_id = c.owner_id
                          AND tm.team_id = $${contactParams.length + 1}
                    )`
                );
                contactParams.push(filters.teamId);
            }

            const contactsRes = await db.query(
                `
                SELECT
                    COUNT(DISTINCT c.id)::int AS converted_contacts,
                    MAX(c.converted_at) AS last_conversion_at
                FROM contacts c
                JOIN contact_custom_field_values cfv ON cfv.contact_id = c.id
                WHERE ${contactWhereClauses.join(' AND ')}
                `,
                contactParams
            );

            convertedContacts = Number(contactsRes.rows[0]?.converted_contacts || 0);
            lastConversionAt = contactsRes.rows[0]?.last_conversion_at || null;
        }

        return {
            counterMode: mode,
            counterValue: mode === 'unique_converted_contacts' ? convertedContacts : wonDeals,
            wonDeals,
            convertedContacts,
            totalRevenue: Number(dealsRow.total_revenue || 0),
            lastConversionAt,
        };
    } catch (error) {
        console.error('[GET_CONVERSION_METRICS] Error:', error);
        return null;
    }
}

export async function getAgentPerformance(
    workspaceId: string,
    filters: AnalyticsFilters,
    dateRange: { from: string, to: string }
): Promise<AgentPerformance[] | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    try {
        if (!await hasWorkspaceAccess(user.id, workspaceId)) {
            return null;
        }

        const query = `
            WITH active_chat_ids AS MATERIALIZED (
                SELECT c.id
                FROM chats c
                WHERE c.workspace_id = $1
                  AND c.created_at BETWEEN $2 AND $3
                UNION
                SELECT m.chat_id AS id
                FROM messages m
                WHERE m.workspace_id = $1
                  AND m.created_at BETWEEN $2 AND $3
            ),
            period_messages AS MATERIALIZED (
                SELECT m.*
                FROM messages m
                JOIN active_chat_ids ac ON ac.id = m.chat_id
                WHERE m.workspace_id = $1
                  AND m.created_at BETWEEN $2 AND $3
            ),
            agent_activity AS MATERIALIZED (
                SELECT m.sender_user_id AS agent_id, m.chat_id
                FROM period_messages m
                WHERE m.from_me = TRUE
                  AND m.sender_user_id IS NOT NULL
                  AND COALESCE(m.type, '') <> 'system'
                  AND COALESCE(m.api_message_status, '') <> 'internal'

                UNION

                SELECT m.sender_user_id AS agent_id, m.chat_id
                FROM period_messages m
                WHERE m.sender_user_id IS NOT NULL
                  AND m.type = 'system'
                  AND (
                    m.content ILIKE 'Atendimento iniciado por%'
                    OR m.content ILIKE 'Atendimento reaberto por%'
                    OR m.content ILIKE 'Atendimento reassumido por%'
                  )

                UNION

                SELECT transfer_events.agent_id, transfer_events.chat_id
                FROM (
                    SELECT
                        CASE
                            WHEN m.metadata->>'to_agent_id' ~* $6
                            THEN (m.metadata->>'to_agent_id')::uuid
                        END AS agent_id,
                        m.chat_id
                    FROM period_messages m
                    WHERE m.metadata->>'event' = 'transfer'
                ) transfer_events
                WHERE transfer_events.agent_id IS NOT NULL

                UNION

                SELECT close_events.agent_id, close_events.chat_id
                FROM (
                    SELECT
                        CASE
                            WHEN m.metadata->>'closed_by' ~* $6
                            THEN (m.metadata->>'closed_by')::uuid
                        END AS agent_id,
                        m.chat_id
                    FROM period_messages m
                    WHERE m.metadata->>'event' = 'close'
                ) close_events
                WHERE close_events.agent_id IS NOT NULL

                UNION

                SELECT c.agent_id, c.id AS chat_id
                FROM chats c
                WHERE c.workspace_id = $1
                  AND c.agent_id IS NOT NULL
                  AND c.assigned_at BETWEEN $2 AND $3

                UNION

                SELECT c.agent_id, c.id AS chat_id
                FROM chats c
                JOIN active_chat_ids ac ON ac.id = c.id
                WHERE c.workspace_id = $1
                  AND c.status <> 'encerrados'
                  AND c.agent_id IS NOT NULL
            ),
            resolved_activity AS MATERIALIZED (
                SELECT close_events.agent_id, close_events.chat_id
                FROM (
                    SELECT
                        CASE
                            WHEN m.metadata->>'closed_by' ~* $6
                            THEN (m.metadata->>'closed_by')::uuid
                        END AS agent_id,
                        m.chat_id
                    FROM period_messages m
                    WHERE m.metadata->>'event' = 'close'
                ) close_events
                WHERE close_events.agent_id IS NOT NULL

                UNION

                SELECT c.agent_id, c.id AS chat_id
                FROM chats c
                WHERE c.workspace_id = $1
                  AND c.agent_id IS NOT NULL
                  AND c.status = 'encerrados'
                  AND c.closed_at BETWEEN $2 AND $3
            ),
            response_times AS MATERIALIZED (
                SELECT
                    ordered_messages.next_sender_user_id AS agent_id,
                    EXTRACT(EPOCH FROM (ordered_messages.next_created_at - ordered_messages.created_at)) AS seconds
                FROM (
                    SELECT
                        pm.chat_id,
                        pm.created_at,
                        pm.from_me,
                        LEAD(pm.created_at) OVER (PARTITION BY pm.chat_id ORDER BY pm.created_at, pm.id) AS next_created_at,
                        LEAD(pm.from_me) OVER (PARTITION BY pm.chat_id ORDER BY pm.created_at, pm.id) AS next_from_me,
                        LEAD(pm.sender_user_id) OVER (PARTITION BY pm.chat_id ORDER BY pm.created_at, pm.id) AS next_sender_user_id,
                        LEAD(pm.type) OVER (PARTITION BY pm.chat_id ORDER BY pm.created_at, pm.id) AS next_type,
                        LEAD(pm.api_message_status) OVER (PARTITION BY pm.chat_id ORDER BY pm.created_at, pm.id) AS next_api_message_status
                    FROM period_messages pm
                ) ordered_messages
                WHERE ordered_messages.from_me = FALSE
                  AND ordered_messages.next_from_me = TRUE
                  AND ordered_messages.next_sender_user_id IS NOT NULL
                  AND COALESCE(ordered_messages.next_type, '') <> 'system'
                  AND COALESCE(ordered_messages.next_api_message_status, '') <> 'internal'
            ),
            agent_stats AS (
                SELECT
                    aa.agent_id,
                    COUNT(DISTINCT aa.chat_id)::int AS total_chats
                FROM agent_activity aa
                GROUP BY aa.agent_id
            ),
            resolved_stats AS (
                SELECT
                    ra.agent_id,
                    COUNT(DISTINCT ra.chat_id)::int AS resolved_chats
                FROM resolved_activity ra
                GROUP BY ra.agent_id
            ),
            response_stats AS (
                SELECT
                    rt.agent_id,
                    AVG(rt.seconds) AS avg_response_seconds
                FROM response_times rt
                GROUP BY rt.agent_id
            )
            SELECT
                u.id AS agent_id,
                u.full_name AS agent_name,
                u.avatar_url,
                COALESCE(ast.total_chats, 0) as total_chats,
                COALESCE(rs.resolved_chats, 0) as resolved_chats,
                rts.avg_response_seconds
            FROM users u
            JOIN user_workspace_roles uwr ON uwr.user_id = u.id AND uwr.workspace_id = $1
            LEFT JOIN agent_stats ast ON u.id = ast.agent_id
            LEFT JOIN resolved_stats rs ON u.id = rs.agent_id
            LEFT JOIN response_stats rts ON u.id = rts.agent_id
            WHERE ($4::uuid IS NULL OR EXISTS (
                    SELECT 1
                    FROM team_members tm
                    WHERE tm.user_id = u.id
                      AND tm.team_id = $4::uuid
                ))
              AND ($5::uuid IS NULL OR u.id = $5::uuid)
              AND (ast.total_chats > 0 OR rts.avg_response_seconds IS NOT NULL)
            ORDER BY total_chats DESC, u.full_name ASC;
        `;

        const res = await db.query(query, [
            workspaceId,
            dateRange.from,
            dateRange.to,
            optionalUuid(filters.teamId),
            optionalUuid(filters.agentId),
            UUID_REGEX_SQL,
        ]);

        const performanceData: AgentPerformance[] = res.rows.map(row => {
            return {
                agent_id: row.agent_id,
                agent_name: row.agent_name,
                avatar_url: row.avatar_url,
                total_chats: toNumber(row.total_chats),
                resolved_chats: toNumber(row.resolved_chats),
                avg_first_response_time: formatSeconds(row.avg_response_seconds),
                avg_rating: null,
            };
        });

        return performanceData;

    } catch (error) {
        console.error("[GET_AGENT_PERFORMANCE] Error:", error);
        return null;
    }
}

export async function getWorkspaceMembers(workspaceId: string, teamId?: string): Promise<{ members: User[] | null, error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { members: null, error: "Usuário não autenticado." };

    try {
        let query = `
            SELECT u.id, u.full_name as name, u.avatar_url, tm.team_id
            FROM users u
            JOIN user_workspace_roles uwr ON u.id = uwr.user_id
            LEFT JOIN team_members tm ON u.id = tm.user_id
            WHERE uwr.workspace_id = $1
        `;
        const params = [workspaceId];

        if (teamId) {
            query += ` AND tm.team_id = $2`
            params.push(teamId);
        }

        query += ` ORDER BY u.full_name`;

        const res = await db.query(query, params);
        return { members: res.rows };
    } catch (error) {
        console.error("[GET_WORKSPACE_USERS_ANALYTICS] Error:", error);
        return { members: null, error: "Falha ao buscar usuários do workspace." };
    }
}
