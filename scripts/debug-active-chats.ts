
import { db } from '../src/lib/db';

async function main() {
    try {
        console.log('--- Checking for Duplicate Active Chats ---');

        const res = await db.query(`
        SELECT contact_id, COUNT(*) as count
        FROM chats
        WHERE status IN ('gerais', 'atendimentos')
        GROUP BY contact_id
        HAVING COUNT(*) > 1
    `);

        if (res.rowCount === 0) {
            console.log('✅ No duplicate active chats found.');
        } else {
            console.log(`⚠️ Found ${res.rowCount} contacts with multiple active chats:`);
            for (const row of res.rows) {
                console.log(`   Contact ID: ${row.contact_id}, Count: ${row.count}`);

                // Fetch details
                const chats = await db.query(`
                SELECT id, status, is_autopilot_active, created_at, copilot_mode 
                FROM chats 
                WHERE contact_id = $1 AND status IN ('gerais', 'atendimentos')
                ORDER BY created_at DESC
            `, [row.contact_id]);

                console.table(chats.rows);
            }
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        process.exit(0);
    }
}

main();
