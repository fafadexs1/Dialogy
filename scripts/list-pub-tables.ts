import { Pool } from 'pg';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function listTables() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
        const pubRes = await pool.query(`
      SELECT schemaname, tablename 
      FROM pg_publication_tables 
      WHERE pubname = 'supabase_realtime';
    `);

        const tables = pubRes.rows.map(r => r.tablename);
        fs.writeFileSync('publication_tables.txt', JSON.stringify(tables, null, 2));
        console.log('Tables written to publication_tables.txt');

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

listTables();
