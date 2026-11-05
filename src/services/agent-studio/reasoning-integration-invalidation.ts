import type { AgentStudioDocument } from './types';
import type { StudioSession } from './engine';

export function isCurrentIntegrationResult(operation: { capabilityId: string; at: string; integrationIdentity?: string; integrationReset?: string | null }, active: Map<string, string>, clearedAt: string | null): boolean {
  return Boolean(operation.integrationIdentity && operation.integrationIdentity === active.get(operation.capabilityId)) && (operation.integrationReset || null) === clearedAt;
}

/** Invalidate data, never execution status: an uncertain write must not become repeatable. */
export function invalidateInactiveStudioIntegrationData(document: AgentStudioDocument, state: StudioSession, active: Map<string, string>, clearedAt: string | null): boolean {
  if (!state.reasoning) return false;
  const steps = new Map<string, { procedureId: string; outputs: string[] }>(document.resolveStage.procedures.flatMap((procedure) => procedure.steps
    .filter((step) => step.httpRequest || step.mcpTool)
    .map((step) => [`${procedure.id}:${step.id}`, { procedureId: procedure.id, outputs: (step.httpRequest?.outputMappings || step.mcpTool?.outputMappings || []).map((output) => output.chipKey) }] as const)));
  const valid = (operation: { capabilityId: string; at: string; integrationIdentity?: string; integrationReset?: string | null }) => isCurrentIntegrationResult(operation, active, clearedAt);
  let changed = false;
  for (const request of state.reasoning.requests) {
    const matching = state.reasoning.operations.filter((operation) => operation.requestId === request.id || Boolean(request.memoryRequestId && operation.memoryRequestId === request.memoryRequestId));
    const fields = new Set([...steps.values()].filter((step) => step.procedureId === request.procedureId).flatMap((step) => step.outputs));
    for (const field of fields) {
      if (!Object.hasOwn(request.integrationValues, field)) continue;
      const latest = [...matching].reverse().find((operation) => steps.get(operation.capabilityId)?.outputs.includes(field));
      if (!latest || latest.status !== 'succeeded' || !valid(latest)) { delete request.integrationValues[field]; changed = true; }
    }
  }
  for (const operation of state.reasoning.operations) {
    if (steps.has(operation.capabilityId) && !valid(operation) && Object.keys(operation.values).length) { operation.values = {}; changed = true; }
  }
  return changed;
}
