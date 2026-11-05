import { createHash } from 'crypto';
import type { PoolClient } from 'pg';

export type TransferIntent = {
  chatId: string; teamId?: string; agentId?: string;
  expectedAgentId?: string | null; expectedTeamId?: string | null;
  expectedSystemAgentId?: string | null; handoffSummary?: string;
  sourceTeamId?: string; suppressTransferNotice?: boolean;
};
export function transferIntentHash(intent: TransferIntent): string {
  return createHash('sha256').update(JSON.stringify([
    intent.chatId, intent.teamId ?? null, intent.agentId ?? null,
    intent.expectedAgentId === undefined ? {unset:true} : intent.expectedAgentId,
    intent.expectedTeamId === undefined ? {unset:true} : intent.expectedTeamId,
    intent.expectedSystemAgentId === undefined ? {unset:true} : intent.expectedSystemAgentId, intent.handoffSummary ?? null,
    intent.sourceTeamId ?? null, intent.suppressTransferNotice === true,
  ])).digest('hex');
}

/** Acquired before chat/user row locks, including self/direct assignments. */
export async function lockWorkspaceAssignments(client: PoolClient, workspaceId: string) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('chat-assignment'), hashtext($1))`, [workspaceId]);
}

export async function readTransferOperation(client: PoolClient, workspaceId: string, actorId: string, operationId: string, requestHash: string) {
  const { rows } = await client.query(`SELECT * FROM chat_transfer_operations
    WHERE workspace_id=$1 AND actor_id=$2 AND operation_id=$3 FOR UPDATE`, [workspaceId,actorId,operationId]);
  const row = rows[0];
  if (!row) return null;
  if (row.request_hash !== requestHash) return { conflict: true as const };
  await client.query(`UPDATE chat_transfer_operations SET replay_count=replay_count+1
    WHERE workspace_id=$1 AND actor_id=$2 AND operation_id=$3`, [workspaceId,actorId,operationId]);
  return { conflict: false as const, outcome: row.outcome as 'assigned' | 'no_op',
    assignedAgent: { id: String(row.agent_id), name: String(row.agent_name) } };
}

export async function saveTransferOperation(client: PoolClient, input: {
  workspaceId: string; actorId: string; operationId: string; requestHash: string;
  chatId: string; outcome: 'assigned' | 'no_op'; agentId: string; agentName: string;
  teamId: string | null; eventId?: string | null;
  preconditions?: Record<string, unknown>;
}) {
  await client.query(`INSERT INTO chat_transfer_operations
    (workspace_id,actor_id,operation_id,request_hash,chat_id,outcome,agent_id,agent_name,team_id,event_id,preconditions)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [input.workspaceId,input.actorId,input.operationId,
    input.requestHash,input.chatId,input.outcome,input.agentId,input.agentName,input.teamId,input.eventId ?? null,input.preconditions ?? {}]);
}
