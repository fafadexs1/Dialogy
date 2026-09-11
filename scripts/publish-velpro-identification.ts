import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { db } from '@/lib/db';
import { validateNexusWorkflowCredentialBindings } from '@/modules/nexus/services/credentials';
import { validateNexusWorkflowDialogyBindings } from '@/modules/nexus/services/dialogy-resources';
import { bindStandaloneNexusWorkflow } from '@/modules/nexus/services/standalone-workflows';
import { cancelPublishedNexusWorkflowExecution } from '@/modules/nexus/services/runtime';
import { WorkflowDefinitionSchema } from '@/services/workflow-runtime/schemas';
import { validateWorkflowDefinition } from '@/services/workflow-runtime/validator';
import { PostgresWorkflowPersistence } from '@/services/workflow-runtime/postgres-persistence';

// Administrative publication requested by the workspace owner, after Easypanel deploy.
// This bounded script accepts only the reviewed Velpro v3 draft, never arbitrary flows.
const workspaceId = 'e3b476a1-5de8-4744-80b5-a5d23fe15fab';
const workflowId = '77bc3879-e0eb-584f-b1bb-4ca1e640ab52';
const apply = process.argv.includes('--apply');
async function main() {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM nexus_workflows WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [workspaceId, workflowId]);
    const row = rows[0];
    if (!row || Number(row.published_revision) !== 18) throw new Error('A revisão publicada mudou; confira antes de continuar.');
    const draft = bindStandaloneNexusWorkflow({ definition: WorkflowDefinitionSchema.parse(row.draft_definition), id: workflowId, workspaceId });
    if (draft.metadata?.velproIdentificationVersion !== 3 || draft.nodes.length !== 70) throw new Error('O rascunho não corresponde à versão revisada.');
    if (draft.nodes.some(n => n.type.startsWith('ai.') || n.type === 'integration.google_ads_lead' || n.config.crmOptionTrigger)) throw new Error('O rascunho ganhou vínculos não contemplados nesta publicação.');
    const validation = validateWorkflowDefinition(draft);
    if (!validation.valid) throw new Error(validation.errors.map(e => e.message).join(' '));
    const [credentials, bindings] = await Promise.all([
      validateNexusWorkflowCredentialBindings({ workspaceId, definition: draft }),
      validateNexusWorkflowDialogyBindings({ workspaceId, definition: draft }),
    ]);
    if (!credentials.valid || !bindings.valid) throw new Error('Vínculos de credenciais/equipes inválidos.');
    const active = await client.query("SELECT id FROM workflow_executions WHERE workspace_id=$1 AND workflow_id=$2 AND workflow_version<>$3 AND status IN ('queued','running','waiting')", [workspaceId, draft.id, 'v19']);
    console.log(JSON.stringify({ validated: true, revision: 19, nodes: draft.nodes.length, supersededExecutions: active.rowCount, apply }));
    if (!apply) { await client.query('ROLLBACK'); return; }
    const timestamp = new Date().toISOString();
    const published = WorkflowDefinitionSchema.parse({ ...draft, version: 'v19', status: 'published', updatedAt: timestamp });
    await new PostgresWorkflowPersistence(client).saveWorkflowDefinition(published);
    await client.query(`UPDATE nexus_workflows SET status='published',draft_definition=$3::jsonb,published_workflow_id=$4,published_workflow_version='v19',published_revision=19,published_at=$5,updated_at=$5 WHERE workspace_id=$1 AND id=$2`, [workspaceId, workflowId, JSON.stringify(draft), published.id, timestamp]);
    await client.query(`INSERT INTO nexus_workflow_versions (nexus_workflow_id,workspace_id,revision,published_revision,definition,description,source,created_by)
      SELECT $1,$2,COALESCE(MAX(revision),0)+1,19,$3::jsonb,$4,'publish',$5 FROM nexus_workflow_versions WHERE nexus_workflow_id=$1`,
    [workflowId, workspaceId, JSON.stringify(published), 'Publicação v19 autorizada pelo proprietário: CPF/CNPJ, contrato e roteamento Suporte/Financeiro. Deploy PDC-1.83 confirmado no Easypanel.', row.created_by]);
    await client.query('COMMIT');
    const cancellations = await Promise.allSettled(active.rows.map(execution => cancelPublishedNexusWorkflowExecution({ workspaceId, executionId: execution.id, reason: 'Execução substituída pela publicação v19.' })));
    const evidence = { publishedAt: timestamp, workspaceId, workflowId, version: 'v19', nodes: 70,
      deploy: 'PDC-1.83', supersededExecutions: cancellations.filter(r => r.status === 'fulfilled').length,
      cancellationFailures: cancellations.filter(r => r.status === 'rejected').length };
    await writeFile('docs/velpro-identification-publication.json', JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify(evidence));
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); await db.end(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Falha na publicação'); process.exitCode = 1; });
