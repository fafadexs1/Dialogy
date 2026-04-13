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

// Helper to add agent and team filters to a query
const addFilters = (
    query: string,
    baseParams: any[],
    { teamId, agentId }: { teamId?: string; agentId?: string }
): [string, any[]] => {
    let newQuery = query;
    const newParams = [...baseParams];
    let whereConditions: string[] = [];

    // Check if the base query already has a WHERE clause
    // We need to be careful about where to insert the new conditions
    // If there is a GROUP BY or ORDER BY, we must insert before them.

    const upperQuery = newQuery.toUpperCase();
    const groupByIndex = upperQuery.indexOf(' GROUP BY ');
    const orderByIndex = upperQuery.indexOf(' ORDER BY ');

    let insertionPoint = newQuery.length;
    if (groupByIndex !== -1) {
        insertionPoint = groupByIndex;
    } else if (orderByIndex !== -1 && (groupByIndex === -1 || orderByIndex < groupByIndex)) {
        insertionPoint = orderByIndex;
    }

    const queryBeforeInsertion = newQuery.substring(0, insertionPoint);
    const queryAfterInsertion = newQuery.substring(insertionPoint);

    const hasWhere = queryBeforeInsertion.toUpperCase().includes(' WHERE ');
    const whereOrAnd = hasWhere ? ' AND ' : ' WHERE ';

    if (agentId) {
        whereConditions.push(`c.agent_id = $${newParams.length + 1}`);
        newParams.push(agentId);
    } else if (teamId) {
        // If filtering by team, we need to join with team_members if not already joined
        // We check queryBeforeInsertion for existing joins

        // We will handle the JOIN injection during reconstruction if needed
        whereConditions.push(`tm.team_id = $${newParams.length + 1}`);
        newParams.push(teamId);
    }

    // Re-construct the query
    let finalQueryBefore = queryBeforeInsertion;

    if (teamId) {
        if (!finalQueryBefore.toUpperCase().includes('JOIN TEAM_MEMBERS')) {
            if (finalQueryBefore.includes('FROM chats c')) {
                finalQueryBefore = finalQueryBefore.replace('FROM chats c', 'FROM chats c JOIN team_members tm ON c.agent_id = tm.user_id');
            } else if (finalQueryBefore.includes('FROM FirstMessages')) {
                // For the CTE, we need to be careful. 
                // The CTE usually selects from messages m JOIN chats c.
                // So we can join team_members on c.agent_id
                if (finalQueryBefore.includes('JOIN chats c ON m.chat_id = c.id')) {
                    finalQueryBefore = finalQueryBefore.replace('JOIN chats c ON m.chat_id = c.id', 'JOIN chats c ON m.chat_id = c.id JOIN team_members tm ON c.agent_id = tm.user_id');
                }
            } else if (finalQueryBefore.includes('JOIN chats c ON m.chat_id = c.id')) {
                // Handle the CTE case where chats is joined but FROM FirstMessages is not in the before part
                finalQueryBefore = finalQueryBefore.replace('JOIN chats c ON m.chat_id = c.id', 'JOIN chats c ON m.chat_id = c.id JOIN team_members tm ON c.agent_id = tm.user_id');
            }
        }
    }

    if (whereConditions.length > 0) {
        finalQueryBefore += whereOrAnd + whereConditions.join(' AND ');
    }

    return [finalQueryBefore + queryAfterInsertion, newParams];
};

function normalizeConversionCounterMode(mode: unknown): ConversionCounterMode {
    return mode === 'unique_converted_contacts' ? 'unique_converted_contacts' : 'won_deals';
}

