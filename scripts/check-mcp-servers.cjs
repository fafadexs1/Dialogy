const { Pool } = require('c:/Users/fabri/Desktop/Dialogy-apps/Conexão/Dialogy/node_modules/pg');
require('dotenv').config({ path: 'c:/Users/fabri/Desktop/Dialogy-apps/Conexão/Dialogy/.env', quiet: true });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  const wsId = 'e3b476a1-5de8-4744-80b5-a5d23fe15fab';
  const row = (await pool.query("SELECT config FROM workspace_integrations WHERE workspace_id=$1 AND provider='mcp'", [wsId])).rows[0];
  console.log('MCP servers in workspace_integrations:');
  console.log(JSON.stringify(row?.config?.servers, null, 2));

  const catalog = (await pool.query("SELECT * FROM agent_tools_catalog WHERE workspace_id=$1", [wsId])).rows;
  console.log('\nAgent tools catalog:');
  for (const c of catalog) {
    console.log(`- ${c.name} (${c.qualified_name}) [server: ${c.server_name}]`);
  }
})().catch(console.error).finally(() => pool.end());
