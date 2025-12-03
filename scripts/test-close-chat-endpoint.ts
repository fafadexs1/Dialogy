
import { config } from 'dotenv';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';

config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function main() {
    const client = await pool.connect();
    try {
        console.log('Connected to DB');

        // 1. Get a valid system agent token
        const agentRes = await client.query('SELECT token, workspace_id FROM system_agents WHERE is_active = true LIMIT 1');
        if (agentRes.rowCount === 0) {
            console.error('No active system agent found. Cannot test.');
            return;
        }
        const { token, workspace_id } = agentRes.rows[0];
        console.log(`Using System Agent Token: ${token.substring(0, 10)}...`);

        // 2. Create a dummy chat to close
        const contactRes = await client.query('SELECT id FROM contacts WHERE workspace_id = $1 LIMIT 1', [workspace_id]);
        let contactId;
        if (contactRes.rowCount === 0) {
            const newContact = await client.query(`INSERT INTO contacts (workspace_id, name, phone_number_jid) VALUES ($1, 'Test Close', '999999999@s.whatsapp.net') RETURNING id`, [workspace_id]);
            contactId = newContact.rows[0].id;
        } else {
            contactId = contactRes.rows[0].id;
        }

        const chatId = randomUUID();
        // Protocol trigger should handle protocol generation
        await client.query(
            `INSERT INTO chats (id, workspace_id, contact_id, status) VALUES ($1, $2, $3, 'gerais')`,
            [chatId, workspace_id, contactId]
        );
        console.log(`Created dummy chat: ${chatId}`);

        // 3. Call the API
        const response = await fetch('http://localhost:9002/api/agent/chats/close', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                chatId: chatId,
                notes: 'Closed via test script'
            })
        });

        const data = await response.json();
        console.log('API Response:', response.status, data);

        // 4. Verify DB state
        const checkRes = await client.query('SELECT status, closed_at FROM chats WHERE id = $1', [chatId]);
        const chat = checkRes.rows[0];
        console.log('Chat Status in DB:', chat.status);

        if (chat.status === 'encerrados' && chat.closed_at) {
            console.log('SUCCESS: Chat closed successfully.');
        } else {
            console.error('FAILURE: Chat not closed.');
        }

        // Cleanup
        await client.query('DELETE FROM chats WHERE id = $1', [chatId]);

    } catch (err) {
        console.error('Error details:', err);
        if (err instanceof Error) {
            console.error('Message:', err.message);
            console.error('Cause:', err.cause);
        }
    } finally {
        client.release();
        await pool.end();
    }
}

main();
