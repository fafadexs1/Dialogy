'use server';

import { db } from '@/lib/db';
import type { AnalyticsData, AgentPerformance, User } from '@/lib/types';
import { createClient } from '@/lib/supabase/server';

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

        // Total Conversations
        const [totalConvQuery, totalConvParams] = addFilters(
            'SELECT COUNT(*) FROM chats c WHERE c.workspace_id = $1 AND c.created_at BETWEEN $2 AND $3',
            baseParams,
            filters
        );
        const totalConversationsRes = await db.query(totalConvQuery, totalConvParams);
        const totalConversations = parseInt(totalConversationsRes.rows[0].count, 10);

        // New Contacts (workspace-wide, not filtered by agent/team but by daterange)
        const newContactsRes = await db.query(
            "SELECT COUNT(*) FROM contacts WHERE workspace_id = $1 AND created_at BETWEEN $2 AND $3",
            [workspaceId, dateRange.from, dateRange.to]
        );
        const newContacts = parseInt(newContactsRes.rows[0].count, 10);

        // Avg First Response Time
        // Improved query to handle cases where agent replies first or multiple messages exist
        const [avgResponseQuery, avgResponseParams] = addFilters(
            `WITH FirstMessages AS (
                SELECT
                    m.chat_id,
                    c.agent_id,
                    MIN(CASE WHEN m.from_me = false THEN m.created_at END) as first_customer_message,
                    MIN(CASE WHEN m.from_me = true THEN m.created_at END) as first_agent_message
                FROM messages m
                JOIN chats c ON m.chat_id = c.id
                WHERE c.workspace_id = $1 AND m.created_at BETWEEN $2 AND $3
                GROUP BY m.chat_id, c.agent_id
            )
            SELECT
                EXTRACT(EPOCH FROM AVG(first_agent_message - first_customer_message)) as avg_seconds
            FROM FirstMessages
            WHERE first_agent_message > first_customer_message`,
            baseParams,
            { agentId: filters.agentId, teamId: filters.teamId }
        );
        const avgFirstResponseTimeRes = await db.query(avgResponseQuery, avgResponseParams);
        const avgSeconds = avgFirstResponseTimeRes.rows[0]?.avg_seconds;

        let avgFirstResponseTime = '0m 0s';
        if (avgSeconds) {
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

        return {
            totalConversations,
            newContacts,
            avgFirstResponseTime,
            firstContactResolutionRate,
            conversationsByHour,
        };
    } catch (error) {
        console.error("[GET_ANALYTICS_DATA] Error:", error);
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
        let query = `
            SELECT
                u.id as agent_id,
                u.full_name as agent_name,
                u.avatar_url,
                COUNT(c.id) as total_chats,
                COUNT(c.id) FILTER (WHERE c.status = 'encerrados') as resolved_chats,
                (
                    SELECT EXTRACT(EPOCH FROM AVG(fm.first_agent_message - fm.first_customer_message))
                    FROM (
                        SELECT
                            m.chat_id,
                            MIN(CASE WHEN m.from_me = false THEN m.created_at END) as first_customer_message,
                            MIN(CASE WHEN m.from_me = true THEN m.created_at END) as first_agent_message
                        FROM messages m
                        -- Filter messages by date range within the sub-subquery
                        WHERE m.created_at BETWEEN $2 AND $3
                        GROUP BY m.chat_id
                    ) fm
                    JOIN chats fmc ON fm.chat_id = fmc.id
                    WHERE fmc.agent_id = u.id AND fm.first_agent_message > fm.first_customer_message
                ) as avg_response_seconds
            FROM users u
            LEFT JOIN chats c ON u.id = c.agent_id AND c.workspace_id = $1
        `;

        const params: (string | number)[] = [workspaceId, dateRange.from, dateRange.to];
        // Main WHERE clause filters chats by date range
        const whereClauses = ['c.created_at BETWEEN $2 AND $3'];

        if (filters.teamId) {
            // This join is only for filtering by team
            query += ` JOIN team_members tm ON u.id = tm.user_id `;
            whereClauses.push(`tm.team_id = $${params.length + 1}`);
            params.push(filters.teamId);
        }

        query += ` WHERE ${whereClauses.join(' AND ')}`;

        query += `
            GROUP BY u.id
            HAVING COUNT(c.id) > 0
            ORDER BY total_chats DESC;
        `;

        const res = await db.query(query, params);

        const performanceData: AgentPerformance[] = res.rows.map(row => {
            const avgSeconds = row.avg_response_seconds;
            return {
                agent_id: row.agent_id,
                agent_name: row.agent_name,
                avatar_url: row.avatar_url,
                total_chats: parseInt(row.total_chats, 10),
                resolved_chats: parseInt(row.resolved_chats, 10),
                avg_first_response_time: avgSeconds ? `${Math.floor(avgSeconds / 60)}m ${Math.floor(avgSeconds % 60)}s` : null,
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
