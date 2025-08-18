
'use server';

import { db } from '@/lib/db';
import type { AnalyticsData, AgentPerformance, User } from '@/lib/types';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

// Helper to add agent and team filters to a query
const addFilters = (
    query: string, 
    baseParams: any[], 
    { teamId, agentId }: { teamId?: string; agentId?: string }
): [string, any[]] => {
    let newQuery = query;
    const newParams = [...baseParams];
    let whereClauseExists = newQuery.includes(' WHERE ');

    const addCondition = (condition: string) => {
        if (whereClauseExists) {
            newQuery = newQuery.replace(' WHERE ', ` WHERE ${condition} AND `);
        } else {
            newQuery += ` WHERE ${condition}`;
            whereClauseExists = true;
        }
    };

    if (agentId) {
        addCondition(`c.agent_id = $${newParams.length + 1}`);
        newParams.push(agentId);
    } else if (teamId) {
        // If filtering by team, join with team_members
        const fromClause = 'FROM chats c';
        const newFromClause = `FROM chats c JOIN team_members tm ON c.agent_id = tm.user_id`;
        if (newQuery.includes(fromClause)) {
             newQuery = newQuery.replace(fromClause, newFromClause);
        }
        addCondition(`tm.team_id = $${newParams.length + 1}`);
        newParams.push(teamId);
    }
    
    return [newQuery, newParams];
};


export async function getAnalyticsData(
    workspaceId: string, 
    filters: { teamId?: string; agentId?: string }
): Promise<AnalyticsData | null> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return null;

    try {
        const baseParams = [workspaceId];

        // Total Conversations
        const [totalConvQuery, totalConvParams] = addFilters(
            'SELECT COUNT(*) FROM chats c',
            baseParams,
            filters
        );
        const totalConversationsRes = await db.query(totalConvQuery, totalConvParams);
        const totalConversations = parseInt(totalConversationsRes.rows[0].count, 10);

        // New Contacts (workspace-wide, not filtered)
        const newContactsRes = await db.query(
            "SELECT COUNT(*) FROM contacts WHERE workspace_id = $1 AND created_at > NOW() - INTERVAL '30 days'",
            [workspaceId]
        );
        const newContacts = parseInt(newContactsRes.rows[0].count, 10);

        // Avg First Response Time
        const [avgResponseQuery, avgResponseParams] = addFilters(
            `WITH FirstMessages AS (
                SELECT
                    chat_id,
                    c.agent_id,
                    MIN(CASE WHEN from_me = false THEN m.created_at END) as first_customer_message,
                    MIN(CASE WHEN from_me = true THEN m.created_at END) as first_agent_message
                FROM messages m
                JOIN chats c ON m.chat_id = c.id
                WHERE c.workspace_id = $1
                GROUP BY chat_id, c.agent_id
            )
            SELECT
                EXTRACT(EPOCH FROM AVG(first_agent_message - first_customer_message)) as avg_seconds
            FROM FirstMessages
            WHERE first_agent_message > first_customer_message`,
             baseParams,
             { agentId: filters.agentId } // Team filter for this is complex, applying only agent for now.
        );
        const avgFirstResponseTimeRes = await db.query(avgResponseQuery, avgResponseParams);
        const avgSeconds = avgFirstResponseTimeRes.rows[0]?.avg_seconds;
        const avgFirstResponseTime = avgSeconds ? `${Math.floor(avgSeconds / 60)}m ${Math.floor(avgSeconds % 60)}s` : null;

        // FCR
        const [fcrQuery, fcrParams] = addFilters(
            'SELECT COUNT(*) FROM chats c WHERE c.status = \'encerrados\'',
            baseParams,
            filters
        );
        const resolvedRes = await db.query(fcrQuery, fcrParams);
        const resolvedCount = parseInt(resolvedRes.rows[0].count, 10);
        const firstContactResolutionRate = totalConversations > 0 ? (resolvedCount / totalConversations) * 100 : 0;
        
        // Conversations by Hour
        const [convByHourQuery, convByHourParams] = addFilters(
             `SELECT EXTRACT(HOUR FROM c.created_at) as hour, COUNT(*) as count
             FROM chats c
             WHERE c.created_at > NOW() - INTERVAL '30 days'
             GROUP BY hour
             ORDER BY hour;`,
             baseParams,
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
    filters: { teamId?: string }
): Promise<AgentPerformance[] | null> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return null;
    
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
                        GROUP BY m.chat_id
                    ) fm
                    JOIN chats fmc ON fm.chat_id = fmc.id
                    WHERE fmc.agent_id = u.id AND fm.first_agent_message > fm.first_customer_message
                ) as avg_response_seconds
            FROM users u
            JOIN chats c ON u.id = c.agent_id
            WHERE c.workspace_id = $1
        `;

        const params = [workspaceId];

        if (filters.teamId) {
            query += ` AND u.id IN (SELECT user_id FROM team_members WHERE team_id = $2)`;
            params.push(filters.teamId);
        }

        query += `
            GROUP BY u.id
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
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { members: null, error: "Usuário não autenticado." };

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
