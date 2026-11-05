import 'dotenv/config';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { createAuroraSalesAgent } from '../src/modules/nexus/services/aurora-sales-agent';
import { validateAgentForPublication } from '../src/services/agent-studio/assistant-validator';

const workspaceId = '5c3a91e9-b243-4436-80ba-42434bc5ca97';
const agentId = 'bc053c26-6c89-4415-96bf-16592252afca';
async function main() {
  const document = createAuroraSalesAgent({ id: agentId, workspaceId, handoffTeam: 'Dialogy Comercial' });
  const validation = validateAgentForPublication(document);
  if (!validation.valid) throw new Error(JSON.stringify(validation.issues));
  const directory = resolve('artifacts/workflows/aurora-work'); await mkdir(directory, { recursive: true });
  const refresh = process.argv.includes('--refresh-own-draft');
  const expected = refresh ? JSON.parse(await readFile(resolve(directory, 'nina-studio-agent.json'), 'utf8')) : null;
  if (!process.argv.includes('--save-draft') && !refresh) { await writeFile(resolve(directory, 'nina-studio-agent.json'), JSON.stringify(document, null, 2)); console.log(JSON.stringify({ agentId, valid: true, proposals: document.resolveStage.procedures.length, saved: false })); return; }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 }); const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const workspace = (await client.query('SELECT id,name,owner_id FROM workspaces WHERE id=$1 FOR UPDATE', [workspaceId])).rows[0];
    if (!workspace || workspace.name !== 'Dialogy') throw new Error('Workspace diferente do autorizado.');
    const existing = await client.query('SELECT id,name FROM autopilot_configs WHERE id=$1 AND workspace_id=$2', [agentId, workspaceId]);
    if (existing.rowCount && refresh) {
      document.draftRevision = Number(expected.draftRevision) + 1;
      const updated = await client.query(`UPDATE autopilot_config_drafts d SET snapshot=jsonb_set(d.snapshot,'{agent_studio_document}',$4::jsonb),updated_at=now()
        FROM autopilot_configs c WHERE d.config_id=$1 AND d.workspace_id=$2 AND c.id=d.config_id AND c.workspace_id=d.workspace_id AND c.is_private AND NOT c.is_active AND c.user_id=$3
        AND d.snapshot->'agent_studio_document'=$5::jsonb`, [agentId, workspaceId, workspace.owner_id, JSON.stringify(document), JSON.stringify(expected)]);
      if (updated.rowCount !== 1) throw new Error('O rascunho mudou; nenhuma alteração foi sobrescrita.');
      await client.query('COMMIT'); await writeFile(resolve(directory, 'nina-studio-agent.json'), JSON.stringify(document, null, 2));
      console.log(JSON.stringify({ agentId, updated: true, private: true, active: false, published: false })); return;
    }
    if (existing.rowCount) { await client.query('ROLLBACK'); console.log(JSON.stringify({ existingPreserved: true, agent: existing.rows[0] })); return; }
    document.draftRevision = 1;
    await client.query(`INSERT INTO autopilot_configs(id,workspace_id,user_id,name,is_primary,is_private,is_active,ai_model) VALUES($1,$2,$3,$4,false,true,false,$5)`, [agentId, workspaceId, workspace.owner_id, document.name, document.aiModel]);
    await client.query(`INSERT INTO autopilot_config_drafts(config_id,workspace_id,user_id,snapshot,updated_at) VALUES($1,$2,$3,$4::jsonb,now())`, [agentId, workspaceId, workspace.owner_id, JSON.stringify({ name: document.name, ai_model: document.aiModel, is_active: false, is_private: true, agent_studio_document: document })]);
    await client.query('COMMIT');
    await writeFile(resolve(directory, 'nina-studio-agent.json'), JSON.stringify(document, null, 2));
    console.log(JSON.stringify({ agentId, workspaceId, name: document.name, private: true, active: false, published: false, path: `/autopilot/${agentId}` }));
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); await pool.end(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Falha ao preparar a Nina.'); process.exitCode = 1; });
