import 'dotenv/config';
import { db } from '../lib/db';

async function optimizeDatabase() {
    console.log('Starting database optimization...');

    const client = await db.connect();

    try {
        // 1. Index for "last message" query optimization
        // This is the most critical one for the chat list performance
        console.log('Creating index: idx_messages_chat_created_at...');
        await client.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_chat_created_at 
      ON messages (workspace_id, chat_id, created_at DESC);
    `);

        // 2. Index for API message updates
        // Speeds up updates when webhooks arrive
        console.log('Creating index: idx_messages_api_id...');
        await client.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_api_id 
      ON messages (message_id_from_api);
    `);

        // 3. Index for chat filtering
        // Speeds up filtering by status and agent
        console.log('Creating index: idx_chats_workspace_status_agent...');
        await client.query(`
      CREATE INDEX IF NOT EXISTS idx_chats_workspace_status_agent 
      ON chats (workspace_id, status, agent_id);
    `);

        // 4. Index for unread count
        // Speeds up counting unread messages
        console.log('Creating index: idx_messages_unread_count...');
        await client.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_unread_count 
      ON messages (chat_id, from_me, is_read) 
      WHERE from_me = false AND is_read = false;
    `);

        console.log('Database optimization completed successfully.');
    } catch (error) {
        console.error('Error optimizing database:', error);
    } finally {
        client.release();
        // We need to close the pool to exit the script
        await db.end();
    }
}

optimizeDatabase();
