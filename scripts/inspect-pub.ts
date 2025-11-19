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

        const tablesInPub = pubRes.rows.map(r => r.tablename);
        console.log('Tables:', tablesInPub);

        if (tablesInPub.length > 0) {
            console.log('\n--- Replica Identity of tables in publication ---');
            const tablesRes = await pool.query(`
          SELECT n.nspname as schema, c.relname as table_name, c.relreplident 
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relname = ANY($1::text[])
          AND n.nspname = 'public';
        `, [tablesInPub]);

            console.table(tablesRes.rows);
        } else {
            console.log('No tables in publication.');
        }

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

inspect();
