import { Pool } from 'pg';
import 'dotenv/config';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  const client = await pool.connect();
  try {
    console.log('--- BUSCANDO DADOS REAIS NO SUPABASE ---');

    // 1. Buscar Workspace ativo
    const workspaces = await client.query('SELECT id, name FROM workspaces LIMIT 1');
    const workspace = workspaces.rows[0];
    if (!workspace) {
      console.error('Nenhum workspace encontrado.');
      return;
    }
    console.log(`Workspace encontrado: ID="${workspace.id}" Nome="${workspace.name}"`);

    // 2. Buscar System Agent (Autopilot Agent) vinculado ao workspace
    const agents = await client.query(
      "SELECT id, name FROM system_agents WHERE workspace_id = $1 LIMIT 1",
      [workspace.id]
    );
    const agent = agents.rows[0];
    console.log('Agente de Sistema encontrado:', agent || 'Nenhum');

    // 3. Buscar Autopilot Config ativa
    const configs = await client.query(
      "SELECT id, name, copilot_mode FROM autopilot_configs WHERE workspace_id = $1 LIMIT 1",
      [workspace.id]
    );
    const config = configs.rows[0];
    console.log('Configuração Autopilot encontrada:', config || 'Nenhuma');

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
