import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { createStandaloneNexusWorkflow } from '../src/modules/nexus/services/standalone-workflows';
import { validateWorkflowDefinition } from '../src/services/workflow-runtime/validator';

// Explicitly requested fictional demo in Dialogy. Never publish, migrate or change an existing flow.
const workspaceId = '5c3a91e9-b243-4436-80ba-42434bc5ca97';
const name = 'Aurora Work · Vendas fictícias com DeepSeek';
const saveDraft = process.argv.includes('--save-draft');
async function main() {
  const id = randomUUID();
  const definition = createStandaloneNexusWorkflow({ id, workspaceId, name, template: 'sales_demo' });
  const validation = validateWorkflowDefinition(definition);
  if (!validation.valid) throw new Error(JSON.stringify(validation.errors));
  const directory = resolve('artifacts/workflows/aurora-work'); await mkdir(directory, { recursive: true });
  if (!saveDraft) { await writeFile(resolve(directory, 'workflow.json'), JSON.stringify(definition, null, 2)); console.log(JSON.stringify({ artifact: resolve(directory, 'workflow.json'), nodes: definition.nodes.length, valid: true, savedToWorkspace: false })); return; }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`aurora-demo:${workspaceId}`]);
    const workspace = (await client.query(`SELECT w.id,w.name,w.owner_id,u.full_name FROM workspaces w JOIN users u ON u.id=w.owner_id WHERE w.id=$1 FOR SHARE OF w`, [workspaceId])).rows[0];
    if (!workspace || workspace.name !== 'Dialogy' || !workspace.owner_id) throw new Error('O workspace divergiu do autorizado.');
    // Workspace ownership is the same implicit manager permission used by the application.
    const existing = (await client.query(`SELECT id,status,name,draft_definition FROM nexus_workflows WHERE workspace_id=$1 AND draft_definition->'metadata'->>'demoKey'='aurora-work-sales-v1'`, [workspaceId])).rows;
    if (existing.length) {
      await client.query('ROLLBACK');
      if (existing.length !== 1) throw new Error('Há mais de um exemplo. Nenhum workflow foi alterado.');
      await writeFile(resolve(directory, 'workflow.json'), JSON.stringify(existing[0].draft_definition, null, 2));
      console.log(JSON.stringify({ existingDraftPreserved: true, id: existing[0].id, status: existing[0].status, name: existing[0].name })); return;
    }
    await client.query(`INSERT INTO nexus_workflows(id,workspace_id,created_by,name,description,status,draft_definition) VALUES($1,$2,$3,$4,$5,'draft',$6::jsonb)`, [id, workspaceId, workspace.owner_id, name, 'Demonstração fictícia completa: qualificação, catálogo, objeções, proposta, confirmação e follow-up com consentimento. Pedidos, CRM e encaminhamento simulados. Vincular credencial DeepSeek depois.', JSON.stringify(definition)]);
    await client.query(`INSERT INTO nexus_workflow_versions(nexus_workflow_id,workspace_id,revision,definition,description,source,created_by) VALUES($1,$2,1,$3::jsonb,$4,'create',$5)`, [id, workspaceId, JSON.stringify(definition), 'Rascunho fictício criado a pedido do usuário. Sem publicação ou execução externa.', workspace.owner_id]);
    const verified = (await client.query(`SELECT id,name,status,published_workflow_id,published_revision,jsonb_array_length(draft_definition->'nodes') AS nodes FROM nexus_workflows WHERE workspace_id=$1 AND id=$2`, [workspaceId, id])).rows[0];
    if (verified?.status !== 'draft' || verified.published_workflow_id || Number(verified.published_revision) !== 0) throw new Error('Estado do novo rascunho inválido.');
    await client.query('COMMIT');
    await writeFile(resolve(directory, 'workflow.json'), JSON.stringify(definition, null, 2));
    await writeFile(resolve(directory, 'workspace-draft.json'), JSON.stringify({ ...verified, workspaceId, path: `/nexus/flows/${id}`, published: false, externallyExecuted: false }, null, 2));
    console.log(JSON.stringify({ ...verified, workspaceId, path: `/nexus/flows/${id}`, externallyExecuted: false }));
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); await pool.end(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Falha ao preparar rascunho.'); process.exitCode = 1; });
