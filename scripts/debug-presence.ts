
import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const db = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function updateUserOnlineStatus(userId: string, workspaceId: string, isOnline: boolean) {
    console.log(`Updating status for user ${userId} in workspace ${workspaceId} to ${isOnline}`);
    try {
        await db.query(
            `
            INSERT INTO user_workspace_presence (user_id, workspace_id, is_online, online_since, last_seen)
            VALUES ($1, $2, $3, CASE WHEN $3 THEN NOW() ELSE NULL END, NOW())
            ON CONFLICT (user_id, workspace_id)
            DO UPDATE SET
                is_online = EXCLUDED.is_online,
                online_since = CASE
                    WHEN EXCLUDED.is_online THEN COALESCE(user_workspace_presence.online_since, NOW())
                    ELSE NULL
                END,
                last_seen = NOW();
            `,
            [userId, workspaceId, isOnline]
        );
        console.log('Update successful');
    } catch (error) {
        console.error(`Failed to update online status:`, error);
    }
}

async function getOnlineAgents(workspaceId: string) {
    console.log(`Fetching online agents for workspace ${workspaceId}`);
    try {
        const res = await db.query(
            `
            SELECT
                u.id,
                u.full_name,
                u.avatar_url,
                u.email,
                uwp.online_since
            FROM user_workspace_presence uwp
            JOIN users u ON u.id = uwp.user_id
            WHERE uwp.workspace_id = $1 AND uwp.is_online = TRUE
            `,
            [workspaceId]
        );
        return res.rows;
    } catch (error) {
        console.error('Error fetching presence data:', error);
        return [];
    }
}

async function main() {
    try {
        // 1. Get a user and workspace
        const userRes = await db.query('SELECT id, full_name FROM users LIMIT 1');
        if (userRes.rowCount === 0) {
            console.log('No users found');
            return;
        }
        const user = userRes.rows[0];
        console.log(`Testing with user: ${user.full_name} (${user.id})`);

        const workspaceRes = await db.query('SELECT workspace_id FROM user_workspace_roles WHERE user_id = $1 LIMIT 1', [user.id]);
        if (workspaceRes.rowCount === 0) {
            console.log('User has no workspace');
            return;
        }
        const workspaceId = workspaceRes.rows[0].workspace_id;
        console.log(`Testing with workspace: ${workspaceId}`);

        // 2. Set online
        await updateUserOnlineStatus(user.id, workspaceId, true);

        // 3. Get agents
        const agents = await getOnlineAgents(workspaceId);
        console.log('Online agents:', agents);

        if (agents.find((a: any) => a.id === user.id)) {
            console.log('SUCCESS: User found in online agents list');
        } else {
            console.log('FAILURE: User NOT found in online agents list');
        }

    } catch (e) {
        console.error(e);
    } finally {
        await db.end();
    }
}

main();
