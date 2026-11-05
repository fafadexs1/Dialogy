import 'dotenv/config';
import { Pool } from 'pg';
import { writeFile, mkdir } from 'node:fs/promises';
import { createWorkflowNode } from '../src/services/workflow-runtime/catalog';
import { validateWorkflowDefinition } from '../src/services/workflow-runtime/validator';
import { WorkflowDefinitionSchema } from '../src/services/workflow-runtime/schemas';
const agentId = '23749803-7d16-404b-bc91-2ba2393c0358';
const workspaceId = 'e3b476a1-5de8-4744-80b5-a5d23fe15fab';
async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const agent = (await client.query('SELECT name,active_workflow_id,active_workflow_version FROM autopilot_configs WHERE id=$1 AND workspace_id=$2 FOR UPDATE', [agentId, workspaceId])).rows[0];
    if (!agent || agent.name !== 'Financeiro Sofia' || agent.active_workflow_version !== 'v1') throw new Error('A configuração mudou; nenhuma alteração aplicada.');
    const original = (await client.query('SELECT definition FROM workflow_definitions WHERE workflow_id=$1 AND workflow_version=$2 AND workspace_id=$3', [agent.active_workflow_id, agent.active_workflow_version, workspaceId])).rows[0]?.definition;
    if (!original) throw new Error('Workflow original não encontrado.');
    const workflow = WorkflowDefinitionSchema.parse(structuredClone(original));
    const team = (await client.query('SELECT id FROM teams WHERE workspace_id=$1 AND name=$2', [workspaceId, 'Financeiro'])).rows;
    if (team.length !== 1) throw new Error('Equipe financeira ambígua.');
    const memory = workflow.nodes.find((node) => node.id === 'shared_memory');
    const handoff = workflow.nodes.find((node) => node.id === 'primary_handoff');
    const error = workflow.nodes.find((node) => node.id === 'workflow_error');
    if (!memory || !handoff || !error) throw new Error('Estrutura do workflow mudou.');
    memory.config = { provider: 'dialogy', scope: 'hybrid', maxMessages: 20, maxAgeDays: 180 };
    handoff.config = { ...handoff.config, teamId: String(team[0].id), destinationType: 'human', requireConfirmation: false };
    const end = createWorkflowNode('output.end', { id: 'sofia_error_end', position: { x: 1200, y: 800 } });
    workflow.nodes.push(end);
    workflow.connections.push({ id: 'sofia_error_end_route', sourceNodeId: error.id, sourcePortId: 'failed', targetNodeId: end.id, targetPortId: 'main', connectionType: 'main' });
    workflow.version = `v1-repair-${Date.now()}`;
    workflow.updatedAt = new Date().toISOString();
    const validation = validateWorkflowDefinition(workflow);
    if (!validation.valid) throw new Error(JSON.stringify(validation.errors));
    await mkdir('artifacts/agents', { recursive: true });
    await writeFile('artifacts/agents/sofia-workflow-before-repair.json', JSON.stringify(original, null, 2));
    await writeFile('artifacts/agents/sofia-workflow-repaired.json', JSON.stringify(workflow, null, 2));
    if (process.argv.includes('--apply')) {
      await client.query('INSERT INTO workflow_definitions(workflow_id,workflow_version,workspace_id,name,status,definition,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8)', [workflow.id,workflow.version,workspaceId,workflow.name,workflow.status,JSON.stringify(workflow),workflow.createdAt,workflow.updatedAt]);
      await client.query('UPDATE autopilot_configs SET active_workflow_version=$3,updated_at=now() WHERE id=$1 AND workspace_id=$2', [agentId,workspaceId,workflow.version]);
    }
    await client.query('COMMIT');
    console.log(JSON.stringify({ valid: true, applied: process.argv.includes('--apply'), previousVersion: agent.active_workflow_version, version: workflow.version }));
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); await pool.end(); }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
