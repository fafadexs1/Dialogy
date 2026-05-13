/**
 * Procedure Runtime Engine — Core Types
 *
 * These types define the executable procedure graph that is compiled from
 * knowledge base documents and executed step-by-step by the Procedure Executor.
 */

// ---------------------------------------------------------------------------
// Procedure Graph (compiled from a knowledge base document)
// ---------------------------------------------------------------------------

export type ProcedureStepType =
  | 'gather_data'    // Ask the customer for information
  | 'validate'       // Check a condition locally
  | 'tool_call'      // Execute an agent tool
  | 'decide'         // LLM picks the best branch
  | 'respond'        // Generate a response (template or LLM)
  | 'handoff';       // Transfer to a human and end

export type ProcedureBranch = {
  condition: string;
  nextStepId: string;
};

export type ProcedureStep = {
  id: string;
  order: number;
  type: ProcedureStepType;
  label: string;

  // gather_data
  requiredSlots?: string[];
  promptTemplate?: string;

  // tool_call
  toolName?: string;
  toolPayloadTemplate?: Record<string, string>;

  // validate
  condition?: string;
  onFail?: 'retry' | 'skip' | 'abort' | 'handoff';

  // decide
  decisionPrompt?: string;
  branches?: ProcedureBranch[];

  // respond
  responseTemplate?: string;
  useLlm?: boolean;

  // handoff
  handoffReason?: string;

  // flow control
  nextStepId?: string | null;
  maxRetries?: number;
  timeoutMs?: number;
};

export type ProcedureGraph = {
  id: string;
  documentId: string;
  documentName: string;
  version: number;
  compiledAt: string;
  triggerIntents: string[];
  triggerKeywords: string[];
  steps: ProcedureStep[];
  metadata: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Procedure Execution Context (persisted state per chat)
// ---------------------------------------------------------------------------

export type ProcedureExecutionStatus =
  | 'running'
  | 'waiting_input'
  | 'waiting_tool'
  | 'completed'
  | 'failed'
  | 'aborted';

export type StepExecutionRecord = {
  stepId: string;
  stepLabel: string;
  startedAt: string;
  completedAt?: string;
  status: 'success' | 'error' | 'skipped' | 'retried' | 'waiting' | 'waiting_tool';
  input?: unknown;
  output?: unknown;
  error?: string;
};

export type ProcedureExecutionContext = {
  id: string;
  chatId: string;
  workspaceId: string;
  systemAgentId: string;
  procedureId: string;
  procedureName: string;
  currentStepId: string;
  status: ProcedureExecutionStatus;

  // Accumulated state
  collectedSlots: Record<string, string>;
  toolResults: Record<string, unknown>;
  decisions: Record<string, string>;

  // Control
  retryCount: Record<string, number>;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;

  // Audit trail
  stepHistory: StepExecutionRecord[];
};

// ---------------------------------------------------------------------------
// Executor result (returned to the orchestrator)
// ---------------------------------------------------------------------------

export type ProcedureAdvanceResult = {
  /** Whether the procedure handled the message (orchestrator should NOT fall through to LLM) */
  handled: boolean;

  /** Response text to send to the customer (may be null if waiting for tool) */
  response: string | null;

  /** Actions to execute (transfer, close, tool calls, etc.) */
  actions: Array<{
    type: string;
    reason: string;
    payload: Record<string, unknown>;
  }>;

  /** Current procedure status after advancing */
  status: ProcedureExecutionStatus;

  /** Which steps were executed in this invocation */
  executedSteps: string[];

  /** If the procedure completed or aborted, why */
  completionReason?: string;
};

// ---------------------------------------------------------------------------
// Compiler output
// ---------------------------------------------------------------------------

export type ProcedureCompilationResult = {
  success: boolean;
  graph: ProcedureGraph | null;
  warnings: string[];
  error?: string;
};
