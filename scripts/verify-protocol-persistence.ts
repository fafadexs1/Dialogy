
import { config } from 'dotenv';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';

config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

function buildChatProtocol(chatId: string): string {
    if (!chatId) return '';
    const cleaned = chatId.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    return cleaned ? `PRT-${cleaned}` : '';
}

async function main() {
    const client = await pool.connect();
    try {
        console.log('Connected to DB');

        // We need a valid workspace_id and contact_id to insert a chat.
        // Let's fetch the first available ones.
        const workspaceRes = await client.query('SELECT id FROM workspaces LIMIT 1');
        if (workspaceRes.rowCount === 0) {
            console.error('No workspaces found');
            return;
        }
        const workspaceId = workspaceRes.rows[0].id;

        const contactRes = await client.query('SELECT id FROM contacts WHERE workspace_id = $1 LIMIT 1', [workspaceId]);
        let contactId;
        if (contactRes.rowCount === 0) {
            // Create a dummy contact if needed
            const newContact = await client.query(`INSERT INTO contacts (workspace_id, name, phone_number_jid) VALUES ($1, 'Test Protocol', '123456789@s.whatsapp.net') RETURNING id`, [workspaceId]);
            contactId = newContact.rows[0].id;
        } else {
            contactId = contactRes.rows[0].id;
        }

        const chatId = randomUUID();
        const protocol = buildChatProtocol(chatId);
        console.log(`Generated Chat ID: ${chatId}`);
        console.log(`Generated Protocol: ${protocol}`);

        const insertRes = await client.query(
            `INSERT INTO chats (id, workspace_id, contact_id, status, protocol) VALUES ($1, $2, $3, 'gerais', $4) RETURNING *`,
            [chatId, workspaceId, contactId, protocol]
        );

        console.log('Insert Result:', insertRes.rows[0]);

        const selectRes = await client.query('SELECT protocol FROM chats WHERE id = $1', [chatId]);
        const dbProtocol = selectRes.rows[0].protocol;

        console.log(`Protocol in DB: ${dbProtocol}`);

        if (dbProtocol === protocol) {
            console.log('SUCCESS: Protocol persisted correctly.');
        } else {
            console.error('FAILURE: Protocol mismatch or missing.');
        }

        // Cleanup
        await client.query('DELETE FROM chats WHERE id = $1', [chatId]);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

main();
