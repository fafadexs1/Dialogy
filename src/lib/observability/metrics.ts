import 'server-only';

export function recordActionMetrics(
  action: string,
  status: 'success' | 'fail' | 'redirect',
  durationMs: number
) {
  void action;
  void status;
  void durationMs;
}

export function recordWebhookMetrics(input: {
  source: string;
  status: 'success' | 'fail';
  event?: string;
  durationMs: number;
  queueWaitMs?: number;
}) {
  void input;
}

export function recordClientError(component?: string) {
  void component;
}

export function recordClientMetric(name: string, durationMs: number) {
  void name;
  void durationMs;
}

export function recordAutopilotRunMetrics(input: {
  status: 'success' | 'fallback' | 'error' | 'skipped';
  durationMs: number;
  workspaceId?: string | null;
  hasDeterministicRouting?: boolean;
  intent?: string | null;
  workflowId?: string | null;
  ragStrategy?: string | null;
  knowledgeCoverage?: string | null;
  fallbackReason?: string | null;
  validatorAction?: string | null;
  toolPlannerRejectedCount?: number | null;
}) {
  void input;
}

export function recordAutopilotStageMetrics(input: {
  stage: 'rag' | 'llm' | 'tool' | 'send' | 'total';
  status: 'success' | 'fallback' | 'error';
  durationMs: number;
  workspaceId?: string | null;
}) {
  void input;
}

export function recordAutopilotDecisionMetrics(input: {
  kind: 'intent' | 'rag' | 'workflow' | 'tool_planner' | 'response_validator' | 'fallback';
  status: 'success' | 'fallback' | 'error' | 'skipped';
  durationMs?: number | null;
  workspaceId?: string | null;
  intent?: string | null;
  workflowId?: string | null;
  ragStrategy?: string | null;
  knowledgeCoverage?: string | null;
  decision?: string | null;
  reason?: string | null;
  count?: number | null;
}) {
  void input;
}

export function recordAgentToolMetrics(input: {
  toolName: string;
  status: 'success' | 'rejected' | 'error';
  durationMs: number;
  riskLevel?: string | null;
  workspaceId?: string | null;
}) {
  void input;
}
