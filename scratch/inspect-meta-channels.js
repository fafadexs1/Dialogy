const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  await client.connect();

  console.log('--- COLUMNS FOR meta_channels ---');
  const cols = await client.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'meta_channels'
    ORDER BY ordinal_position;
  `);
  console.log(cols.rows);

  console.log('\n--- ROWS IN meta_channels ---');
  const rows = await client.query('SELECT * FROM meta_channels LIMIT 10');
  console.log(rows.rows);

  await client.end();
}

main().catch(console.error);
