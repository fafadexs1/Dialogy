import type { WorkflowLimits } from './types';

export type WorkflowRuntimeCaps = Partial<Pick<WorkflowLimits, 'maxModelCalls' | 'maxToolCalls' | 'executionTimeoutMs'>>;
/** Invocation limits may only tighten an immutable published definition. */
export function effectiveWorkflowLimits(base: WorkflowLimits, caps: unknown): WorkflowLimits {
  const result = { ...base };
  if (!caps || typeof caps !== 'object' || Array.isArray(caps)) return result;
  for (const name of ['maxModelCalls', 'maxToolCalls', 'executionTimeoutMs'] as const) {
    const value = (caps as Record<string, unknown>)[name];
    if (typeof value === 'number' && Number.isFinite(value)) result[name] = Math.min(base[name], Math.max(name === 'executionTimeoutMs' ? 1 : 0, Math.floor(value)));
  }
  return result;
}
