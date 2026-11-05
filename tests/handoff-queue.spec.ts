import { describe, expect, it, vi } from 'vitest';

import { createDefaultNodeHandlerRegistry } from '@/services/workflow-runtime/node-handlers';
import { isQueueableTeamReason } from '@/services/chat-distribution/queueable-reasons';
import { buildQueueNotice, queueChatForUnavailableTeam } from '@/services/chat-distribution/queue-unavailable-team';

vi.mock('@/lib/db', () => ({ db: { query: vi.fn() } }));

const connection = (sourceNodeId: string, connectionType: 'main' | 'error') => ({
  id: `${sourceNodeId}-${connectionType}`, sourceNodeId, sourcePortId: connectionType === 'error' ? 'error' : 'completed',
  targetNodeId: 'next', targetPortId: 'in', connectionType,
});

const handoffInput = (config: Record<string, unknown>, connections: ReturnType<typeof connection>[]) => ({
  node: { id: 'handoff', type: 'output.handoff', name: 'Transferir', config },
  workflow: { connections },
  execution: { variables: {}, input: {}, context: {}, nodeResults: {} },
  input: {},
}) as never;

const unavailable = (reasonCode: string, extra: Record<string, unknown> = {}) => ({
  success: false, error: 'Nenhum agente de a equipe Financeiro está online no momento.', reasonCode, teamId: 'team-1', ...extra,
});

const run = async (deps: Record<string, unknown>, config: Record<string, unknown>, connections: ReturnType<typeof connection>[] = []) => {
  const handler = createDefaultNodeHandlerRegistry(deps as never).get('output.handoff')!;
  return handler.execute(handoffInput({ destinationType: 'human', teamId: 'team-1', ...config }, connections));
};

describe('queueable reasons', () => {
  it('queues waiting reasons and never a team without members', () => {
    for (const reason of ['all_offline', 'not_accepting', 'portfolio_full', 'load_protected', 'outside_business_hours']) {
      expect(isQueueableTeamReason(reason)).toBe(true);
    }
    expect(isQueueableTeamReason('no_members')).toBe(false);
    expect(isQueueableTeamReason(undefined)).toBe(false);
  });
});

describe('output.handoff when the team is unavailable', () => {
  it('queues instead of failing when the error route would dead-end the execution', async () => {
    const queueHandoff = vi.fn().mockResolvedValue({ queued: true, teamName: 'Financeiro' });
    const result = await run({ handoff: async () => unavailable('all_offline'), queueHandoff }, {});
    expect(queueHandoff).toHaveBeenCalledWith(expect.anything(), { reasonCode: 'all_offline', teamId: 'team-1', error: expect.any(String) });
    expect(result).toMatchObject({ status: 'success', selectedOutput: 'completed', output: { handoffQueued: true, queuedReason: 'all_offline', success: true } });
  });

  it('treats a full team the same way', async () => {
    const queueHandoff = vi.fn().mockResolvedValue({ queued: true });
    const result = await run({ handoff: async () => unavailable('portfolio_full'), queueHandoff }, {});
    expect(result.status).toBe('success');
    expect(queueHandoff).toHaveBeenCalledOnce();
  });

  it('respects an explicit error route so authored fallbacks keep working', async () => {
    const queueHandoff = vi.fn();
    const result = await run({ handoff: async () => unavailable('all_offline'), queueHandoff }, {}, [connection('handoff', 'error')]);
    expect(queueHandoff).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'error', selectedOutput: 'error',
      error: { code: 'HANDOFF_FAILED', details: { reasonCode: 'all_offline', teamId: 'team-1' } } });
  });

  it("queues even with an error route when the node says onUnavailable: 'queue'", async () => {
    const queueHandoff = vi.fn().mockResolvedValue({ queued: true });
    const result = await run({ handoff: async () => unavailable('all_offline'), queueHandoff }, { onUnavailable: 'queue' }, [connection('handoff', 'error')]);
    expect(result.status).toBe('success');
  });

  it("never queues when the node says onUnavailable: 'error'", async () => {
    const queueHandoff = vi.fn();
    const result = await run({ handoff: async () => unavailable('all_offline'), queueHandoff }, { onUnavailable: 'error' });
    expect(queueHandoff).not.toHaveBeenCalled();
    expect(result.status).toBe('error');
  });

  it('does not queue a team without members, a conflict or an uncertain result', async () => {
    const queueHandoff = vi.fn();
    for (const failure of [unavailable('no_members'), { success: false, error: 'conflito' }, unavailable('all_offline', { outcomeUncertain: true })]) {
      const result = await run({ handoff: async () => failure, queueHandoff }, {});
      expect(result.status).toBe('error');
    }
    expect(queueHandoff).not.toHaveBeenCalled();
  });

  it('keeps the original failure when the queue itself is unavailable', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const queueHandoff of [vi.fn().mockRejectedValue(new Error('db down')), vi.fn().mockResolvedValue({ queued: false, skipped: 'chat_closed_or_missing' })]) {
      const result = await run({ handoff: async () => unavailable('all_offline'), queueHandoff }, {});
      expect(result).toMatchObject({ status: 'error', error: { code: 'HANDOFF_FAILED' } });
    }
    error.mockRestore();
  });

  it('fails as before when no queue dependency exists (sandbox and preview)', async () => {
    const result = await run({ handoff: async () => unavailable('all_offline') }, {});
    expect(result).toMatchObject({ status: 'error', error: { code: 'HANDOFF_FAILED' } });
  });

  it('leaves a successful transfer untouched', async () => {
    const queueHandoff = vi.fn();
    const result = await run({ handoff: async () => ({ success: true, assignedAgent: { id: 'a' } }), queueHandoff }, {});
    expect(result).toMatchObject({ status: 'success', selectedOutput: 'completed' });
    expect(queueHandoff).not.toHaveBeenCalled();
  });
});

