import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function fix() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
        // 1. Check connection info
        const userRes = await pool.query('SELECT current_user, current_database();');
        console.log('Connected as:', userRes.rows[0]);

        // 2. Check all tables named 'messages'
        const tablesRes = await pool.query(`
      SELECT n.nspname as schema, c.relname, c.relreplident 
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = 'messages';
    `);
        console.log('Found tables:', tablesRes.rows);

        // 3. Attempt to set FULL on public.messages
        console.log('Attempting ALTER TABLE "public"."messages" REPLICA IDENTITY FULL...');
        await pool.query(`ALTER TABLE "public"."messages" REPLICA IDENTITY FULL;`);

        // 4. Verify again
        const verifyRes = await pool.query(`
      SELECT n.nspname as schema, c.relname, c.relreplident 
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = 'messages' AND n.nspname = 'public';
    `);
        console.log('Verification:', verifyRes.rows[0]);

        if (verifyRes.rows[0]?.relreplident === 'f') {
            console.log('✅ SUCCESS: Replica Identity is now FULL.');
        } else {
            console.error('❌ FAILURE: Replica Identity is still', verifyRes.rows[0]?.relreplident);
        }

    } catch (e) {
        console.error('❌ ERROR:', e);
    } finally {
        await pool.end();
    }
}

fix();
