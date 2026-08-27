import { z } from 'zod';

export const JsonRecordSchema = z.record(z.unknown());

export const ConnectionTypeSchema = z.enum([
  'main',
  'model',
  'tool',
  'agent_tool',
  'memory',
  'knowledge',
  'guardrail',
  'error',
  'event',
]);

export const NodePortSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  direction: z.enum(['input', 'output']),
  connectionType: ConnectionTypeSchema,
  required: z.boolean().default(false),
  multiple: z.boolean().default(false),
  schema: JsonRecordSchema.optional(),
});

export const RetryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(20).default(1),
  initialDelayMs: z.number().int().min(0).max(300_000).default(0),
  backoffMultiplier: z.number().min(1).max(10).default(2),
  maxDelayMs: z.number().int().min(0).max(900_000).default(30_000),
  retryableErrorCodes: z.array(z.string().min(1)).default([]),
});

export const WorkflowNodeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  name: z.string().min(1),
  position: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
  }),
  config: JsonRecordSchema.default({}),
  inputPorts: z.array(NodePortSchema).default([]),
  outputPorts: z.array(NodePortSchema).default([]),
  retryPolicy: RetryPolicySchema.optional(),
  timeoutMs: z.number().int().positive().max(3_600_000).optional(),
});

export const WorkflowConnectionSchema = z.object({
  id: z.string().min(1),
  sourceNodeId: z.string().min(1),
  sourcePortId: z.string().min(1),
  targetNodeId: z.string().min(1),
  targetPortId: z.string().min(1),
  connectionType: ConnectionTypeSchema,
});

export const WorkflowLimitsSchema = z.object({
  executionTimeoutMs: z.number().int().positive().max(86_400_000).default(120_000),
  maxSteps: z.number().int().positive().max(10_000).default(100),
  maxModelCalls: z.number().int().nonnegative().max(10_000).default(15),
  maxToolCalls: z.number().int().nonnegative().max(10_000).default(20),
  maxAgentTurnsPerNode: z.number().int().positive().max(100).default(8),
  maxRepeatedDecisionSignatures: z.number().int().positive().max(20).default(2),
  maxTotalInputTokens: z.number().int().nonnegative().default(100_000),
  maxTotalOutputTokens: z.number().int().nonnegative().default(20_000),
  concurrencyLimit: z.number().int().positive().max(100).default(1),
});

export const WorkflowDefinitionSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1).optional(),
  name: z.string().min(1),
  version: z.string().min(1),
  status: z.enum(['draft', 'published', 'archived']),
  nodes: z.array(WorkflowNodeSchema).min(1),
  connections: z.array(WorkflowConnectionSchema).default([]),
  settings: WorkflowLimitsSchema,
  inputSchema: JsonRecordSchema.optional(),
  outputSchema: JsonRecordSchema.optional(),
  metadata: JsonRecordSchema.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const ToolCallRecordSchema = z.object({
  id: z.string().min(1),
  toolName: z.string().min(1),
  arguments: JsonRecordSchema,
  purposeSummary: z.string().optional(),
  status: z.enum(['requested', 'running', 'success', 'error', 'rejected']),
  output: JsonRecordSchema.optional(),
  error: z.object({
    code: z.string().min(1),
    message: z.string(),
    retryable: z.boolean(),
    details: JsonRecordSchema.optional(),
  }).optional(),
  startedAt: z.string().datetime().optional(),
  finishedAt: z.string().datetime().optional(),
  durationMs: z.number().nonnegative().optional(),
  attempt: z.number().int().positive().optional(),
  idempotencyKey: z.string().optional(),
});

export const NodeExecutionStatusSchema = z.enum([
  'success',
  'route',
  'waiting',
  'retry',
  'skipped',
  'completed',
  'error',
]);

export const NodeExecutionResultSchema = z.object({
  status: NodeExecutionStatusSchema,
  output: JsonRecordSchema.optional(),
  statePatch: JsonRecordSchema.optional(),
  selectedOutput: z.string().min(1).optional(),
  selectedOutputs: z.array(z.string().min(1)).min(1).optional(),
  nextNodeId: z.string().min(1).optional(),
  toolCalls: z.array(ToolCallRecordSchema).optional(),
  waitingReason: z.string().optional(),
  resumeToken: z.string().min(1).optional(),
  retryAfterMs: z.number().int().nonnegative().optional(),
  error: z.object({
    code: z.string().min(1),
    message: z.string(),
    retryable: z.boolean(),
    details: JsonRecordSchema.optional(),
  }).optional(),
  metrics: z.object({
    durationMs: z.number().nonnegative(),
    model: z.string().optional(),
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    modelCalls: z.number().int().nonnegative().optional(),
    toolCalls: z.number().int().nonnegative().optional(),
    attempts: z.number().int().positive().optional(),
  }).optional(),
}).superRefine((result, context) => {
  if (result.status === 'error' && !result.error) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'An error result must include error details.',
      path: ['error'],
    });
  }
  if (result.status === 'waiting' && !result.resumeToken) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'A waiting result must include a resume token.',
      path: ['resumeToken'],
    });
  }
  if (result.selectedOutput && result.selectedOutputs) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Use selectedOutput or selectedOutputs, never both.',
      path: ['selectedOutputs'],
    });
  }
});

export const ExecutionStepSchema = z.object({
  sequence: z.number().int().nonnegative(),
  nodeId: z.string().min(1),
  nodeType: z.string().min(1),
  attempt: z.number().int().positive(),
  status: NodeExecutionStatusSchema,
  selectedOutput: z.string().optional(),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
  durationMs: z.number().nonnegative(),
  input: JsonRecordSchema.optional(),
  output: JsonRecordSchema.optional(),
  stateBefore: JsonRecordSchema.optional(),
  statePatch: JsonRecordSchema.optional(),
  stateAfter: JsonRecordSchema.optional(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  }).optional(),
});

