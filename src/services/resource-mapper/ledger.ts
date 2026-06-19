import { db } from '@/lib/db';
import type { ResourceMappingResult } from './types';

export type ResourceMappingLedgerInput = {
  workspaceId: string;
  chatId?: string | null;
  messageId?: string | null;
  orchestratorRunId?: string | null;
  procedureExecutionId?: string | null;
  procedureSessionId?: string | null;
  mapping: ResourceMappingResult;
  policyResult?: Record<string, unknown> | null;
};

function sanitizeJson(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function shouldSuppressDbError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('resource_mapping_ledger');
}

export async function recordResourceMappingLedger(input: ResourceMappingLedgerInput): Promise<void> {
  try {
    await db.query(
      `INSERT INTO resource_mapping_ledger (
        workspace_id,
        chat_id,
        message_id,
        orchestrator_run_id,
        procedure_session_id,
        resource,
        operation,
        status,
        confidence,
        mapped_fields_json,
        rejected_fields_json,
        payload_hash,
        policy_result_json,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        input.workspaceId,
        input.chatId ?? null,
        input.messageId ?? null,
        input.orchestratorRunId ?? null,
        input.procedureSessionId ?? input.procedureExecutionId ?? null,
        input.mapping.resource,
        input.mapping.operation,
        input.mapping.status,
        input.mapping.confidence,
        JSON.stringify(sanitizeJson(input.mapping.mappings)),
        JSON.stringify(sanitizeJson(input.mapping.rejected)),
        input.mapping.payloadHash ?? null,
        JSON.stringify(sanitizeJson(input.policyResult || {
          warnings: input.mapping.warnings,
          evidence: input.mapping.evidence,
        })),
        JSON.stringify(sanitizeJson({ procedureExecutionId: input.procedureExecutionId ?? null })),
      ],
    );
  } catch (error) {
    if (!shouldSuppressDbError(error)) {
      console.error('[RESOURCE_MAPPING_LEDGER] Failed to persist mapping ledger:', error);
    }
  }
}
