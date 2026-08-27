export const AGENT_TASK_STATUSES = [
  'active',
  'waiting_input',
  'waiting_confirmation',
  'waiting_tool',
  'handoff',
  'completed',
  'failed',
  'cancelled',
] as const;

export type AgentTaskStatus = (typeof AGENT_TASK_STATUSES)[number];

export const AGENT_INTERRUPTION_STATUSES = ['pending', 'resolved', 'cancelled'] as const;
export type AgentInterruptionStatus = (typeof AGENT_INTERRUPTION_STATUSES)[number];

export type JsonObject = Record<string, unknown>;

export type AgentTaskExecution = {
  id: string;
  workspaceId: string;
  chatId: string | null;
  orchestratorRunId: string | null;
  systemAgentId: string | null;
  autopilotConfigId: string | null;
  domainPackId: string | null;
  goal: string | null;
  goalKey: string | null;
  procedureId: string | null;
  procedureVersion: number | null;
  currentStepId: string | null;
  status: AgentTaskStatus;
  state: JsonObject;
  slots: JsonObject;
  confirmations: JsonObject;
  decisions: JsonObject;
  toolResults: JsonObject;
  nextAction: JsonObject | null;
  activeInterruptionId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type AgentTaskCheckpoint = {
  id: string;
  taskExecutionId: string;
  orchestratorRunId: string | null;
  sequence: number;
  eventType: string;
  status: AgentTaskStatus;
  state: JsonObject;
  metadata: JsonObject;
  createdAt: string;
};

export type AgentTaskInterruption = {
  id: string;
  taskExecutionId: string;
  parentInterruptionId: string | null;
  kind: string;
  prompt: string;
  status: AgentInterruptionStatus;
  stackOrder: number;
  context: JsonObject;
  createdAt: string;
  resolvedAt: string | null;
};

export type AgentTaskStatePatch = {
  goal?: string | null;
  goalKey?: string | null;
  procedureId?: string | null;
  procedureVersion?: number | null;
  currentStepId?: string | null;
  slots?: JsonObject;
  confirmations?: JsonObject;
  decisions?: JsonObject;
  toolResults?: JsonObject;
  nextAction?: JsonObject | null;
  state?: JsonObject;
};

/**
 * Stable names used by the universal runtime contract. The concrete task
 * state remains the persisted AgentTaskExecution shape so existing runtime
 * adapters can migrate without copying state into a second model.
 */
export type Goal = {
  id?: string | null;
  key?: string | null;
  description: string;
  isPrimary: boolean;
  source?: 'user' | 'system' | 'workflow' | 'interruption' | null;
  metadata?: JsonObject;
};

export type TaskExecutionState = AgentTaskExecution;
export type Checkpoint = AgentTaskCheckpoint;
export type Interruption = AgentTaskInterruption;

export type ToolExecution = {
  id?: string | null;
  taskExecutionId?: string | null;
  toolName: string;
  attempt: number;
  status: 'proposed' | 'waiting_confirmation' | 'running' | 'success' | 'rejected' | 'error' | 'timed_out';
  input: JsonObject;
  output?: JsonObject | null;
  error?: string | null;
  validated?: boolean;
  idempotencyKey?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
};

export type ToolExecutionResult = ToolExecution & {
  status: 'success' | 'rejected' | 'error' | 'timed_out';
  validated: boolean;
};

export type AgentDecision = {
  goal?: string | null;
  currentStepId?: string | null;
  candidateActions: JsonObject[];
  selectedAction?: JsonObject | null;
  blockedActions: Array<{ action: JsonObject; reason: string }>;
  evidence: JsonObject[];
  policyViolations: string[];
  latencyMs?: number | null;
  cost?: number | null;
};

export type Outcome = {
  status: 'completed' | 'handoff' | 'failed' | 'cancelled';
  summary?: string | null;
  evidence?: JsonObject[];
  error?: string | null;
  handoffTarget?: string | null;
};

export type AgentDomainPackStatus = 'draft' | 'published' | 'archived';

export type AgentDomainPack = {
  id: string;
  workspaceId: string;
  slug: string;
  name: string;
  version: number;
  status: AgentDomainPackStatus;
  definition: AgentDomainPackDefinition;
  createdByUserId: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentDomainPackDefinition = {
  identity?: {
    businessName?: string;
    niche?: string;
    description?: string;
  };
  entities?: Array<{
    name: string;
    description?: string;
    fields?: string[];
  }>;
  goals?: Array<{
    id: string;
    label: string;
    description?: string;
    triggerExamples?: string[];
  }>;
  procedures?: Array<{
    id: string;
    name: string;
    version?: number;
    definition?: JsonObject;
  }>;
  policies?: Array<{
    id: string;
    rule: string;
    severity?: 'info' | 'warning' | 'critical';
  }>;
  toolNames?: string[];
  knowledgeSourceIds?: string[];
  handoffRules?: Array<{
    reason: string;
    target?: string;
  }>;
  responseStyle?: {
    language?: string;
    tone?: string;
    constraints?: string[];
  };
  evaluationScenarioIds?: string[];
  metadata?: JsonObject;
};

export type ToolCapabilityContract = {
  name: string;
  version: string;
  capability: string;
  description: string;
  source: 'dialogy' | 'mcp' | 'custom';
  riskLevel: 'low' | 'medium' | 'high';
  sideEffect: 'none' | 'low' | 'medium' | 'high';
  requiredSlots: string[];
  permissions: string[];
  preconditions: string[];
  postconditions: string[];
  idempotent: boolean;
  timeoutMs: number;
  maxAttempts: number;
  requiresConfirmation: boolean;
  requiresHumanApproval: boolean;
  inputSchema: JsonObject | null;
  outputSchema: JsonObject | null;
};

export type CapabilityAuthorizationCode =
  | 'allowed'
  | 'unknown_tool'
  | 'disabled_tool'
  | 'missing_slots'
  | 'invalid_arguments'
  | 'requires_confirmation'
  | 'requires_human_approval'
  | 'risk_policy_blocked'
  | 'intent_not_allowed';

export type CapabilityAuthorization = {
  allowed: boolean;
  code: CapabilityAuthorizationCode;
  reason: string;
  contract: ToolCapabilityContract | null;
  missingSlots: string[];
  confirmationRequired: boolean;
  idempotencyKey: string | null;
};

export type AgentTraceEvent = {
  eventType: string;
  status?: string | null;
  durationMs?: number | null;
  goal?: string | null;
  taskStatus?: AgentTaskStatus | null;
  payload?: JsonObject;
};

export type AgentTrace = {
  taskExecutionId?: string | null;
  workspaceId: string;
  chatId?: string | null;
  events: AgentTraceEvent[];
  toolExecutions?: ToolExecutionResult[];
  evidence?: JsonObject[];
  metrics?: {
    latencyMs?: number | null;
    cost?: number | null;
  };
};

export type AgentEvaluationScenario = {
  id: string;
  name: string;
  niche: string;
  input: string;
  expectedGoal?: string | null;
  expectedTools?: string[];
  forbiddenTools?: string[];
  expectedTaskStatus?: AgentTaskStatus | null;
  requiresConfirmation?: boolean;
  minimumPlanSteps?: number;
  forbiddenAssumptions?: string[];
  metadata?: JsonObject;
};

export type AgentEvaluationResult = {
  scenarioId: string;
  passed: boolean;
  failures: string[];
  observedGoal: string | null;
  observedTools: string[];
  observedTaskStatus: AgentTaskStatus | null;
};

export type EvaluationScenario = AgentEvaluationScenario;

export type AgentEvaluationRun = {
  id: string;
  workspaceId: string;
  domainPackId: string | null;
  scenarioId: string;
  input: JsonObject;
  observation: JsonObject;
  passed: boolean;
  failures: string[];
  metrics: JsonObject;
  createdAt: string;
};

const TERMINAL_TASK_STATUSES = new Set<AgentTaskStatus>(['handoff', 'completed', 'failed', 'cancelled']);

export function isTerminalAgentTaskStatus(status: AgentTaskStatus): boolean {
  return TERMINAL_TASK_STATUSES.has(status);
}

export function isValidAgentTaskTransition(
  from: AgentTaskStatus,
  to: AgentTaskStatus,
): boolean {
  if (from === to) return true;
  if (isTerminalAgentTaskStatus(from)) return false;

  const allowed: Record<AgentTaskStatus, AgentTaskStatus[]> = {
    active: ['waiting_input', 'waiting_confirmation', 'waiting_tool', 'handoff', 'completed', 'failed', 'cancelled'],
    waiting_input: ['active', 'waiting_confirmation', 'waiting_tool', 'handoff', 'completed', 'failed', 'cancelled'],
    waiting_confirmation: ['active', 'waiting_input', 'waiting_tool', 'handoff', 'failed', 'cancelled'],
    waiting_tool: ['active', 'waiting_input', 'waiting_confirmation', 'handoff', 'completed', 'failed', 'cancelled'],
    handoff: [],
    completed: [],
    failed: [],
    cancelled: [],
  };

  return allowed[from].includes(to);
}

export function assertValidAgentTaskTransition(
  from: AgentTaskStatus,
  to: AgentTaskStatus,
): void {
  if (!isValidAgentTaskTransition(from, to)) {
    throw new Error(`Transicao de tarefa invalida: ${from} -> ${to}.`);
  }
}

function cleanString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, maxLength) : undefined;
}

