import { Pool } from 'pg';
import fs from 'fs';
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function main() {
    const client = await pool.connect();
    try {
        const res = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'crm_automations';
        `);
        fs.writeFileSync('db-schema.json', JSON.stringify(res.rows, null, 2));
        console.log('Saved to db-schema.json');
    } finally {
        client.release();
        await pool.end();
    }
}
main().catch(console.error);
