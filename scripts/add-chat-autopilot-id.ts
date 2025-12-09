
import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function runMigration() {
    const client = await pool.connect();
    try {
        console.log('Adding autopilot_config_id column to chats table...');

        await client.query(`
      ALTER TABLE chats
      ADD COLUMN IF NOT EXISTS autopilot_config_id UUID REFERENCES autopilot_configs(id);
    `);

        console.log('Migration completed successfully.');
    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        client.release();
        await pool.end();
    }
}

runMigration();
