import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function check() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
        const res = await pool.query(`
      SELECT relname, relreplident 
      FROM pg_class 
      WHERE relname = 'messages';
    `);
        console.log('Table Status:', res.rows[0]);
        // relreplident: 'd' = default, 'n' = nothing, 'f' = full, 'i' = index
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

check();
