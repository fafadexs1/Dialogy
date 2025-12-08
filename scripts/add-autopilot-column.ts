
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
    console.error('DATABASE_URL is not defined.');
    process.exit(1);
}

const db = new Pool({ connectionString });

async function run() {
    try {
        console.log('Adding is_autopilot_active column to chats table...');
        await db.query(`
      ALTER TABLE chats 
      ADD COLUMN IF NOT EXISTS is_autopilot_active BOOLEAN DEFAULT FALSE;
    `);
        console.log('Column added successfully.');
    } catch (error) {
        console.error('Error adding column:', error);
    } finally {
        await db.end();
        process.exit();
    }
}

run();
