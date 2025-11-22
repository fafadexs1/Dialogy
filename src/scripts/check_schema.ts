
import { db } from '@/lib/db';

async function checkSchema() {
    try {
        const res = await db.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'shortcuts';
        `);
        console.log("Columns in shortcuts table:", res.rows);
    } catch (e) {
        console.error("Error checking schema:", e);
    }
}

checkSchema();
