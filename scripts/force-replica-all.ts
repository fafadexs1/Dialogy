import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function fixAll() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
        const tables = ['chats', 'contacts', 'messages'];

        for (const table of tables) {
            console.log(`Setting REPLICA IDENTITY FULL on ${table}...`);
            await pool.query(`ALTER TABLE "public"."${table}" REPLICA IDENTITY FULL;`);
        }

        console.log('✅ SUCCESS: Replica Identity set to FULL for chats, contacts, and messages.');

    } catch (e) {
        console.error('❌ ERROR:', e);
    } finally {
        await pool.end();
    }
}

fixAll();