describe('queueChatForUnavailableTeam', () => {
  const base = { workspaceId: 'ws', chatId: 'chat', teamId: 'team-1', reasonCode: 'all_offline' as const, operationId: 'nexus:e1:n1' };
  const queryWith = (rows: { replay?: number; team?: object | null; moved?: number }) => vi.fn(async (sql: string, _params?: unknown[]) => {
    if (sql.includes("metadata->>'operationId'")) return { rows: [], rowCount: rows.replay ?? 0 };
    if (sql.includes('FROM teams')) return { rows: rows.team === null ? [] : [rows.team ?? { name: 'Financeiro', tag: 'Financeiro', color: '#fff' }], rowCount: 1 };
    return { rows: rows.moved === 0 ? [] : [{ chat_id: 'chat' }], rowCount: rows.moved ?? 1 };
  });

  it('moves the chat to the team queue with an audit message and tells the customer', async () => {
    const query = queryWith({});
    const sendNotice = vi.fn().mockResolvedValue({ success: true });
    const afterQueued = vi.fn().mockResolvedValue(undefined);
    const result = await queueChatForUnavailableTeam({ ...base, database: { query } as never, sendNotice, afterQueued });
    expect(result).toMatchObject({ queued: true, teamName: 'Financeiro', notificationDelivered: true });
    const update = query.mock.calls.find(([sql]) => String(sql).includes('UPDATE chats'))!;
    expect(update[0]).toContain("status = 'gerais'");
    expect(update[0]).toContain("status <> 'encerrados'");
    expect(update[0]).toContain("'system'");
    expect(JSON.parse(String((update[1] as unknown[])[7]))).toMatchObject({ event: 'transfer_queued', reason: 'all_offline', operationId: 'nexus:e1:n1', to_team_id: 'team-1' });
    expect(sendNotice).toHaveBeenCalledWith(expect.stringContaining('fila de espera'));
    expect(afterQueued).toHaveBeenCalledOnce();
  });

  it('does nothing twice for the same operation', async () => {
    const query = queryWith({ replay: 1 });
    const sendNotice = vi.fn();
    const result = await queueChatForUnavailableTeam({ ...base, database: { query } as never, sendNotice });
    expect(result).toEqual({ queued: true, alreadyQueued: true });
    expect(sendNotice).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('does not touch a closed chat or notify its customer', async () => {
    const sendNotice = vi.fn();
    const result = await queueChatForUnavailableTeam({ ...base, database: { query: queryWith({ moved: 0 }) } as never, sendNotice });
    expect(result).toMatchObject({ queued: false, skipped: 'chat_closed_or_missing' });
    expect(sendNotice).not.toHaveBeenCalled();
  });

  it('refuses a team that does not belong to the workspace', async () => {
    const result = await queueChatForUnavailableTeam({ ...base, database: { query: queryWith({ team: null }) } as never });
    expect(result).toMatchObject({ queued: false, skipped: 'team_not_found' });
  });

  it('keeps the chat queued when the notice fails and reports it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await queueChatForUnavailableTeam({ ...base, database: { query: queryWith({}) } as never, sendNotice: vi.fn().mockRejectedValue(new Error('whatsapp')) });
    expect(result).toMatchObject({ queued: true, notificationDelivered: false });
    error.mockRestore();
  });

  it('queues silently when the flow sends its own message', async () => {
    const result = await queueChatForUnavailableTeam({ ...base, database: { query: queryWith({}) } as never });
    expect(result).toMatchObject({ queued: true, notificationDelivered: null });
  });

  it('adds the schedule only for outside business hours', async () => {
    const sendNotice = vi.fn().mockResolvedValue({ success: true });
    await queueChatForUnavailableTeam({ ...base, reasonCode: 'outside_business_hours', database: { query: queryWith({}) } as never,
      sendNotice, describeBusinessHours: async () => 'Segunda a Sexta das 08:00 às 18:00' });
    expect(sendNotice).toHaveBeenCalledWith(expect.stringContaining('Segunda a Sexta das 08:00 às 18:00'));
    expect(buildQueueNotice('all_offline', 'Financeiro')).not.toContain('expediente');
  });
});
