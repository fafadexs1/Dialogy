const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  await client.connect();

  console.log('--- TABLES ---');
  const tables = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name LIKE '%meta_whatsapp%'
    ORDER BY table_name;
  `);
  console.log(tables.rows);

  for (const row of tables.rows) {
    const tableName = row.table_name;
    console.log(`\n--- COLUMNS FOR ${tableName} ---`);
    const cols = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
      ORDER BY ordinal_position;
    `, [tableName]);
    console.log(cols.rows);
  }

  await client.end();
}

main().catch(console.error);
