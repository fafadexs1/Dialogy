import { config } from 'dotenv';
config();
import { db } from '../src/lib/db';

async function main() {
    console.log('Creating system_settings table...');
    try {
        await db.query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
        console.log('✅ Table system_settings created or already exists.');
    } catch (e) {
        console.error('❌ Error creating table:', e);
    }
    process.exit(0);
}

main();
