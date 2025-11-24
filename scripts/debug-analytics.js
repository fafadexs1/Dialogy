require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function run() {
    try {
        console.log('Connecting to database...');
        const client = await pool.connect();
        console.log('Connected.');

        // 1. Check raw data from chats
        console.log('\n--- Raw Chats Data (Limit 10) ---');
        const res = await client.query(`
      SELECT id, created_at, assigned_at, closed_at, workspace_id
      FROM chats
      WHERE assigned_at IS NOT NULL AND closed_at IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 10
    `);
        console.table(res.rows);

        if (res.rows.length === 0) {
            console.log('No chats found with assigned_at AND closed_at IS NOT NULL.');
        } else {
            const workspaceId = res.rows[0].workspace_id;
            console.log(`\nUsing Workspace ID: ${workspaceId}`);

            // 2. Run the aggregation query
            console.log('\n--- Aggregation Query Result ---');
            const avgQuery = `
            SELECT
                EXTRACT(EPOCH FROM AVG(closed_at - assigned_at)) AS avg_seconds
            FROM chats
            WHERE workspace_id = $1
              AND assigned_at IS NOT NULL
              AND closed_at IS NOT NULL
        `;
            const avgRes = await client.query(avgQuery, [workspaceId]);
            console.log('Result:', avgRes.rows[0]);
        }

        client.release();
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await pool.end();
    }
}

run();
