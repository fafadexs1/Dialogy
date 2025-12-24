
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
        console.log('Creating workspace_integrations table...');
        await db.query(`
            CREATE TABLE IF NOT EXISTS workspace_integrations (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                provider TEXT NOT NULL,
                config JSONB NOT NULL DEFAULT '{}',
                is_active BOOLEAN DEFAULT false,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                UNIQUE(workspace_id, provider)
            );
        `);
        console.log('Table workspace_integrations created successfully.');

        // Verify it exists
        const res = await db.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'workspace_integrations';
        `);
        console.log('Columns:', res.rows.map(r => `${r.column_name} (${r.data_type})`).join(', '));

    } catch (error) {
        console.error('Error creating table:', error);
    } finally {
        await db.end();
        process.exit();
    }
}

run();
