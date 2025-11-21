import { db } from '../lib/db';

async function migrate() {
    try {
        console.log("Adding team_id column to shortcuts table...");
        await db.query(`
            ALTER TABLE shortcuts 
            ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id);
        `);

        console.log("Updating shortcuts type constraint...");
        await db.query(`
            ALTER TABLE shortcuts DROP CONSTRAINT IF EXISTS shortcuts_type_check;
            ALTER TABLE shortcuts ADD CONSTRAINT shortcuts_type_check CHECK (type IN ('global', 'private', 'team'));
        `);

        console.log("Successfully updated shortcuts schema.");
        process.exit(0);
    } catch (e) {
        console.error("Error running migration:", e);
        process.exit(1);
    }
}

migrate();
