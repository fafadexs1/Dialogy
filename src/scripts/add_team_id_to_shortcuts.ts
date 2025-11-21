
import { db } from '@/lib/db';

async function migrate() {
    try {
        console.log("Adding team_id column to shortcuts table...");
        await db.query(`
            ALTER TABLE shortcuts 
            ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id);
        `);
        console.log("Successfully added team_id column.");
    } catch (e) {
        console.error("Error running migration:", e);
    }
}

migrate();
