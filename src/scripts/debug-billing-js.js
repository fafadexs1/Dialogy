
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Load .env
const envPath = path.resolve(process.cwd(), '.env');
const envVars = {};
if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf-8');
    envConfig.split('\n').forEach(line => {
        const [key, ...values] = line.split('=');
        if (key && values.length > 0) {
            envVars[key.trim()] = values.join('=').trim();
            process.env[key.trim()] = values.join('=').trim();
        }
    });
}

let connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    console.error('DATABASE_URL not found');
    process.exit(1);
}

// Replace 'base' with '127.0.0.1'
if (connectionString.includes('@base')) {
    connectionString = connectionString.replace('@base', '@127.0.0.1');
}

console.log('Using connection string:', connectionString.replace(/:[^:@]*@/, ':****@')); // Mask password

const db = new Pool({ connectionString });

async function main() {
    try {
        console.log('Fetching billing_info...');
        const res = await db.query('SELECT workspace_id, plan FROM billing_info LIMIT 20');
        console.log('Billing Info:', res.rows);

        console.log('Fetching plans table...');
        const plans = await db.query('SELECT id, name FROM plans LIMIT 20');
        console.log('Plans Table:', plans.rows);

        console.log('Fetching workspaces...');
        const ws = await db.query('SELECT id, name FROM workspaces LIMIT 20');
        console.log('Workspaces:', ws.rows);

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await db.end();
    }
}

main();
