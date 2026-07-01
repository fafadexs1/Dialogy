import { randomUUID } from 'node:crypto';

import { db } from '@/lib/db';
import { fingerprintToolOperation } from '@/services/agent-tools/action-fingerprint';
import type {
  AgentToolAction,
  AgentToolExecutionResult,
} from '@/services/agent-tools/types';

type ClaimDatabase = {
  query: (query: string, params?: unknown[]) => Promise<{
    rows: any[];
    rowCount?: number | null;
  }>;
};

export type DurableToolClaim =
  | {
      kind: 'execute';
      claimId: string;
      ownerToken: string;
      complete: (result: AgentToolExecutionResult) => Promise<void>;
    }
  | {
      kind: 'reuse';
      result: AgentToolExecutionResult;
    }
  | {
      kind: 'blocked';
      result: AgentToolExecutionResult;
    }
  | {
      kind: 'disabled';
    };

type ClaimInput = {
  workspaceId: string;
  chatId: string;
  orchestratorRunId?: string | null;
  action: AgentToolAction;
  toolName: string;
  idempotent: boolean;
  staleAfterMs?: number;
  database?: ClaimDatabase;
};

function boundedInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function parsePersistedResult(
  value: unknown,
  fallbackAction: AgentToolAction,
  fallbackToolName: string,
): AgentToolExecutionResult | null {
  let parsed = value;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (!['success', 'error', 'rejected'].includes(String(record.status))) return null;
  return {
    toolName: String(record.toolName || fallbackToolName) as AgentToolExecutionResult['toolName'],
    status: String(record.status) as AgentToolExecutionResult['status'],
    input: (
      record.input && typeof record.input === 'object'
        ? record.input
        : fallbackAction
    ) as AgentToolAction,
    output: (
      record.output && typeof record.output === 'object'
        ? record.output as Record<string, unknown>
        : null
    ),
    error: record.error == null ? null : String(record.error),
  };
}

function blockedResult(input: ClaimInput, code: 'in_progress' | 'uncertain') {
  const message = code === 'in_progress'
    ? '[tool_idempotency:in_progress] Esta operacao ja esta sendo processada. Nao vou executa-la em duplicidade.'
    : '[tool_idempotency:uncertain] A execucao anterior foi interrompida depois de iniciar e o resultado externo e incerto. Nao vou repetir esta acao automaticamente.';
  return {
    toolName: input.toolName as AgentToolExecutionResult['toolName'],
    status: 'error' as const,
    input: input.action,
    error: message,
  };
}

export async function claimDurableAgentToolExecution(
  input: ClaimInput,
): Promise<DurableToolClaim> {
  if (!input.orchestratorRunId) return { kind: 'disabled' };
  const database = input.database || db;
  const operationFingerprint = fingerprintToolOperation(input.action);
  const ownerToken = randomUUID();
  const staleAfterMs = boundedInteger(
    input.staleAfterMs ?? process.env.AUTOPILOT_TOOL_CLAIM_STALE_MS,
    10 * 60_000,
    30_000,
    60 * 60_000,
  );

  const source = await database.query(
    `SELECT source_message_id
       FROM orchestrator_runs
      WHERE id = $1
        AND workspace_id = $2
        AND chat_id = $3
      LIMIT 1`,
    [input.orchestratorRunId, input.workspaceId, input.chatId],
  );
  const sourceMessageId = source.rows[0]?.source_message_id;
  if (!sourceMessageId) return { kind: 'disabled' };

  const inserted = await database.query(
    `INSERT INTO autopilot_tool_execution_claims (
       workspace_id,
       chat_id,
       source_message_id,
       orchestrator_run_id,
       operation_fingerprint,
       tool_name,
       idempotent,
       status,
       owner_token,
       action,
       started_at,
       updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, 'claimed', $8, $9::jsonb,
       clock_timestamp(), clock_timestamp()
     )
     ON CONFLICT (source_message_id, operation_fingerprint) DO NOTHING
     RETURNING id`,
    [
      input.workspaceId,
      input.chatId,
      sourceMessageId,
      input.orchestratorRunId,
      operationFingerprint,
      input.toolName,
      input.idempotent,
      ownerToken,
      JSON.stringify(input.action),
    ],
  );

  const makeExecutableClaim = (claimId: string): DurableToolClaim => ({
    kind: 'execute',
    claimId,
    ownerToken,
    complete: async (result) => {
      await database.query(
        `UPDATE autopilot_tool_execution_claims
            SET status = $3,
                result = $4::jsonb,
                completed_at = clock_timestamp(),
                updated_at = clock_timestamp()
          WHERE id = $1
            AND owner_token = $2`,
        [claimId, ownerToken, result.status, JSON.stringify(result)],
      );
    },
  });

  if (inserted.rows[0]?.id) {
    return makeExecutableClaim(String(inserted.rows[0].id));
  }

  const existing = await database.query(
    `SELECT id, status, result,
            updated_at <= clock_timestamp() - ($3::int * interval '1 millisecond') AS stale
       FROM autopilot_tool_execution_claims
      WHERE source_message_id = $1
        AND operation_fingerprint = $2
      LIMIT 1`,
    [sourceMessageId, operationFingerprint, staleAfterMs],
  );
  const row = existing.rows[0];
  if (!row) return { kind: 'blocked', result: blockedResult(input, 'in_progress') };

  const persistedResult = parsePersistedResult(row.result, input.action, input.toolName);
  if (persistedResult) return { kind: 'reuse', result: persistedResult };

  if (row.status === 'claimed' && row.stale === true && input.idempotent) {
    const takeover = await database.query(
      `UPDATE autopilot_tool_execution_claims
          SET owner_token = $2,
              orchestrator_run_id = $3,
              started_at = clock_timestamp(),
              updated_at = clock_timestamp()
        WHERE id = $1
          AND status = 'claimed'
          AND updated_at <= clock_timestamp() - ($4::int * interval '1 millisecond')
        RETURNING id`,
      [row.id, ownerToken, input.orchestratorRunId, staleAfterMs],
    );
    if (takeover.rows[0]?.id) {
      return makeExecutableClaim(String(takeover.rows[0].id));
    }
  }

  if (row.status === 'claimed' && row.stale === true && !input.idempotent) {
    await database.query(
      `UPDATE autopilot_tool_execution_claims
          SET status = 'uncertain',
              completed_at = clock_timestamp(),
              updated_at = clock_timestamp()
        WHERE id = $1
          AND status = 'claimed'`,
      [row.id],
    );
    return { kind: 'blocked', result: blockedResult(input, 'uncertain') };
  }

  return {
    kind: 'blocked',
    result: blockedResult(input, row.status === 'uncertain' ? 'uncertain' : 'in_progress'),
  };
}
