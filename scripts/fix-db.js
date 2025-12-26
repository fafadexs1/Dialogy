const { config } = require('dotenv');
config();
const { Pool } = require('pg');

async function main() {
    if (!process.env.DATABASE_URL) {
        console.error('DATABASE_URL is missing');
        process.exit(1);
    }

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL
    });

    console.log('Creating system_settings table via raw pg...');
    try {
        const res = await pool.query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
        console.log('✅ Table system_settings created successfully.');
    } catch (e) {
        console.error('❌ Error creating table:', e);
    }
    await pool.end();
}

main();
