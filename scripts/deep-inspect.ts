import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function deepInspect() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
        console.log('--- Publication Details ---');
        const pubDetails = await pool.query(`
      SELECT * FROM pg_publication WHERE pubname = 'supabase_realtime';
    `);
        console.table(pubDetails.rows);
        // puballtables: true means "FOR ALL TABLES"

        console.log('\n--- All Public Tables & Replica Identity ---');
        const tablesRes = await pool.query(`
      SELECT 
        n.nspname as schema, 
        c.relname as table_name, 
        c.relreplident,
        CASE WHEN p.tablename IS NOT NULL THEN true ELSE false END as in_publication
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_publication_tables p ON p.tablename = c.relname AND p.pubname = 'supabase_realtime'
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY c.relname;
    `);

        console.table(tablesRes.rows);

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

deepInspect();
