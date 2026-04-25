
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function checkTrigger() {
    let databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        const envPath = path.join(process.cwd(), '.env');
        if (fs.existsSync(envPath)) {
            const envContent = fs.readFileSync(envPath, 'utf-8');
            const match = envContent.match(/DATABASE_URL=["']?(.+?)["']?(\s|$)/);
            if (match) databaseUrl = match[1];
        }
    }

    const client = new Client({ connectionString: databaseUrl });
    await client.connect();

    const func = await client.query(`
        SELECT routine_definition 
        FROM information_schema.routines 
        WHERE routine_name = 'update_contact_phone_digits'
    `);
    console.log("FUNCTION DEF:", func.rows[0]?.routine_definition);

    const trigger = await client.query(`
        SELECT trigger_name, event_manipulation, event_object_table, action_statement
        FROM information_schema.triggers
        WHERE event_object_table = 'contacts'
    `);
    console.log("TRIGGERS:", trigger.rows);

    await client.end();
}
checkTrigger().catch(console.error);
