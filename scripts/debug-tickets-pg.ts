import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

async function check() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        await client.connect();
        console.log('Connected to database');

        const res = await client.query('SELECT * FROM support_tickets');
        console.log(`Total tickets: ${res.rowCount}`);
        console.log('Rows:', res.rows);
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

check();
