
import { config } from 'dotenv';
import { Pool } from 'pg';

config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function main() {
    const client = await pool.connect();
    try {
        console.log('Connected to DB. Applying Protocol Trigger...');

        await client.query('BEGIN');

        // 1. Create the function to generate protocol
        await client.query(`
            CREATE OR REPLACE FUNCTION generate_protocol_if_missing()
            RETURNS TRIGGER AS $$
            BEGIN
                IF NEW.protocol IS NULL OR NEW.protocol = '' THEN
                    NEW.protocol := 'PRT-' || UPPER(regexp_replace(NEW.id::text, '[^a-zA-Z0-9]', '', 'g'));
                END IF;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
        `);

        // 2. Create the trigger
        // We use DO block to avoid error if trigger already exists (though CREATE OR REPLACE TRIGGER is PG 14+)
        // For compatibility, we drop if exists first.
        await client.query(`
            DROP TRIGGER IF EXISTS ensure_protocol_exists ON chats;
        `);

        await client.query(`
            CREATE TRIGGER ensure_protocol_exists
            BEFORE INSERT ON chats
            FOR EACH ROW
            EXECUTE FUNCTION generate_protocol_if_missing();
        `);

        await client.query('COMMIT');
        console.log('SUCCESS: Trigger applied successfully.');

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error applying trigger:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

main();
