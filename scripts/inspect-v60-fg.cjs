const { Pool } = require('pg');
require('dotenv').config({ quiet: true });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
(async () => {
  const row = (await pool.query("SELECT snapshot FROM autopilot_config_versions WHERE config_id='7d7259ab-a6c3-4057-a9ca-28ddbb15db95' AND version_number=60")).rows[0];
  const fg = row.snapshot.flow_graph;
  console.log('Flow graph keys:', Object.keys(fg));
  console.log('Nodes count:', fg.nodes?.length);
  for (const n of fg.nodes || []) {
    console.log(`Node: id=${n.id}, type=${n.type}, label=${n.data?.label || n.data?.name || n.label}, tools=${JSON.stringify(n.data?.tools || n.data?.toolNames || n.data?.enabled_tools || [])}`);
  }
})().catch(console.error).finally(() => pool.end());
