import type { AgentTraceEvent, JsonObject } from './types';

export type AgentTraceSummary = {
  eventCount: number;
  stages: Record<string, number>;
  toolNames: string[];
  blockedTools: string[];
  evidence: JsonObject[];
  policyViolations: string[];
  latencyMs: number;
};

function recordString(set: Set<string>, value: unknown) {
  if (typeof value === 'string' && value.trim()) set.add(value.trim());
}

export function summarizeAgentTrace(events: AgentTraceEvent[]): AgentTraceSummary {
  const stages: Record<string, number> = {};
  const tools = new Set<string>();
  const blockedTools = new Set<string>();
  const evidence: JsonObject[] = [];
  const policyViolations = new Set<string>();
  let latencyMs = 0;

  for (const event of events || []) {
    stages[event.eventType] = (stages[event.eventType] || 0) + 1;
    latencyMs += Math.max(0, Number(event.durationMs || 0));
    const payload = event.payload || {};
    recordString(tools, payload.toolName);
    recordString(blockedTools, payload.blockedTool);
    if (Array.isArray(payload.blockedTools)) {
      payload.blockedTools.forEach((item) => recordString(blockedTools, item));
    }
    if (Array.isArray(payload.evidence)) {
      payload.evidence
        .filter((item): item is JsonObject => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
        .slice(0, 50)
        .forEach((item) => evidence.push(item));
    }
    if (Array.isArray(payload.policyViolations)) {
      payload.policyViolations.forEach((item) => recordString(policyViolations, item));
    }
  }

  return {
    eventCount: events.length,
    stages,
    toolNames: [...tools],
    blockedTools: [...blockedTools],
    evidence,
    policyViolations: [...policyViolations],
    latencyMs,
  };
}

