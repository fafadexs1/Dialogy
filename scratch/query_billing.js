const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const velpro = 'e3b476a1-5de8-4744-80b5-a5d23fe15fab';

  // 1. Check billing_info table schema
  console.log('=== 1. SCHEMA billing_info ===');
  try {
    const r = await c.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'billing_info' ORDER BY ordinal_position"
    );
    r.rows.forEach(row => console.log(`  ${row.column_name} (${row.data_type})`));
  } catch (e) {
    console.log('Erro:', e.message);
  }

  // 2. Check Velpro billing status
  console.log('\n=== 2. BILLING_INFO DA VELPRO ===');
  try {
    const r = await c.query(
      "SELECT * FROM billing_info WHERE workspace_id = $1",
      [velpro]
    );
    console.log('Rows:', r.rowCount);
    r.rows.forEach(row => console.log(JSON.stringify(row, null, 2)));
  } catch (e) {
    console.log('Erro:', e.message);
  }

  // 3. Check Velpro workspace details
  console.log('\n=== 3. WORKSPACE VELPRO ===');
  try {
    const r = await c.query(
      "SELECT id, name, plan, custom_limits, created_at, updated_at FROM workspaces WHERE id = $1",
      [velpro]
    );
    r.rows.forEach(row => console.log(JSON.stringify(row, null, 2)));
  } catch (e) {
    console.log('Erro:', e.message);
  }

  // 4. All billing statuses 
  console.log('\n=== 4. TODOS OS BILLING_INFO ===');
  try {
    const r = await c.query(
      "SELECT b.workspace_id, b.status, b.plan, w.name as workspace_name FROM billing_info b LEFT JOIN workspaces w ON w.id = b.workspace_id"
    );
    r.rows.forEach(row => console.log(JSON.stringify(row)));
  } catch (e) {
    console.log('Erro:', e.message);
  }

  await c.end();
}

main().catch(console.error);
