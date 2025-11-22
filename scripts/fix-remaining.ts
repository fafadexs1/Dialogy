import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function fixRemaining() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
        const tables = ['contact_tags', 'user_workspace_presence'];

        for (const table of tables) {
            console.log(`Setting REPLICA IDENTITY FULL on ${table}...`);
            await pool.query(`ALTER TABLE "public"."${table}" REPLICA IDENTITY FULL;`);
        }

        console.log('✅ SUCCESS: Replica Identity set to FULL for contact_tags and user_workspace_presence.');

    } catch (e) {
        console.error('❌ ERROR:', e);
    } finally {
        await pool.end();
    }
}

fixRemaining();
