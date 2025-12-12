import 'dotenv/config';
import { db } from '../lib/db';

async function migrate() {
    console.log('Starting migration for crm_segments...');

    try {
        await db.query(`
      CREATE TABLE IF NOT EXISTS crm_segments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        criteria JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

        await db.query(`
      CREATE INDEX IF NOT EXISTS idx_crm_segments_workspace ON crm_segments(workspace_id);
    `);

        console.log('Migration completed successfully.');
    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        process.exit(0);
    }
}

migrate();
