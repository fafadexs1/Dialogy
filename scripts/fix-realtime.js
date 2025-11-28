const { Pool } = require('pg');
require('dotenv').config({ path: '.env' });

async function fixRealtime() {
    if (!process.env.DATABASE_URL) {
        console.error('DATABASE_URL not found in .env');
        process.exit(1);
    }

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
    });

    try {
        console.log('Connecting to database...');
        const client = await pool.connect();

        console.log('Checking supabase_realtime publication...');
        const pubRes = await client.query("SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'");
        if (pubRes.rowCount === 0) {
            console.log('Creating publication supabase_realtime...');
            await client.query("CREATE PUBLICATION supabase_realtime FOR ALL TABLES");
        } else {
            console.log('Publication supabase_realtime exists.');
        }

        const tables = ['messages', 'chats', 'contacts', 'message_status', 'chat_assignments'];

        for (const table of tables) {
            try {
                // Check if table exists
                const tableExists = await client.query(`SELECT 1 FROM information_schema.tables WHERE table_name = $1`, [table]);
                if (tableExists.rowCount === 0) {
                    console.log(`Table ${table} does not exist. Skipping.`);
                    continue;
                }

                // Set REPLICA IDENTITY FULL
                console.log(`Setting REPLICA IDENTITY FULL for ${table}...`);
                await client.query(`ALTER TABLE ${table} REPLICA IDENTITY FULL`);
                console.log(`Successfully set REPLICA IDENTITY FULL for ${table}.`);

                console.log(`Adding ${table} to supabase_realtime...`);
                await client.query(`ALTER PUBLICATION supabase_realtime ADD TABLE ${table}`);
                console.log(`Successfully added ${table}.`);
            } catch (err) {
                if (err.message.includes('already is in publication')) {
                    console.log(`Table ${table} is already in publication.`);
                } else {
                    console.error(`Error processing ${table}:`, err.message);
                }
            }
        }

        console.log('Verifying final state...');
        const finalState = await client.query(`
            SELECT tablename FROM pg_publication_tables 
            WHERE pubname = 'supabase_realtime';
        `);
        console.log('Tables currently in Realtime:', finalState.rows.map(r => r.tablename));

        client.release();
    } catch (err) {
        console.error('Fatal error:', err);
    } finally {
        await pool.end();
    }
}

fixRealtime();
