import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function fixCluster() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
        console.log('Setting REPLICA IDENTITY FULL on whatsapp_clusters...');
        await pool.query(`ALTER TABLE "public"."whatsapp_clusters" REPLICA IDENTITY FULL;`);

        console.log('✅ SUCCESS: Replica Identity set to FULL for whatsapp_clusters.');

    } catch (e) {
        console.error('❌ ERROR:', e);
    } finally {
        await pool.end();
    }
}

fixCluster();
