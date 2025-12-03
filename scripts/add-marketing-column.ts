
import { config } from 'dotenv';
import { Pool } from 'pg';

config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function main() {
    const client = await pool.connect();
    try {
        console.log('Connected to DB');

        // Check if column exists
        const checkRes = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name='workspaces' AND column_name='marketing_auto_close_seconds'
        `);

        if (checkRes.rowCount && checkRes.rowCount > 0) {
            console.log('Column marketing_auto_close_seconds already exists.');
        } else {
            console.log('Adding column marketing_auto_close_seconds...');
            await client.query(`
                ALTER TABLE workspaces 
                ADD COLUMN marketing_auto_close_seconds INTEGER DEFAULT NULL;
            `);
            console.log('Column added successfully.');
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

main();
