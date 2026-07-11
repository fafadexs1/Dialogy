const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  await client.connect();
  
  try {
    console.log('--- meta_channels table schema ---');
    const cols = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'meta_channels'
      AND table_schema = 'public'
    `);
    console.log(cols.rows);

    console.log('\n--- meta_channels content ---');
    const content = await client.query(`
      SELECT * FROM public.meta_channels
    `);
    console.log(content.rows);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
