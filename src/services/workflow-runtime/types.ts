import type { z } from 'zod';
import type {
  AgentDecisionSchema,
  AgentNodeConfigSchema,
  ConnectionTypeSchema,
  ExecutionStepSchema,
  ModelCapabilityProfileSchema,
  ModelConfigurationSchema,
  NodeExecutionResultSchema,
  NodeExecutionStatusSchema,
  NodePortSchema,
  RetryPolicySchema,
  ToolCallRecordSchema,
  WorkflowConnectionSchema,
  WorkflowDefinitionSchema,
  WorkflowExecutionSchema,
  WorkflowLimitsSchema,
  WorkflowNodeSchema,
  WorkflowValidationResultSchema,
} from './schemas';

export type ConnectionType = z.infer<typeof ConnectionTypeSchema>;
export type NodePort = z.infer<typeof NodePortSchema>;
export type RetryPolicy = z.infer<typeof RetryPolicySchema>;
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;
export type WorkflowConnection = z.infer<typeof WorkflowConnectionSchema>;
export type WorkflowLimits = z.infer<typeof WorkflowLimitsSchema>;
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;
export type ToolCallRecord = z.infer<typeof ToolCallRecordSchema>;
export type NodeExecutionStatus = z.infer<typeof NodeExecutionStatusSchema>;
export type NodeExecutionResult = z.infer<typeof NodeExecutionResultSchema>;
export type ExecutionStep = z.infer<typeof ExecutionStepSchema>;
export type WorkflowExecution = z.infer<typeof WorkflowExecutionSchema>;
export type AgentNodeConfig = z.infer<typeof AgentNodeConfigSchema>;
export type AgentDecision = z.infer<typeof AgentDecisionSchema>;
export type ModelConfiguration = z.infer<typeof ModelConfigurationSchema>;
export type ModelCapabilityProfile = z.infer<typeof ModelCapabilityProfileSchema>;
export type WorkflowValidationResult = z.infer<typeof WorkflowValidationResultSchema>;

export type WorkflowValidationIssue = WorkflowValidationResult['errors'][number];

export type OperationalNodeState =
  | 'not_executed'
  | 'queued'
  | 'running'
  | 'thinking'
  | 'waiting_tool'
  | 'running_tool'
  | 'waiting_input'
  | 'completed'
  | 'partially_completed'
  | 'skipped'
  | 'retrying'
  | 'failed'
  | 'cancelled';

export type WorkflowEventType =
  | 'execution.started'
  | 'execution.resumed'
  | 'execution.waiting'
  | 'execution.completed'
  | 'execution.failed'
  | 'execution.cancelled'
  | 'node.queued'
  | 'node.started'
  | 'node.retrying'
  | 'node.completed'
  | 'node.failed'
  | 'agent.thinking.started'
  | 'agent.thinking.finished'
  | 'agent.limit_reached'
  | 'tool.requested'
  | 'tool.started'
  | 'tool.completed'
  | 'tool.failed'
  | 'tool.rejected'
  | 'message.delta';

export type WorkflowEvent = {
  id: string;
  sequence: number;
  type: WorkflowEventType;
  executionId: string;
  workflowId: string;
  nodeId?: string;
  toolName?: string;
  text?: string;
  safeSummary?: string;
  data?: Record<string, unknown>;
  createdAt: string;
};

export type NodeRuntimeInput = {
  execution: WorkflowExecution;
  workflow: WorkflowDefinition;
  node: WorkflowNode;
  input: Record<string, unknown>;
  attachments: Partial<Record<Exclude<ConnectionType, 'main' | 'error' | 'event'>, WorkflowNode[]>>;
  signal: AbortSignal;
  emit: (event: Omit<WorkflowEvent, 'id' | 'sequence' | 'createdAt'>) => Promise<void>;
};

export type NodeHandler = {
  type: string;
  inputSchema?: z.ZodType<Record<string, unknown>>;
  configSchema?: z.ZodType<Record<string, unknown>>;
  execute: (input: NodeRuntimeInput) => Promise<NodeExecutionResult>;
};

export type NodeHandlerRegistry = {
  get: (nodeType: string) => NodeHandler | undefined;
};

export type WorkflowRunOptions = {
  workerId?: string;
  signal?: AbortSignal;
  maxSteps?: number;
};

export type WorkflowStartInput = {
  workflow: WorkflowDefinition;
  input: Record<string, unknown>;
  context?: Record<string, unknown>;
  variables?: Record<string, unknown>;
  sessionId?: string;
  conversationId?: string;
  executionId?: string;
};

export type WorkflowResumeInput = {
  resumeToken: string;
  input?: Record<string, unknown>;
  contextPatch?: Record<string, unknown>;
  workerId?: string;
};

