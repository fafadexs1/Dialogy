import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/lib/db';
import {
  completeProcedureExecution,
  createProcedureExecution,
  saveProcedureExecution,
} from '@/services/autopilot/procedure-store';
import type { ProcedureExecutionContext, ProcedureGraph } from '@/services/autopilot/procedure-types';

vi.mock('@/lib/db', () => ({
  db: {
    query: vi.fn(),
  },
}));

const workspaceId = '11111111-1111-4111-8111-111111111111';
const chatId = '22222222-2222-4222-8222-222222222222';
const agentId = '33333333-3333-4333-8333-333333333333';
const executionId = '44444444-4444-4444-8444-444444444444';

const graph: ProcedureGraph = {
  id: 'change_wifi_credentials',
  documentId: 'doc-wifi',
  documentName: 'Alterar Wi-Fi',
  version: 2,
  compiledAt: '2026-06-16T12:00:00.000Z',
  triggerIntents: ['troubleshooting'],
  triggerKeywords: ['wifi'],
  metadata: {},
  steps: [
    {
      id: 'collect_wifi_name',
      order: 1,
      type: 'gather_data',
      label: 'Coletar novo nome do Wi-Fi',
      requiredSlots: ['wifi_name'],
      nextStepId: null,
    },
  ],
};

function executionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: executionId,
    workspace_id: workspaceId,
    chat_id: chatId,
    system_agent_id: agentId,
    procedure_id: graph.id,
    procedure_name: graph.documentName,
    current_step_id: graph.steps[0].id,
    status: 'running',
    collected_slots: {},
    tool_results: {},
    decisions: {},
    retry_count: {},
    step_history: [],
    started_at: '2026-06-16T12:00:00.000Z',
    updated_at: '2026-06-16T12:00:00.000Z',
    completed_at: null,
    ...overrides,
  };
}

function context(): ProcedureExecutionContext {
  return {
    id: executionId,
    workspaceId,
    chatId,
    systemAgentId: agentId,
    procedureId: graph.id,
    procedureName: graph.documentName,
    currentStepId: 'collect_wifi_name',
    status: 'waiting_input',
    collectedSlots: { wifi_name: 'Dialogy Fibra' },
    toolResults: {},
    decisions: { confirm_change: 'yes' },
    retryCount: {},
    startedAt: '2026-06-16T12:00:00.000Z',
    updatedAt: '2026-06-16T12:00:00.000Z',
    stepHistory: [],
  };
}

describe('procedure store compatibility tables', () => {
  beforeEach(() => {
    vi.mocked(db.query).mockReset();
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 1 } as any);
  });

  it('creates the legacy execution and mirrors definition/session tables required by the decision engine plan', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({
      rows: [executionRow()],
    } as any);

    const created = await createProcedureExecution({
      workspaceId,
      chatId,
      systemAgentId: agentId,
      procedureId: graph.id,
      procedureName: graph.documentName,
      currentStepId: graph.steps[0].id,
      status: 'running',
      collectedSlots: {},
      graph,
      goal: 'change_wifi_credentials',
    });

    expect(created?.id).toBe(executionId);
    expect(vi.mocked(db.query).mock.calls[0][0]).toContain('INSERT INTO procedure_executions');
    expect(vi.mocked(db.query).mock.calls[1][0]).toContain('INSERT INTO agent_procedure_definitions');
    expect(vi.mocked(db.query).mock.calls[2][0]).toContain('INSERT INTO agent_procedure_sessions');
    expect(vi.mocked(db.query).mock.calls[2][1]?.[0]).toBe(executionId);
    expect(vi.mocked(db.query).mock.calls[2][1]?.[5]).toBe(graph.steps[0].id);
  });

  it('mirrors procedure status and slots on save', async () => {
    await saveProcedureExecution(context());

    expect(vi.mocked(db.query).mock.calls[0][0]).toContain('UPDATE procedure_executions');
    expect(vi.mocked(db.query).mock.calls[1][0]).toContain('INSERT INTO agent_procedure_sessions');
    expect(vi.mocked(db.query).mock.calls[1][1]?.[6]).toBe(JSON.stringify({ wifi_name: 'Dialogy Fibra' }));
    expect(vi.mocked(db.query).mock.calls[1][1]?.[9]).toBe('waiting_input');
  });

  it('updates the explicit procedure session alias when completing an execution', async () => {
    await completeProcedureExecution(executionId, 'completed');

    expect(vi.mocked(db.query).mock.calls[0][0]).toContain('UPDATE procedure_executions');
    expect(vi.mocked(db.query).mock.calls[1][0]).toContain('UPDATE agent_procedure_sessions');
    expect(vi.mocked(db.query).mock.calls[1][1]).toEqual(['completed', executionId]);
  });
});
