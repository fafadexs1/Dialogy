const { Client } = require('pg');
require('dotenv').config();
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query(
    "UPDATE billing_info SET status = 'active', updated_at = NOW() WHERE workspace_id = 'e3b476a1-5de8-4744-80b5-a5d23fe15fab' RETURNING status, updated_at"
  );
  console.log('Velpro desbloqueada:', JSON.stringify(r.rows[0]));
  await c.end();
})();
