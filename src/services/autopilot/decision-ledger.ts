import { db } from '@/lib/db';

export type AgentDecisionType =
  | 'answer'
  | 'ask_slot'
  | 'retrieve_knowledge'
  | 'call_tool'
  | 'wait_confirmation'
  | 'handoff'
  | 'close'
  | 'fallback'
  | 'continue_llm';

export type DecisionEvidence = {
  source: string;
  reason: string;
  confidence?: number | null;
};

export type BlockedToolDecision = {
  toolName: string;
  reason: string;
  missingSlots?: string[];
};

export type DecisionLedgerEntry = {
  workspaceId: string;
  chatId?: string | null;
  messageId?: string | null;
  runId?: string | null;
  systemAgentId?: string | null;
  autopilotConfigId?: string | null;
  procedureExecutionId?: string | null;
  procedureSessionId?: string | null;
  decisionStage: string;
  decisionType: AgentDecisionType;
  goal?: string | null;
  workflowId?: string | null;
  procedureId?: string | null;
  stepId?: string | null;
  selectedTool?: string | null;
  selectedTools?: string[];
  blockedTools?: BlockedToolDecision[];
  requiredSlots?: string[];
  evidence?: DecisionEvidence[];
  policyResult?: Record<string, unknown> | null;
  confidence?: number | null;
  latencyMs?: number | null;
  metadata?: Record<string, unknown> | null;
};

function sanitizeJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null)) as T;
}

function safeStringList(values: Array<string | null | undefined> | null | undefined): string[] {
  return Array.from(new Set(
    (values || [])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  ));
}

function shouldSuppressDbError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('agent_decision_ledger');
}

export function inferAgentDecisionType(input: {
  executionMode?: string | null;
  selectedTools?: string[];
  blockedTools?: BlockedToolDecision[];
  requiredSlots?: string[];
  responseOverride?: string | null;
}): AgentDecisionType {
  const selectedTools = safeStringList(input.selectedTools);
  const requiredSlots = safeStringList(input.requiredSlots);
  if (requiredSlots.length > 0) return 'ask_slot';
  if (selectedTools.includes('transfer_chat')) return 'handoff';
  if (selectedTools.includes('close_chat')) return 'close';
  if (selectedTools.length > 0) return 'call_tool';
  if (input.responseOverride?.trim()) return 'fallback';
  if (input.executionMode === 'direct_response') return 'answer';
  if (input.executionMode === 'retrieve_knowledge') return 'retrieve_knowledge';
  if (input.executionMode === 'continue_llm') return 'continue_llm';
  if ((input.blockedTools || []).length > 0) return 'fallback';
  return 'answer';
}

export async function recordAgentDecisionLedger(entry: DecisionLedgerEntry): Promise<void> {
  try {
    const selectedTools = safeStringList(entry.selectedTools || [entry.selectedTool || undefined]);
    const blockedTools = sanitizeJson(entry.blockedTools || []);
    const requiredSlots = safeStringList(entry.requiredSlots);
    const evidence = sanitizeJson(entry.evidence || []);
    const policyResult = sanitizeJson(entry.policyResult || {});
    const metadata = sanitizeJson(entry.metadata || {});

    await db.query(
      `INSERT INTO agent_decision_ledger (
        workspace_id,
        chat_id,
        message_id,
        orchestrator_run_id,
        system_agent_id,
        autopilot_config_id,
        procedure_session_id,
        decision_type,
        goal,
        procedure_id,
        step_id,
        selected_tool,
        selected_tools_json,
        blocked_tools_json,
        missing_slots_json,
        evidence_json,
        policy_result_json,
        resource_mappings_json,
        response_instruction,
        confidence,
        latency_ms,
        metadata
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22
      )`,
      [
        entry.workspaceId,
        entry.chatId ?? null,
        entry.messageId ?? null,
        entry.runId ?? null,
        entry.systemAgentId ?? null,
        entry.autopilotConfigId ?? null,
        entry.procedureSessionId ?? entry.procedureExecutionId ?? null,
        entry.decisionType,
        entry.goal ?? null,
        entry.procedureId ?? null,
        entry.stepId ?? null,
        entry.selectedTool ?? selectedTools[0] ?? null,
        JSON.stringify(selectedTools),
        JSON.stringify(blockedTools),
        JSON.stringify(requiredSlots),
        JSON.stringify(evidence),
        JSON.stringify(policyResult),
        JSON.stringify([]),
        null,
        entry.confidence == null ? null : entry.confidence,
        entry.latencyMs == null ? null : Math.max(0, Math.round(entry.latencyMs)),
        JSON.stringify({
          ...metadata,
          decisionStage: entry.decisionStage,
          workflowId: entry.workflowId ?? null,
        }),
      ],
    );
  } catch (error) {
    if (!shouldSuppressDbError(error)) {
      console.error('[AGENT_DECISION_LEDGER] Failed to persist decision ledger:', error);
    }
  }
}
