
import fs from 'fs';
import path from 'path';

// Load .env manually
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf-8');
    envConfig.split('\n').forEach(line => {
        const [key, ...values] = line.split('=');
        if (key && values.length > 0) {
            process.env[key.trim()] = values.join('=').trim();
        }
    });
}

import { db } from '../lib/db';

async function main() {
    try {
        console.log('Fetching billing_info...');
        const res = await db.query('SELECT workspace_id, plan FROM billing_info LIMIT 10');
        console.log('Billing Info:', res.rows);

        console.log('Fetching plans table...');
        const plans = await db.query('SELECT id, name FROM plans LIMIT 10');
        console.log('Plans Table:', plans.rows);

    } catch (error) {
        console.error('Error:', error);
    } finally {
        process.exit(0);
    }
}

main();
