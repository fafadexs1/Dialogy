const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const velpro = 'e3b476a1-5de8-4744-80b5-a5d23fe15fab';

  // 1. Show current status
  console.log('=== ANTES ===');
  const before = await c.query(
    "SELECT b.status, b.plan, w.name FROM billing_info b JOIN workspaces w ON w.id = b.workspace_id WHERE b.workspace_id = $1",
    [velpro]
  );
  console.log(JSON.stringify(before.rows[0], null, 2));

  // 2. Apply block
  console.log('\n=== APLICANDO BLOQUEIO (unpaid) ===');
  const result = await c.query(
    "UPDATE billing_info SET status = 'unpaid', updated_at = NOW() WHERE workspace_id = $1 RETURNING id, workspace_id, status, updated_at",
    [velpro]
  );
  console.log('Rows affected:', result.rowCount);
  console.log(JSON.stringify(result.rows[0], null, 2));

  // 3. Verify
  console.log('\n=== DEPOIS ===');
  const after = await c.query(
    "SELECT b.status, b.plan, w.name FROM billing_info b JOIN workspaces w ON w.id = b.workspace_id WHERE b.workspace_id = $1",
    [velpro]
  );
  console.log(JSON.stringify(after.rows[0], null, 2));

  await c.end();
}

main().catch(console.error);
