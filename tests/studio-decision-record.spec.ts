import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/lib/db';
import { recordAgentDecisionLedger } from '@/services/autopilot/decision-ledger';
import { buildStudioDecisionLedgerEntry, classifyStudioTurnDecision } from '@/services/agent-studio/decision-record';
import { createStudioSession, type StudioSession } from '@/services/agent-studio/engine';

vi.mock('@/lib/db', () => ({ db: { query: vi.fn() } }));
vi.mock('server-only', () => ({}));

const base = (patch: Partial<StudioSession> = {}): StudioSession => ({
  ...createStudioSession('agent-1', 'release-1', 'session-1'), ...patch,
});

const reasoning = (operations: Array<{ status: string }> = []) => ({
  version: 2, requests: [], pendingAction: null, operations,
}) as unknown as StudioSession['reasoning'];

describe('studio decision classification', () => {
  it('records a executed transfer as a handoff', () => {
    expect(classifyStudioTurnDecision(base({ status: 'transferred', phase: 'done' })))
      .toEqual({ decisionType: 'handoff', basis: 'handoff_executed' });
  });

  it('flags a transfer that left an uncertain operation behind', () => {
    expect(classifyStudioTurnDecision(base({ status: 'transferred', phase: 'done', reasoning: reasoning([{ status: 'unknown' }]) })))
      .toEqual({ decisionType: 'handoff', basis: 'handoff_with_uncertain_operation' });
  });

  it('labels the reasoning core implicit close separately from a completed journey', () => {
    expect(classifyStudioTurnDecision(base({ status: 'resolved', phase: 'done', reasoning: reasoning() })).basis)
      .toBe('implicit_all_requests_resolved');
    expect(classifyStudioTurnDecision(base({ status: 'resolved', phase: 'done' })).basis).toBe('journey_completed');
  });

  it('does not call a resolved session closed until it is done', () => {
    expect(classifyStudioTurnDecision(base({ status: 'resolved', phase: 'resolve' })).decisionType).not.toBe('close');
  });

  it('separates a waiting turn with a pending field from a plain answer', () => {
    expect(classifyStudioTurnDecision(base({ status: 'waiting_input', pendingField: 'cpf' })).decisionType).toBe('ask_slot');
    expect(classifyStudioTurnDecision(base({ status: 'waiting_input' })).decisionType).toBe('answer');
  });

  it('keeps uncertain operations visible while waiting', () => {
    expect(classifyStudioTurnDecision(base({ status: 'waiting_input', reasoning: reasoning([{ status: 'unknown' }]) })))
      .toEqual({ decisionType: 'continue_llm', basis: 'waiting_with_uncertain_operation' });
  });

  it('maps failures and cancellations to fallback', () => {
    expect(classifyStudioTurnDecision(base({ status: 'failed' })).basis).toBe('session_failed');
    expect(classifyStudioTurnDecision(base({ status: 'cancelled' })).basis).toBe('session_cancelled');
  });
});

describe('studio ledger entry', () => {
  const entryFor = (state: StudioSession, extra: Partial<Parameters<typeof buildStudioDecisionLedgerEntry>[0]> = {}) =>
    buildStudioDecisionLedgerEntry({
      workspaceId: 'ws-1', chatId: 'chat-1', messageId: 'msg-1', runId: 'run-1', systemAgentId: 'sys-1',
      autopilotConfigId: 'agent-1', releaseId: 'release-1', releaseVersion: 28, state,
      decisionMode: 'model_reasoning', suggestionOnly: false, replay: false, ...extra,
    });

  it('carries ids, mode and session linkage in metadata', () => {
    const entry = entryFor(base({ status: 'transferred', phase: 'done' }));
    expect(entry).toMatchObject({
      workspaceId: 'ws-1', chatId: 'chat-1', autopilotConfigId: 'agent-1', decisionType: 'handoff', decisionStage: 'studio_turn',
    });
    expect(entry.metadata).toMatchObject({
      source: 'studio', studioSessionId: 'session-1', studioReleaseId: 'release-1', studioVersion: 28,
      decisionMode: 'model_reasoning', suggestionOnly: false, basis: 'handoff_executed',
    });
  });

  it('records whether the chat row was really closed, not only that the session resolved', () => {
    const resolved = base({ status: 'resolved', phase: 'done', reasoning: reasoning() });
    expect(entryFor(resolved, { chatClosed: false }).metadata).toMatchObject({ basis: 'implicit_all_requests_resolved', chatClosed: false });
    expect(entryFor(resolved, { chatClosed: true }).metadata).toMatchObject({ chatClosed: true });
    expect(entryFor(resolved).metadata).toMatchObject({ chatClosed: null });
  });

  it('marks suggestion-only turns so they can serve as shadow-mode data', () => {
    expect(entryFor(base({ status: 'resolved', phase: 'done', reasoning: reasoning() }), { suggestionOnly: true }).metadata)
      .toMatchObject({ suggestionOnly: true, basis: 'implicit_all_requests_resolved' });
  });

  it('never copies customer text or free-form handoff reasons', () => {
    const state = base({
      status: 'transferred', phase: 'done',
      values: { cpf: '123.456.789-00' },
      conversationMemory: [{ messageId: 'm', customer: 'meu cpf é 123.456.789-00', assistant: 'ok' }],
      lastTurn: { messageId: 'm', response: 'segredo da resposta', outcome: 'transferred' },
      events: [{ stepId: 'reasoning-v2', label: 'Transferência executada', kind: 'transferred', at: 'now' }],
    });
    const serialized = JSON.stringify(entryFor(state));
    expect(serialized).not.toContain('123.456.789-00');
    expect(serialized).not.toContain('segredo da resposta');
    expect(serialized).toContain('"lastEventKind":"transferred"');
  });
});

describe('decision ledger write failures', () => {
  beforeEach(() => { vi.mocked(db.query).mockReset(); });

  it('stays silent only when the table is missing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(db.query).mockRejectedValueOnce(new Error('relation "agent_decision_ledger" does not exist'));
    await recordAgentDecisionLedger({ workspaceId: 'w', decisionStage: 's', decisionType: 'answer' });
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('reports constraint violations that mention the table name', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(db.query).mockRejectedValueOnce(new Error('insert or update on table "agent_decision_ledger" violates foreign key constraint "agent_decision_ledger_message_id_fkey"'));
    await recordAgentDecisionLedger({ workspaceId: 'w', decisionStage: 's', decisionType: 'answer' });
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});
