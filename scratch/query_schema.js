const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  // Discover table columns
  const tables = ['evolution_webhook_events', 'messages', 'contacts', 'chats', 'evolution_api_instances'];
  for (const t of tables) {
    console.log(`\n=== COLUMNS OF ${t} ===`);
    try {
      const r = await c.query(
        "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position",
        [t]
      );
      r.rows.forEach(row => console.log(`  ${row.column_name} (${row.data_type})`));
    } catch (e) {
      console.log('  Error:', e.message);
    }
  }

  await c.end();
}

main().catch(console.error);
