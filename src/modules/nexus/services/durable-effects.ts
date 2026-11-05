import 'server-only';
import { db } from '@/lib/db';
import { hashValue } from '@/services/workflow-runtime/utils';
import type { NodeRuntimeInput } from '@/services/workflow-runtime/types';
import { encryptPayload, decryptPayload } from './credentials';

export function nodeInvocationKey(input: NodeRuntimeInput): string {
  const previous = input.execution.nodeResults[input.node.id];
  if (previous?.status === 'waiting' && typeof previous.output?.invocationId === 'string') return previous.output.invocationId;
  return `automation_${hashValue({ execution: input.execution.executionId, node: input.node.id, step: input.execution.totalSteps })}`;
}

/** Write intent before dispatch. An interrupted or failed external write is never silently replayed. */
export async function executeDurableEffect<T extends Record<string, unknown>>(workspaceId: string, id: string, args: unknown, operation: () => Promise<T>): Promise<T> {
  const hash = hashValue(args);
  const inserted = await db.query(`INSERT INTO nexus_automation_effects(id,workspace_id,arguments_hash) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id`, [id, workspaceId, hash]);
  if (!inserted.rowCount) {
    const { rows } = await db.query(`SELECT arguments_hash,encrypted_result FROM nexus_automation_effects WHERE workspace_id=$1 AND id=$2`, [workspaceId, id]);
    if (rows[0]?.arguments_hash !== hash || !rows[0]?.encrypted_result) throw Object.assign(new Error('O resultado desta operação externa é incerto. Reconcilie antes de tentar novamente.'), { code: 'EXTERNAL_OUTCOME_UNKNOWN', retryable: false });
    return decryptPayload(String(rows[0].encrypted_result)) as T;
  }
  const result = await operation();
  await db.query(`UPDATE nexus_automation_effects SET encrypted_result=$3 WHERE workspace_id=$1 AND id=$2`, [workspaceId, id, encryptPayload(result)]);
  return result;
}
