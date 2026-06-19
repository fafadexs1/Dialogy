import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/lib/db';
import { buildDecisionOutcome, recordDecisionOutcomesForChat } from '@/services/autopilot/outcome-tracker';

vi.mock('@/lib/db', () => ({
  db: {
    query: vi.fn(),
  },
}));

describe('autopilot outcome tracker', () => {
  beforeEach(() => {
    vi.mocked(db.query).mockReset();
  });

  it('marks successful close_chat as automated resolution', () => {
    const outcome = buildDecisionOutcome({
      trigger: 'closed',
      chatStatus: 'encerrados',
      chatCreatedAt: '2026-06-15T10:00:00.000Z',
      closedAt: '2026-06-15T10:04:00.000Z',
      messages: [
        { id: 'm1', content: 'Preciso da segunda via.', fromMe: false, createdAt: '2026-06-15T10:00:00.000Z' },
        { id: 'm2', content: 'Claro, segue a segunda via.', fromMe: true, createdAt: '2026-06-15T10:03:00.000Z' },
        { id: 'm3', content: 'Obrigado, deu certo.', fromMe: false, createdAt: '2026-06-15T10:04:00.000Z' },
      ],
      toolCalls: [
        { toolName: 'close_chat', status: 'success', createdAt: '2026-06-15T10:04:00.000Z' },
      ],
      decisions: [
        {
          messageId: 'm1',
          decisionType: 'call_tool',
          procedureId: 'proc-billing',
          stepId: 'fetch-invoice',
          selectedTools: ['sgp_fetch_contact_panel_data'],
        },
      ],
    });

    expect(outcome).toMatchObject({
      resolved: true,
      resolutionType: 'automated',
      turnsToResolve: 2,
      timeToResolutionSeconds: 240,
      customerSentimentFinal: 'positive',
      toolsExecuted: ['close_chat'],
      closedBy: 'agent',
    });
    expect(outcome.stepOutcomes).toEqual([
      expect.objectContaining({
        procedureId: 'proc-billing',
        stepId: 'fetch-invoice',
        turnsOnStep: 1,
      }),
    ]);
  });

  it('marks transfer_chat as human handoff and escalation', () => {
    const outcome = buildDecisionOutcome({
      trigger: 'handoff',
      chatStatus: 'atendimentos',
      chatCreatedAt: '2026-06-15T11:00:00.000Z',
      messages: [
        { id: 'm1', content: 'Quero falar com um atendente humano.', fromMe: false, createdAt: '2026-06-15T11:00:00.000Z' },
      ],
      toolCalls: [
        { toolName: 'transfer_chat', status: 'success', createdAt: '2026-06-15T11:01:30.000Z' },
      ],
      decisions: [
        {
          messageId: 'm1',
          decisionType: 'handoff',
          procedureId: 'proc-handoff',
          stepId: 'transfer',
          selectedTools: ['transfer_chat'],
        },
      ],
    });

    expect(outcome).toMatchObject({
      resolved: false,
      resolutionType: 'human_handoff',
      customerAskedForHuman: true,
      escalationNeeded: true,
      toolsExecuted: ['transfer_chat'],
    });
    expect(outcome.stepOutcomes[0]).toMatchObject({
      escalated: true,
    });
  });

  it('persists computed outcome into pending ledger rows for the chat', async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce({
        rows: [{
          id: 'chat-1',
          status: 'encerrados',
          created_at: '2026-06-15T10:00:00.000Z',
          closed_at: '2026-06-15T10:05:00.000Z',
        }],
      } as any)
      .mockResolvedValueOnce({
        rows: [
          { id: 'm1', content: 'Obrigado, resolvido.', from_me: false, created_at: '2026-06-15T10:00:00.000Z' },
        ],
      } as any)
      .mockResolvedValueOnce({
        rows: [
          { tool_name: 'close_chat', status: 'success', created_at: '2026-06-15T10:05:00.000Z' },
        ],
      } as any)
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'ledger-1',
            message_id: 'm1',
            decision_type: 'close',
            procedure_id: null,
            step_id: null,
            selected_tools_json: ['close_chat'],
            created_at: '2026-06-15T10:04:00.000Z',
          },
        ],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any);

    const outcome = await recordDecisionOutcomesForChat({
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      trigger: 'closed',
    });

    expect(outcome?.resolutionType).toBe('automated');
    const updateCall = vi.mocked(db.query).mock.calls.find(([query]) => (
      String(query).includes('UPDATE agent_decision_ledger')
    ));
    expect(updateCall).toBeTruthy();
    expect(updateCall?.[1]).toEqual([
      'workspace-1',
      'chat-1',
      expect.stringContaining('"resolutionType":"automated"'),
    ]);
  });
});
