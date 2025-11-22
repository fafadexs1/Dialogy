import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function inspect() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
        console.log('--- Tables in supabase_realtime publication ---');
        const pubRes = await pool.query(`
      SELECT schemaname, tablename 
      FROM pg_publication_tables 
      WHERE pubname = 'supabase_realtime';
    `);
        if (pubRes.rows.length === 0) {
            console.log('No tables found in supabase_realtime publication (or publication does not exist).');
        } else {
            console.table(pubRes.rows);
        }

        console.log('\n--- Replica Identity of ALL public tables ---');
        const tablesRes = await pool.query(`
      SELECT n.nspname as schema, c.relname as table_name, c.relreplident 
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY c.relname;
    `);
        // relreplident: 'd' = default, 'n' = nothing, 'f' = full, 'i' = index
        console.table(tablesRes.rows);

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

inspect();