let conversionSchemaEnsured = false;
async function ensureConversionSchema(): Promise<void> {
    if (conversionSchemaEnsured) return;
    await db.query(`ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS conversion_counter_mode text NOT NULL DEFAULT 'won_deals'`);
    await db.query(`ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS conversion_custom_field_id uuid`);
    await db.query(`ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS conversion_custom_field_value text`);
    await db.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS converted_at timestamptz`);
    conversionSchemaEnsured = true;
}

async function hasWorkspaceAccess(userId: string, workspaceId: string): Promise<boolean> {
    const result = await db.query(
        `SELECT 1 FROM user_workspace_roles WHERE user_id = $1 AND workspace_id = $2 LIMIT 1`,
        [userId, workspaceId]
    );
    return (result.rowCount || 0) > 0;
}


export async function getAnalyticsData(
    workspaceId: string,
    filters: { teamId?: string; agentId?: string },
    dateRange: { from: string, to: string }
): Promise<AnalyticsData | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    try {
        const baseParams: (string | number)[] = [workspaceId, dateRange.from, dateRange.to];
        console.log('[GET_ANALYTICS_DATA] Input:', { workspaceId, filters, dateRange });


        // Total Conversations
        const [totalConvQuery, totalConvParams] = addFilters(
            'SELECT COUNT(*) FROM chats c WHERE c.workspace_id = $1 AND c.created_at BETWEEN $2 AND $3',
            baseParams,
            filters
        );
        const totalConversationsRes = await db.query(totalConvQuery, totalConvParams);
        console.log('[GET_ANALYTICS_DATA] Total Conversations Query:', { query: totalConvQuery, params: totalConvParams, rowCount: totalConversationsRes.rows[0]?.count });
        const totalConversations = parseInt(totalConversationsRes.rows[0].count, 10);

        // New Contacts (workspace-wide, not filtered by agent/team but by daterange)
        const newContactsRes = await db.query(
            "SELECT COUNT(*) FROM contacts WHERE workspace_id = $1 AND created_at BETWEEN $2 AND $3",
            [workspaceId, dateRange.from, dateRange.to]
        );
        const newContacts = parseInt(newContactsRes.rows[0].count, 10);

        // Avg Response Time (Message based)
        // Calculate the time difference between a customer message (from_me = false) and the NEXT agent message (from_me = true)
        const avgParams: (string | number | null)[] = [workspaceId, dateRange.from, dateRange.to];
        let avgAgentFilter = '';
        let avgTeamFilter = '';

        if (filters.agentId) {
            avgAgentFilter = `AND c.agent_id = $${avgParams.length + 1}`;
            avgParams.push(filters.agentId);
        }
        if (filters.teamId) {
            avgTeamFilter = `AND EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = $${avgParams.length + 1} AND tm.user_id = c.agent_id)`;
            avgParams.push(filters.teamId);
        }

        const avgResponseQuery = `
            WITH MessageDiffs AS (
                SELECT
                    m.chat_id,
                    m.created_at,
                    m.from_me,
                    LEAD(m.created_at) OVER (PARTITION BY m.chat_id ORDER BY m.created_at) as next_created_at,
                    LEAD(m.from_me) OVER (PARTITION BY m.chat_id ORDER BY m.created_at) as next_from_me
                FROM messages m
                JOIN chats c ON m.chat_id = c.id
                WHERE c.workspace_id = $1
                  AND m.created_at BETWEEN $2 AND $3
                  ${avgAgentFilter}
                  ${avgTeamFilter}
            )
            SELECT
                EXTRACT(EPOCH FROM AVG(next_created_at - created_at)) as avg_seconds
            FROM MessageDiffs
            WHERE from_me = false AND next_from_me = true
        `;

        const avgFirstResponseTimeRes = await db.query(avgResponseQuery, avgParams);
        const avgSeconds = parseFloat(avgFirstResponseTimeRes.rows[0]?.avg_seconds);

        let avgFirstResponseTime = '0m 0s';
        if (!Number.isNaN(avgSeconds)) {
            const minutes = Math.floor(avgSeconds / 60);
            const seconds = Math.floor(avgSeconds % 60);
            avgFirstResponseTime = `${minutes}m ${seconds}s`;
        }

        // FCR
        const [fcrQuery, fcrParams] = addFilters(
            `SELECT COUNT(*) FROM chats c WHERE c.status = 'encerrados' AND c.workspace_id = $1 AND c.closed_at BETWEEN $2 AND $3`,
            baseParams,
            filters
        );
        const resolvedRes = await db.query(fcrQuery, fcrParams);
        const resolvedCount = parseInt(resolvedRes.rows[0].count, 10);
        const firstContactResolutionRate = totalConversations > 0 ? (resolvedCount / totalConversations) * 100 : 0;

        // Conversations by Hour (always uses last 30 days for pattern analysis, not the selected range)
        const [convByHourQuery, convByHourParams] = addFilters(
            `SELECT EXTRACT(HOUR FROM c.created_at) as hour, COUNT(*) as count
             FROM chats c
             WHERE c.workspace_id = $1 AND c.created_at > NOW() - INTERVAL '30 days'
             GROUP BY hour
             ORDER BY hour`,
            [workspaceId], // Use only workspaceId for this query
            filters
        );
        const conversationsByHourRes = await db.query(convByHourQuery, convByHourParams);
        const conversationsByHour = conversationsByHourRes.rows.map(r => ({ hour: `${r.hour}h`, count: parseInt(r.count, 10) }));

        // Channels Distribution
        // Keep this aligned with the inbox platform heuristics so the chart matches
        // what the operator sees in the chat list.
        const [channelsQuery, channelsParams] = addFilters(
            `SELECT
                COALESCE(
                    LOWER(NULLIF(mc.platform::text, '')),
                    last_platform.platform_signal,
                    meta_contact_platform.platform_signal,
                    CASE
                        WHEN ct.phone_number_jid ILIKE '%@s.whatsapp.net'
                          OR ct.phone_number_jid ILIKE '%@g.us'
                          OR ct.phone_number_jid ILIKE '%@lid'
                        THEN 'whatsapp'
                        ELSE NULL
                    END,
                    'unknown'
                ) as channel_signal,
                COUNT(*) as count
             FROM chats c
             LEFT JOIN contacts ct ON c.contact_id = ct.id
             LEFT JOIN meta_conversations mc ON c.id = mc.chat_id
             LEFT JOIN LATERAL (
                SELECT LOWER(COALESCE(m.source_from_api, m.platform::text)) AS platform_signal
                FROM messages m
                WHERE m.chat_id = c.id
                  AND COALESCE(m.source_from_api, m.platform::text) IS NOT NULL
                ORDER BY m.created_at DESC
                LIMIT 1
             ) last_platform ON TRUE
             LEFT JOIN LATERAL (
                SELECT LOWER(mch.type::text) AS platform_signal
                FROM meta_contacts mct
                JOIN meta_channels mch ON mch.id = mct.channel_id
                WHERE mct.contact_id = c.contact_id
                ORDER BY mct.created_at DESC
                LIMIT 1
             ) meta_contact_platform ON TRUE
             WHERE c.workspace_id = $1 AND c.created_at BETWEEN $2 AND $3
             GROUP BY 1
             ORDER BY count DESC`,
            baseParams,
            filters
        );
        const channelsRes = await db.query(channelsQuery, channelsParams);

        const channelTotals = channelsRes.rows.reduce<Map<AnalyticsChannelName, number>>((acc, row) => {
                const name = normalizeAnalyticsChannel(row.channel_signal);
                const current = acc.get(name) || 0;
                acc.set(name, current + parseInt(row.count, 10));
                return acc;
            }, new Map<AnalyticsChannelName, number>());

        const conversationsByChannel: AnalyticsData['conversationsByChannel'] = [...channelTotals.entries()]
            .map(([name, value]) => ({
                name,
                value,
                color: getAnalyticsChannelColor(name)
            }))
            .sort((a, b) => b.value - a.value);

        console.log('[GET_ANALYTICS_DATA] Channels Result:', conversationsByChannel);

        return {
            totalConversations,
            newContacts,
            avgFirstResponseTime,
            firstContactResolutionRate,
            conversationsByHour,
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
    filters: { teamId?: string },
    dateRange: { from: string, to: string }
): Promise<AgentPerformance[] | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    try {
        const params: (string | number)[] = [workspaceId, dateRange.from, dateRange.to];
        let teamJoin = '';
        let teamWhere = '';

        if (filters.teamId) {
            teamJoin = 'JOIN team_members tm ON u.id = tm.user_id';
            teamWhere = `AND tm.team_id = $${params.length + 1}`;
            params.push(filters.teamId);
        }

        // Complex query to get agent performance including message-based response time
        // We need to join users -> chats -> messages
        const query = `
            WITH AgentStats AS (
                SELECT
                    c.agent_id,
                    COUNT(DISTINCT c.id) as total_chats,
                    COUNT(DISTINCT c.id) FILTER (WHERE c.status = 'encerrados') as resolved_chats
                FROM chats c
                WHERE c.workspace_id = $1
                  AND c.created_at BETWEEN $2 AND $3
                  AND c.agent_id IS NOT NULL
                GROUP BY c.agent_id
            ),
            MessageResponseTimes AS (
                SELECT
                    sub.agent_id,
                    AVG(EXTRACT(EPOCH FROM (next_created_at - created_at))) as avg_response_seconds
                FROM (
                    SELECT
                        m.chat_id,
                        c.agent_id,
                        m.created_at,
                        m.from_me,
                        LEAD(m.created_at) OVER (PARTITION BY m.chat_id ORDER BY m.created_at) as next_created_at,
                        LEAD(m.from_me) OVER (PARTITION BY m.chat_id ORDER BY m.created_at) as next_from_me
                    FROM messages m
                    JOIN chats c ON m.chat_id = c.id
                    WHERE c.workspace_id = $1
                      AND m.created_at BETWEEN $2 AND $3
                      AND c.agent_id IS NOT NULL
                ) sub
                WHERE from_me = false AND next_from_me = true
                GROUP BY sub.agent_id
            )
            SELECT
                u.id AS agent_id,
                u.full_name AS agent_name,
                u.avatar_url,
                COALESCE(ast.total_chats, 0) as total_chats,
                COALESCE(ast.resolved_chats, 0) as resolved_chats,
                mrt.avg_response_seconds
            FROM users u
            LEFT JOIN AgentStats ast ON u.id = ast.agent_id
            LEFT JOIN MessageResponseTimes mrt ON u.id = mrt.agent_id
            ${teamJoin}
            WHERE (ast.total_chats > 0 OR mrt.avg_response_seconds IS NOT NULL)
            ${teamWhere}
            ORDER BY total_chats DESC;
        `;

        const res = await db.query(query, params);

        const performanceData: AgentPerformance[] = res.rows.map(row => {
            const avgSeconds = parseFloat(row.avg_response_seconds);
            const formattedAvg = !Number.isNaN(avgSeconds)
                ? `${Math.floor(avgSeconds / 60)}m ${Math.floor(avgSeconds % 60)}s`
                : '0m 0s';
            return {
                agent_id: row.agent_id,
                agent_name: row.agent_name,
                avatar_url: row.avatar_url,
                total_chats: parseInt(row.total_chats, 10),
                resolved_chats: parseInt(row.resolved_chats, 10),
                avg_first_response_time: formattedAvg,
                avg_rating: (4.5 + Math.random() * 0.4).toFixed(1), // Mocked for now
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
