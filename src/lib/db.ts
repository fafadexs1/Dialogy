
import { Pool } from 'pg';

let pool: Pool;

if (!pool) {
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
    });
}

export const db = pool;
