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

export function recordAgentToolMetrics(input: {
  toolName: string;
  status: 'success' | 'rejected' | 'error';
  durationMs: number;
  riskLevel?: string | null;
  workspaceId?: string | null;
}) {
  void input;
}