export const WorkflowExecutionSchema = z.object({
  executionId: z.string().min(1),
  workflowId: z.string().min(1),
  workflowVersion: z.string().min(1),
  workspaceId: z.string().optional(),
  sessionId: z.string().optional(),
  conversationId: z.string().optional(),
  status: z.enum(['queued', 'running', 'waiting', 'completed', 'failed', 'cancelled']),
  currentNodeId: z.string().nullable(),
  previousNodeId: z.string().nullable(),
  pendingNodeIds: z.array(z.string()).default([]),
  input: JsonRecordSchema,
  variables: JsonRecordSchema,
  context: JsonRecordSchema,
  nodeResults: z.record(NodeExecutionResultSchema),
  executionPath: z.array(ExecutionStepSchema),
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  finishedAt: z.string().datetime().optional(),
  waitingReason: z.string().optional(),
  resumeToken: z.string().optional(),
  failure: z.object({
    code: z.string(),
    message: z.string(),
    nodeId: z.string().optional(),
    details: JsonRecordSchema.optional(),
  }).optional(),
  totalSteps: z.number().int().nonnegative(),
  totalModelCalls: z.number().int().nonnegative(),
  totalToolCalls: z.number().int().nonnegative(),
  totalInputTokens: z.number().int().nonnegative().default(0),
  totalOutputTokens: z.number().int().nonnegative().default(0),
  totalTokens: z.number().int().nonnegative().optional(),
  version: z.number().int().nonnegative().default(0),
  lockedBy: z.string().optional(),
  lockExpiresAt: z.string().datetime().optional(),
});

export const AgentNodeConfigSchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  useSelectedSystemAgent: z.boolean().default(true),
  persona: z.string().default(''),
  language: z.string().min(2).default('pt-BR'),
  objective: z.string().min(1),
  instructions: z.array(z.string().min(1)).default([]),
  completionCriteria: z.array(z.string().min(1)).min(1),
  availableContext: z.array(z.string().min(1)).default([]),
  maxTurns: z.number().int().positive().max(100).default(8),
  maxToolCalls: z.number().int().nonnegative().max(100).default(20),
  maxRepeatedToolCalls: z.number().int().positive().max(20).default(2),
  timeoutMs: z.number().int().positive().max(3_600_000).default(120_000),
  modelTimeoutMs: z.number().int().positive().max(600_000).default(60_000),
  toolTimeoutMs: z.number().int().positive().max(600_000).default(30_000),
  allowParallelToolCalls: z.boolean().default(false),
  requireStructuredFinalOutput: z.boolean().default(false),
  fallbackOnToolError: z.enum([
    'retry',
    'continue_without_tool',
    'ask_user',
    'route_to_error',
  ]).default('route_to_error'),
  onLimitReached: z.enum([
    'return_partial',
    'ask_user',
    'handoff',
    'error',
  ]).default('error'),
  finalOutputSchema: JsonRecordSchema.optional(),
});

const AgentFinalDecisionSchema = z.object({
  type: z.literal('final'),
  response: z.string(),
  statePatch: JsonRecordSchema.optional(),
  structuredOutput: JsonRecordSchema.optional(),
  completionStatus: z.enum(['completed', 'partial']),
});

const AgentToolCallDecisionSchema = z.object({
  type: z.literal('tool_call'),
  toolName: z.string().min(1),
  arguments: JsonRecordSchema,
  purposeSummary: z.string().min(1),
});

const AgentNeedsInputDecisionSchema = z.object({
  type: z.literal('needs_input'),
  question: z.string().min(1),
  // Keep provider-level structured parsing tolerant. The agent loop handles
  // an empty list semantically and asks the model to choose final/handoff,
  // avoiding a hard workflow failure after successful tool execution.
  missingFields: z.array(z.string().min(1)),
});

const AgentHandoffDecisionSchema = z.object({
  type: z.literal('handoff'),
  reason: z.string().min(1),
  summary: z.string().min(1),
  customerMessage: z.string().min(1).optional(),
});

export const AgentDecisionSchema = z.discriminatedUnion('type', [
  AgentFinalDecisionSchema,
  AgentToolCallDecisionSchema,
  AgentNeedsInputDecisionSchema,
  AgentHandoffDecisionSchema,
]);

export const ModelConfigurationSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  baseUrl: z.string().url().optional(),
  apiKeyReference: z.string().optional(),
  temperature: z.number().min(0).max(2).default(0.2),
  maxOutputTokens: z.number().int().positive().default(2048),
  contextWindow: z.number().int().positive().optional(),
  supportsTools: z.boolean(),
  supportsStructuredOutput: z.boolean(),
  supportsStreaming: z.boolean(),
  timeoutMs: z.number().int().positive().default(60_000),
  maxRetries: z.number().int().nonnegative().max(10).default(2),
});

export const ModelCapabilityProfileSchema = z.object({
  model: z.string().min(1),
  toolCalling: z.enum(['unsupported', 'weak', 'supported', 'excellent']),
  structuredOutput: z.boolean(),
  streaming: z.boolean(),
  recommendedMaxTools: z.number().int().nonnegative(),
  recommendedContextSize: z.number().int().positive(),
  lastEvaluatedAt: z.string().datetime(),
});

export const WorkflowValidationIssueSchema = z.object({
  code: z.string().min(1),
  nodeId: z.string().optional(),
  connectionId: z.string().optional(),
  message: z.string().min(1),
});

export const WorkflowValidationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(WorkflowValidationIssueSchema),
  warnings: z.array(WorkflowValidationIssueSchema),
});
