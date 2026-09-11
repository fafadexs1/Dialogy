import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { upgradeVelproIdentification } from '@/modules/nexus/services/velpro-identification-upgrade';
import { WorkflowDefinitionSchema } from '@/services/workflow-runtime/schemas';
import { validateWorkflowDefinition } from '@/services/workflow-runtime/validator';

const workspaceId = 'e3b476a1-5de8-4744-80b5-a5d23fe15fab';
const workflowId = '77bc3879-e0eb-584f-b1bb-4ca1e640ab52';
const apply = process.argv.includes('--apply');

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 7000 });
  const client = await pool.connect();
  try {
    await client.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '10s'");
    const { rows } = await client.query(`SELECT draft_definition, published_revision, created_by FROM nexus_workflows WHERE workspace_id=$1 AND id=$2 ${apply ? 'FOR UPDATE' : ''}`, [workspaceId, workflowId]);
    if (rows.length !== 1) throw new Error('Fluxo Velpro Final não encontrado.');
    const before = WorkflowDefinitionSchema.parse(rows[0].draft_definition);
    const after = upgradeVelproIdentification(before);
    const validation = validateWorkflowDefinition(after);
    const baseline = validateWorkflowDefinition(before);
    const newErrors = validation.errors.filter(error => !baseline.errors.some(old => old.code === error.code && old.nodeId === error.nodeId && old.message === error.message));
    console.log(JSON.stringify({ valid: validation.valid, baselineErrors: baseline.errors, newErrors, warnings: validation.warnings,
      nodesBefore: before.nodes.length, nodesAfter: after.nodes.length, publishedRevision: rows[0].published_revision }));
    if (newErrors.length) throw new Error('A alteração introduziu erros de validação.');
    const file = resolve('docs/velpro-identification-draft.json');
    await writeFile(file, JSON.stringify(after, null, 2) + '\n');
    if (apply && before.metadata?.velproIdentificationVersion !== 3) {
      await client.query('UPDATE nexus_workflows SET draft_definition=$3::jsonb, updated_at=timezone(\'utc\',now()) WHERE workspace_id=$1 AND id=$2', [workspaceId, workflowId, JSON.stringify(after)]);
      await client.query(`INSERT INTO nexus_workflow_versions (nexus_workflow_id,workspace_id,revision,definition,description,source,created_by)
        SELECT $1,$2,COALESCE(MAX(revision),0)+1,$3::jsonb,$4,'save',$5 FROM nexus_workflow_versions WHERE nexus_workflow_id=$1`,
      [workflowId, workspaceId, JSON.stringify(after), 'Suporte identifica o contrato; suspensos e cancelados seguem ao Financeiro sem repetir a escolha. Aguardando deploy pelo Easypanel.', rows[0].created_by]);
    }
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    console.log(JSON.stringify({ savedDraft: apply, published: false, draftFile: file }));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); await pool.end(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Falha ao atualizar rascunho.'); process.exitCode = 1; });
