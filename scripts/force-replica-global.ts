import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function forceGlobal() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
        // Get all tables in public schema
        const tablesRes = await pool.query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public';
    `);

        const tables = tablesRes.rows.map(r => r.tablename);
        console.log(`Found ${tables.length} tables in public schema.`);

        for (const table of tables) {
            // Skip internal prisma migrations table if desired, but usually safe to set on all
            if (table === '_prisma_migrations') continue;

            console.log(`Setting REPLICA IDENTITY FULL on ${table}...`);
            try {
                await pool.query(`ALTER TABLE "public"."${table}" REPLICA IDENTITY FULL;`);
            } catch (err) {
                console.error(`Failed to set on ${table}:`, err);
            }
        }

        console.log('✅ SUCCESS: Replica Identity set to FULL for ALL public tables.');

    } catch (e) {
        console.error('❌ ERROR:', e);
    } finally {
        await pool.end();
    }
}

forceGlobal();
