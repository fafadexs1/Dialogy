import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { auroraConversationalWorkflow } from '../src/modules/nexus/services/aurora-conversational-workflow';
import { WorkflowDefinitionSchema } from '../src/services/workflow-runtime/schemas';
import { validateWorkflowDefinition } from '../src/services/workflow-runtime/validator';

const workspaceId = '5c3a91e9-b243-4436-80ba-42434bc5ca97', workflowId = '79962002-b803-4bac-b549-98fb5607f19f', agentId = 'bc053c26-6c89-4415-96bf-16592252afca';
async function main() {
  const directory = resolve('artifacts/workflows/aurora-work'); await mkdir(directory, { recursive: true });
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 }); const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = (await client.query('SELECT w.*,s.owner_id FROM nexus_workflows w JOIN workspaces s ON s.id=w.workspace_id WHERE w.id=$1 AND w.workspace_id=$2 FOR UPDATE OF w', [workflowId, workspaceId])).rows[0];
    if (!current || current.status !== 'draft' || Number(current.published_revision) || current.published_workflow_id) throw new Error('O alvo não é mais o rascunho fictício autorizado.');
    const release = (await client.query(`SELECT v.snapshot->'agent_release_manifest' AS manifest FROM autopilot_config_versions v JOIN autopilot_configs a ON a.id=v.config_id AND a.workspace_id=v.workspace_id WHERE v.config_id=$1 AND v.workspace_id=$2 AND a.is_private AND a.is_active AND a.user_id=$3 ORDER BY v.version_number DESC LIMIT 1`, [agentId, workspaceId, current.owner_id])).rows[0]?.manifest;
    if (!release?.releaseId || release.agentId !== agentId || release.workspaceId !== workspaceId) throw new Error('A Nina ainda não tem uma versão privada e ativa neste workspace.');
    const previous = WorkflowDefinitionSchema.parse(current.draft_definition);
    const alreadyConversational = previous.nodes.some(node => node.id === 'aurora_nina_studio');
    const refreshBudgets = process.argv.includes('--refresh-budgets');
    const definition = WorkflowDefinitionSchema.parse(alreadyConversational && refreshBudgets
      ? { ...previous, settings: { ...previous.settings, maxTotalInputTokens: 500000, maxTotalOutputTokens: 64000 } }
      : auroraConversationalWorkflow(previous, agentId, release.releaseId));
    const validation = validateWorkflowDefinition(definition); if (!validation.valid) throw new Error(JSON.stringify(validation.errors));
    await writeFile(resolve(directory, 'workflow-conversational.json'), JSON.stringify(definition, null, 2));
    await writeFile(resolve(directory, 'nina-studio-release.json'), JSON.stringify(release, null, 2));
    if (!process.argv.includes('--replace-draft')) { await client.query('ROLLBACK'); console.log(JSON.stringify({ valid: true, workflowId, agentId, releaseId: release.releaseId, nodes: definition.nodes.length, saved: false })); return; }
    if (alreadyConversational && !refreshBudgets) { await client.query('ROLLBACK'); console.log(JSON.stringify({ existingConversationPreserved: true, workflowId })); return; }
    if (!alreadyConversational) await writeFile(resolve(directory, 'workflow-guided-reference.json'), JSON.stringify(previous, null, 2));
    await client.query(`UPDATE nexus_workflows SET name=$3,description=$4,draft_definition=$5::jsonb,updated_at=now() WHERE id=$1 AND workspace_id=$2`, [workflowId, workspaceId, definition.name, 'A Nina publicada no IA Studio conduz uma conversa livre, consulta catálogo e propostas aprovadas e pede confirmação somente da simulação. Sem menus obrigatórios ou efeitos externos reais.', JSON.stringify(definition)]);
    await client.query(`INSERT INTO nexus_workflow_versions(nexus_workflow_id,workspace_id,revision,definition,description,source,created_by) SELECT $1,$2,COALESCE(MAX(revision),0)+1,$3::jsonb,$4,'save',$5 FROM nexus_workflow_versions WHERE nexus_workflow_id=$1`, [workflowId, workspaceId, JSON.stringify(definition), 'Conversa livre com a Nina do IA Studio. Fluxo guiado preservado no histórico; workflow permanece sem publicação.', current.owner_id]);
    await client.query('COMMIT');
    console.log(JSON.stringify({ workflowId, agentId, releaseId: release.releaseId, status: 'draft', nodes: 2, menus: 0, publishedRevision: 0, previousVersionPreserved: true }));
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); await pool.end(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Falha ao preparar conversa.'); process.exitCode = 1; });
