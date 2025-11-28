import { Client } from 'pg';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function inspectPolicies() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        console.error('Error: DATABASE_URL is not defined');
        process.exit(1);
    }

    const client = new Client({
        connectionString,
        ssl: { rejectUnauthorized: false },
    });

    try {
        await client.connect();
        console.log('Connected. Querying policies for workspace_logs...');

        const res = await client.query(`
      SELECT * FROM pg_policies WHERE tablename = 'workspace_logs';
    `);

        console.log('Policies found:', res.rows.length);
        res.rows.forEach(row => {
            console.log(`- Policy: ${row.policyname}`);
            console.log(`  Role: ${row.roles}`);
            console.log(`  Cmd: ${row.cmd}`);
            console.log(`  Qual: ${row.qual}`);
            console.log(`  WithCheck: ${row.with_check}`);
            console.log('---');
        });

        const rlsRes = await client.query(`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname = 'workspace_logs';
    `);
        console.log('Table RLS status:', rlsRes.rows[0]);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

inspectPolicies();
