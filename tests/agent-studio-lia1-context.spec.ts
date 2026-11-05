import { afterEach, describe, expect, it, vi } from 'vitest';
import { lia1CompactContextEnabled, lia1ContextDelta, lia1ContextSizes, lia1ObservationTelemetry } from '@/services/agent-studio/lia1-context';
import { studioReasoningSystemPrompt } from '@/services/agent-studio/reasoning-prompt';
import { createDefaultAgentStudioDocument, ProcedureDocumentSchema } from '@/services/agent-studio/types';

afterEach(() => vi.unstubAllEnvs());

describe('LIA-1 context canary', () => {
  it('only enables selected agents and supports an all-agent rollout', () => {
    vi.stubEnv('LIA1_COMPACT_AGENT_IDS', 'agent-a, agent-b');
    expect(lia1CompactContextEnabled('agent-a')).toBe(true);
    expect(lia1CompactContextEnabled('agent-c')).toBe(false);
    vi.stubEnv('LIA1_COMPACT_AGENT_IDS', '*');
    expect(lia1CompactContextEnabled('agent-c')).toBe(true);
  });

  it('sends changed fields and appended observations without repeating the catalog', () => {
    const before = { procedures: [{ id: 'support', name: 'Support' }], requests: [], observations: [], recentMessages: [{ messageId: 'm1', content: 'hi' }] };
    const after = { ...before, requests: [{ id: 'r1' }], observations: [{ result: 'read_failed' }],
      recentMessages: [...before.recentMessages, { messageId: 'm2', content: 'again' }] };
    const delta = lia1ContextDelta(before, after);
    expect(delta).toEqual({ kind: 'state_delta', updates: {
      requests: [{ id: 'r1' }], observations: { append: [{ result: 'read_failed' }] },
      recentMessages: { append: [{ messageId: 'm2', content: 'again' }] },
    } });
    expect(JSON.stringify(delta).length).toBeLessThan(JSON.stringify(after).length);
    expect(lia1ContextSizes(after)).toMatchObject({ procedures: expect.any(Number), observations: expect.any(Number) });
  });

  it('omits only irrelevant guidance and retains dynamic-choice rules when published', () => {
    const document = createDefaultAgentStudioDocument('agent', 'workspace');
    const plain = studioReasoningSystemPrompt(document, true);
    expect(plain).not.toContain('mediaAnalysis, quando presente');
    expect(plain).not.toContain('Campos com optionsSourceKey');
    expect(studioReasoningSystemPrompt(document, true, true)).toContain('mediaAnalysis, quando presente');
    document.resolveStage.procedures = [ProcedureDocumentSchema.parse({ id: 'catalog', name: 'Catálogo', updatedAt: '2026-09-23', steps: [
      { id: 'plan', type: 'collect_data', order: 1, title: 'Plano', collectField: {
        id: 'plan', variableKey: 'plan', name: 'Plano', type: 'single_select', promptMessage: 'Qual plano?',
        optionsSourceKey: 'plans', optionLabelPath: 'name', optionValuePath: 'id',
      } },
    ] })];
    expect(studioReasoningSystemPrompt(document, true)).toContain('Campos com optionsSourceKey');
  });

  it('never puts a knowledge answer or arbitrary result text into usage metadata', () => {
    expect(lia1ObservationTelemetry({ kind: 'knowledge', result: 'segredo da conversa' }))
      .toEqual({ priorOutcome: 'knowledge_result', priorFailureCategory: null });
    expect(lia1ObservationTelemetry({ kind: 'tool', result: 'customer-private-value', category: 'unknown string' }))
      .toEqual({ priorOutcome: 'tool_result', priorFailureCategory: null });
    expect(lia1ObservationTelemetry({ kind: 'tool', result: 'read_failed', category: 'access_blocked' }))
      .toEqual({ priorOutcome: 'read_failed', priorFailureCategory: 'access_blocked' });
  });
});
