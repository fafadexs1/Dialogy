import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/lib/db';
import { inferAgentDecisionType, recordAgentDecisionLedger } from '@/services/autopilot/decision-ledger';

vi.mock('@/lib/db', () => ({
  db: {
    query: vi.fn(),
  },
}));

describe('agent decision ledger', () => {
  beforeEach(() => {
    vi.mocked(db.query).mockReset();
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any);
  });

  it('classifies missing slots before tool execution', () => {
    expect(inferAgentDecisionType({
      executionMode: 'pre_response_tools',
      selectedTools: ['sgp_fetch_contracts'],
      requiredSlots: ['customer_identifier'],
    })).toBe('ask_slot');
  });

  it('classifies operational tool decisions by selected tools', () => {
    expect(inferAgentDecisionType({
      executionMode: 'pre_response_tools',
      selectedTools: ['sgp_fetch_contracts'],
    })).toBe('call_tool');

    expect(inferAgentDecisionType({
      selectedTools: ['transfer_chat'],
    })).toBe('handoff');

    expect(inferAgentDecisionType({
      selectedTools: ['close_chat'],
    })).toBe('close');
  });

  it('classifies answer and fallback decisions when no tool is selected', () => {
    expect(inferAgentDecisionType({ executionMode: 'direct_response' })).toBe('answer');
    expect(inferAgentDecisionType({ responseOverride: 'Nao posso executar isso.' })).toBe('fallback');
    expect(inferAgentDecisionType({ executionMode: 'continue_llm' })).toBe('continue_llm');
  });

  it('stores procedure_session_id as the explicit plan-compatible alias', async () => {
    await recordAgentDecisionLedger({
      workspaceId: 'workspace-1',
      procedureExecutionId: 'procedure-session-1',
      decisionStage: 'procedure_runtime',
      decisionType: 'ask_slot',
      goal: 'change_wifi_credentials',
    });

    const [query, params] = vi.mocked(db.query).mock.calls[0];
    expect(String(query)).toContain('orchestrator_run_id');
    expect(String(query)).toContain('missing_slots_json');
    expect(String(query)).toContain('procedure_session_id');
    expect(params?.[6]).toBe('procedure-session-1');
    expect(JSON.parse(String(params?.[21]))).toMatchObject({
      decisionStage: 'procedure_runtime',
    });
  });
});
