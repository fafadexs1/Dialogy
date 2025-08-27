import { Pool } from 'pg';

declare global {
  // eslint-disable-next-line no-var
  var pool: Pool | undefined;
}

// Ensure the connection string is correctly typed
const connectionString: string = process.env.DATABASE_URL!;

const pool = global.pool || new Pool({
  connectionString: connectionString,
});

if (process.env.NODE_ENV !== 'production') {
  global.pool = pool;
}

export const db = pool;
