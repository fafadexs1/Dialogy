import { Client } from 'pg';
import * as dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function fixPermissions() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    console.error('Error: DATABASE_URL is not defined in .env');
    process.exit(1);
  }

  console.log('Connecting to database...');
  const client = new Client({
    connectionString,
    ssl: {
      rejectUnauthorized: false, // Required for Supabase connections usually
    },
  });

  try {
    await client.connect();
    console.log('Connected successfully.');

    console.log('Running SQL to fix permissions...');

    // SQL to run
    const sql = `
      -- Create the table if it doesn't exist
      CREATE TABLE IF NOT EXISTS workspace_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        created_at TIMESTAMPTZ DEFAULT now(),
        workspace_id UUID,
        user_id UUID,
        action TEXT NOT NULL,
        payload JSONB
      );

      -- DISABLE RLS completely for this table to avoid any policy issues
      ALTER TABLE workspace_logs DISABLE ROW LEVEL SECURITY;

      -- Grant permissions to everyone (it's just logs)
      GRANT ALL ON TABLE workspace_logs TO service_role;
      GRANT ALL ON TABLE workspace_logs TO postgres;
      GRANT ALL ON TABLE workspace_logs TO authenticated;
      GRANT ALL ON TABLE workspace_logs TO anon;
      
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;
    `;

    await client.query(sql);
    console.log('Permissions granted successfully!');

  } catch (err) {
    console.error('Error executing SQL:', err);
  } finally {
    await client.end();
  }
}

fixPermissions();
