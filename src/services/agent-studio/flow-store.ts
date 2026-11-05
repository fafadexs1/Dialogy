import 'server-only';
import { db } from '@/lib/db';
import { decryptWithKey, encryptWithKey } from '@/lib/security/secret-box';
import type { StudioFlowState } from './flow-execution';

const envName = 'WORKSPACE_CREDENTIALS_ENCRYPTION_KEY';
const key = () => process.env[envName] || process.env.META_PAYLOAD_ENCRYPTION_KEY;
export type StudioFlowScope = { workspaceId: string; invocationId: string; workflowId: string; executionId: string; nodeId: string; agentId: string; releaseId: string };

export async function studioFlowInvocationStore(scope: StudioFlowScope) {
  const { rows } = await db.query('SELECT encrypted_state, revision, release_id, status FROM studio_flow_invocations WHERE workspace_id=$1 AND invocation_id=$2', [scope.workspaceId, scope.invocationId]);
  const row = rows[0];
  if (row && String(row.release_id) !== scope.releaseId) throw new Error('A invocação pertence a outra versão.');
  if (row?.status === 'cancelled') throw new Error('A invocação foi cancelada.');
  let revision = row ? Number(row.revision) : -1;
  if (!row) {
    const uncertain = await db.query('SELECT 1 FROM studio_flow_invocations WHERE workspace_id=$1 AND execution_id=$2 AND node_id=$3 AND outcome_unknown LIMIT 1', [scope.workspaceId, scope.executionId, scope.nodeId]);
    if (uncertain.rows.length) throw new Error('Uma invocação anterior deste bloco ficou sem confirmação. Revise antes de repetir.');
  }
  const state = row ? JSON.parse(decryptWithKey(String(row.encrypted_state), key(), envName)) as StudioFlowState : undefined;
  const checkpoint = async (next: StudioFlowState) => {
    if (next.releaseId !== scope.releaseId) throw new Error('A invocação não pertence à versão fixada.');
    const serialized = JSON.stringify(next);
    if (Buffer.byteLength(serialized, 'utf8') > 1000000) throw new Error('A invocação excedeu o limite de dados. Reduza os resultados das ferramentas.');
    const unknown = Object.values(next.operations).some((operation) => operation.status === 'running') || Object.values(next.children).some((child) => child && typeof child === 'object' && Boolean((child as { inFlight?: unknown }).inFlight));
    const encrypted = encryptWithKey(serialized, key(), envName);
    if (revision < 0) {
      const created = await db.query(`INSERT INTO studio_flow_invocations(workspace_id,invocation_id,workflow_id,execution_id,node_id,agent_id,release_id,status,encrypted_state,outcome_unknown)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING RETURNING revision`, [scope.workspaceId,scope.invocationId,scope.workflowId,scope.executionId,scope.nodeId,scope.agentId,scope.releaseId,next.status,encrypted,unknown]);
      if (!created.rowCount) throw new Error('Outra execução iniciou esta invocação.');
      revision = 0;
    } else {
      const saved = await db.query(`UPDATE studio_flow_invocations SET encrypted_state=$3,status=$4,outcome_unknown=$6,revision=revision+1,updated_at=now()
        WHERE workspace_id=$1 AND invocation_id=$2 AND revision=$5 AND status<>'cancelled' RETURNING revision`, [scope.workspaceId,scope.invocationId,encrypted,next.status,revision,unknown]);
      if (!saved.rowCount) throw new Error('A invocação foi alterada ou cancelada.');
      revision = Number(saved.rows[0].revision);
    }
  };
  return { state, checkpoint };
}

export async function cancelStudioFlowInvocations(workspaceId: string, executionId: string) {
  await db.query(`UPDATE studio_flow_invocations SET status='cancelled',revision=revision+1,updated_at=now()
    WHERE workspace_id=$1 AND execution_id=$2 AND status IN ('running','needs_input')`, [workspaceId, executionId]);
}
