import 'server-only';

import { metrics, type Attributes } from '@opentelemetry/api';

const meter = metrics.getMeter('dialogy');
const actionCounter = meter.createCounter('dialogy.actions');
const actionDuration = meter.createHistogram('dialogy.action.duration', { unit: 'ms' });
const webhookCounter = meter.createCounter('dialogy.webhooks');
const webhookDuration = meter.createHistogram('dialogy.webhook.duration', { unit: 'ms' });
const webhookQueueWait = meter.createHistogram('dialogy.webhook.queue_wait', { unit: 'ms' });
const clientErrorCounter = meter.createCounter('dialogy.client.errors');
const clientDuration = meter.createHistogram('dialogy.client.duration', { unit: 'ms' });
const autopilotRunCounter = meter.createCounter('dialogy.autopilot.runs');
const autopilotRunDuration = meter.createHistogram('dialogy.autopilot.run.duration', { unit: 'ms' });
const autopilotStageCounter = meter.createCounter('dialogy.autopilot.stages');
const autopilotStageDuration = meter.createHistogram('dialogy.autopilot.stage.duration', { unit: 'ms' });
const autopilotDecisionCounter = meter.createCounter('dialogy.autopilot.decisions');
const autopilotDecisionDuration = meter.createHistogram('dialogy.autopilot.decision.duration', { unit: 'ms' });
const agentToolCounter = meter.createCounter('dialogy.agent_tools');
const agentToolDuration = meter.createHistogram('dialogy.agent_tool.duration', { unit: 'ms' });

function clean(attributes: Record<string, string | number | boolean | null | undefined>): Attributes {
  const result: Attributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== null && value !== undefined) result[key] = value;
  }
  return result;
}

export function recordActionMetrics(action: string, status: 'success' | 'fail' | 'redirect', durationMs: number) {
  const attributes = { action, status };
  actionCounter.add(1, attributes);
  actionDuration.record(durationMs, attributes);
}

export function recordWebhookMetrics(input: {
  source: string;
  status: 'success' | 'fail';
  event?: string;
  durationMs: number;
  queueWaitMs?: number;
}) {
  const attributes = clean({ source: input.source, status: input.status, event: input.event });
  webhookCounter.add(1, attributes);
  webhookDuration.record(input.durationMs, attributes);
  if (input.queueWaitMs !== undefined) webhookQueueWait.record(input.queueWaitMs, attributes);
}

export function recordClientError(component?: string) {
  clientErrorCounter.add(1, clean({ component }));
}

export function recordClientMetric(name: string, durationMs: number) {
  clientDuration.record(durationMs, { name });
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
  const attributes = clean({
    status: input.status,
    deterministic_routing: input.hasDeterministicRouting,
    intent: input.intent,
    rag_strategy: input.ragStrategy,
    knowledge_coverage: input.knowledgeCoverage,
    fallback_reason: input.fallbackReason,
    validator_action: input.validatorAction,
  });
  autopilotRunCounter.add(1, attributes);
  autopilotRunDuration.record(input.durationMs, attributes);
}

export function recordAutopilotStageMetrics(input: {
  stage: 'rag' | 'llm' | 'tool' | 'send' | 'total';
  status: 'success' | 'fallback' | 'error';
  durationMs: number;
  workspaceId?: string | null;
}) {
  const attributes = { stage: input.stage, status: input.status };
  autopilotStageCounter.add(1, attributes);
  autopilotStageDuration.record(input.durationMs, attributes);
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
  const attributes = clean({
    kind: input.kind,
    status: input.status,
    intent: input.intent,
    rag_strategy: input.ragStrategy,
    knowledge_coverage: input.knowledgeCoverage,
    decision: input.decision,
    reason: input.reason,
  });
  autopilotDecisionCounter.add(input.count ?? 1, attributes);
  if (input.durationMs !== undefined && input.durationMs !== null) {
    autopilotDecisionDuration.record(input.durationMs, attributes);
  }
}

export function recordAgentToolMetrics(input: {
  toolName: string;
  status: 'success' | 'rejected' | 'error';
  durationMs: number;
  riskLevel?: string | null;
  workspaceId?: string | null;
}) {
  const attributes = clean({ tool: input.toolName, status: input.status, risk_level: input.riskLevel });
  agentToolCounter.add(1, attributes);
  agentToolDuration.record(input.durationMs, attributes);
}