function cleanStringList(value: unknown, maxItems = 50): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .map((item) => cleanString(item, 500))
      .filter((item): item is string => Boolean(item)),
  )).slice(0, maxItems);
}

export function sanitizeAgentDomainPackDefinition(value: unknown): AgentDomainPackDefinition {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const identityValue = input.identity && typeof input.identity === 'object' && !Array.isArray(input.identity)
    ? input.identity as Record<string, unknown>
    : {};

  return {
    identity: {
      businessName: cleanString(identityValue.businessName, 160),
      niche: cleanString(identityValue.niche, 120),
      description: cleanString(identityValue.description, 2_000),
    },
    entities: Array.isArray(input.entities)
      ? input.entities.slice(0, 100).flatMap((item) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
          const entity = item as Record<string, unknown>;
          const name = cleanString(entity.name, 120);
          if (!name) return [];
          return [{
            name,
            description: cleanString(entity.description, 1_000),
            fields: cleanStringList(entity.fields, 100),
          }];
        })
      : [],
    goals: Array.isArray(input.goals)
      ? input.goals.slice(0, 100).flatMap((item) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
          const goal = item as Record<string, unknown>;
          const id = cleanString(goal.id, 120);
          const label = cleanString(goal.label, 180);
          if (!id || !label) return [];
          return [{
            id,
            label,
            description: cleanString(goal.description, 1_000),
            triggerExamples: cleanStringList(goal.triggerExamples, 30),
          }];
        })
      : [],
    procedures: Array.isArray(input.procedures)
      ? input.procedures.slice(0, 100).flatMap((item) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
          const procedure = item as Record<string, unknown>;
          const id = cleanString(procedure.id, 120);
          const name = cleanString(procedure.name, 180);
          if (!id || !name) return [];
          return [{
            id,
            name,
            version: typeof procedure.version === 'number' && Number.isInteger(procedure.version)
              ? Math.max(1, procedure.version)
              : 1,
            definition: procedure.definition && typeof procedure.definition === 'object' && !Array.isArray(procedure.definition)
              ? procedure.definition as JsonObject
              : {},
          }];
        })
      : [],
    policies: Array.isArray(input.policies)
      ? input.policies.slice(0, 200).flatMap((item) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
          const policy = item as Record<string, unknown>;
          const id = cleanString(policy.id, 120);
          const rule = cleanString(policy.rule, 2_000);
          if (!id || !rule) return [];
          const severity = policy.severity === 'warning' || policy.severity === 'critical'
            ? policy.severity
            : 'info';
          return [{ id, rule, severity }];
        })
      : [],
    toolNames: cleanStringList(input.toolNames, 200),
    knowledgeSourceIds: cleanStringList(input.knowledgeSourceIds, 200),
    handoffRules: Array.isArray(input.handoffRules)
      ? input.handoffRules.slice(0, 100).flatMap((item) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
          const rule = item as Record<string, unknown>;
          const reason = cleanString(rule.reason, 1_000);
          if (!reason) return [];
          return [{ reason, target: cleanString(rule.target, 160) }];
        })
      : [],
    responseStyle: input.responseStyle && typeof input.responseStyle === 'object' && !Array.isArray(input.responseStyle)
      ? {
          language: cleanString((input.responseStyle as Record<string, unknown>).language, 40),
          tone: cleanString((input.responseStyle as Record<string, unknown>).tone, 120),
          constraints: cleanStringList((input.responseStyle as Record<string, unknown>).constraints, 50),
        }
      : {},
    evaluationScenarioIds: cleanStringList(input.evaluationScenarioIds, 200),
    metadata: input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
      ? input.metadata as JsonObject
      : {},
  };
}

export function validateAgentDomainPackDefinition(
  value: AgentDomainPackDefinition,
): string[] {
  const errors: string[] = [];
  if (!value.identity?.niche && !value.identity?.businessName) {
    errors.push('O pacote precisa informar o nicho ou o nome do negocio.');
  }
  if (value.toolNames && new Set(value.toolNames).size !== value.toolNames.length) {
    errors.push('toolNames nao pode conter ferramentas duplicadas.');
  }
  if (value.goals?.some((goal) => !/^[a-z0-9][a-z0-9_.-]{1,119}$/i.test(goal.id))) {
    errors.push('Cada objetivo precisa ter um id estavel com letras, numeros, ponto, hifen ou underscore.');
  }
  return errors;
}
