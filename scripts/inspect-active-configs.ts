import { Pool } from 'pg';
import 'dotenv/config';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  const client = await pool.connect();
  try {
    console.log('--- BUSCANDO CONFIGURAÇÕES ATIVAS ---');

    console.log('\n1. WORKSPACES:');
    const workspaces = await client.query('SELECT id, name FROM workspaces');
    console.table(workspaces.rows);

    console.log('\n2. AUTOPILOT CONFIGS:');
    const configs = await client.query('SELECT id, name, is_active, workspace_id FROM autopilot_configs');
    console.table(configs.rows);

    console.log('\n3. SYSTEM AGENTS:');
    const agents = await client.query('SELECT id, name, type, is_active, autopilot_config_id, workspace_id FROM system_agents');
    console.table(agents.rows);

    console.log('\n4. CHATS RECENTES COM AUTOPILOT ATIVO:');
    const chats = await client.query(`
      SELECT c.id, c.workspace_id, c.is_autopilot_active, c.status, c.assigned_system_agent_id, ct.name as contact_name
      FROM chats c
      LEFT JOIN contacts ct ON ct.id = c.contact_id
      ORDER BY c.created_at DESC LIMIT 10
    `);
    console.table(chats.rows);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
