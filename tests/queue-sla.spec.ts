import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ db: { query: vi.fn(), connect: vi.fn() } }));
const ledger = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('@/services/autopilot/decision-ledger', () => ({ recordAgentDecisionLedger: ledger }));

import { decideQueueSlaAction, MIN_SLA_MINUTES, queueSlaConfig } from '@/services/chat-distribution/queue-sla';
import { runQueueSlaOnce } from '@/services/chat-distribution/queue-sla-runner';

const T = '11111111-1111-4111-8111-111111111111';
const ESC = '22222222-2222-4222-8222-222222222222';
const now = new Date('2026-11-05T15:00:00Z');
const ago = (m: number) => new Date(now.getTime() - m * 60_000);
const cfg = queueSlaConfig({ QUEUE_SLA_ENABLED: 'true', QUEUE_SLA_ESCALATION_TEAM_ID: ESC });
const noEscalation = queueSlaConfig({ QUEUE_SLA_ENABLED: 'true' });

describe('queue SLA configuration', () => {
  it('is off by default and defaults to 10 minutes to alert, 20 to escalate', () => {
    expect(queueSlaConfig({}).enabled).toBe(false);
    expect(cfg).toMatchObject({ slaMs: 10 * 60_000, escalateAfterMs: 20 * 60_000, escalationTeamId: ESC, customerNotice: true });
  });

  it('keeps a floor, makes escalation later than the alert and ignores an invalid team id', () => {
    expect(queueSlaConfig({ QUEUE_SLA_MINUTES: '1' }).slaMs).toBe(MIN_SLA_MINUTES * 60_000);
    const c = queueSlaConfig({ QUEUE_SLA_MINUTES: '15', QUEUE_SLA_ESCALATE_MINUTES: '5', QUEUE_SLA_ESCALATION_TEAM_ID: 'not-a-uuid' });
    expect(c.escalateAfterMs).toBeGreaterThan(c.slaMs);
    expect(c.escalationTeamId).toBeNull();
  });

  it('lets the customer notice be switched off', () => {
    expect(queueSlaConfig({ QUEUE_SLA_CUSTOMER_NOTICE: 'false' }).customerNotice).toBe(false);
  });
});

describe('queue SLA decision', () => {
  const base = { now, currentTeamId: T, breachAt: null as Date | null, neededAt: null as Date | null, config: cfg };

  it('waits before the SLA', () => expect(decideQueueSlaAction({ ...base, queuedAt: ago(9) })).toBe('wait'));
  it('raises the alert once the SLA is over', () => expect(decideQueueSlaAction({ ...base, queuedAt: ago(11) })).toBe('breach'));
  it('does not alert twice', () => expect(decideQueueSlaAction({ ...base, queuedAt: ago(15), breachAt: ago(4) })).toBe('wait'));
  it('escalates to the fallback team after the escalation wait', () => {
    expect(decideQueueSlaAction({ ...base, queuedAt: ago(21), breachAt: ago(10) })).toBe('escalate');
  });
  it('asks for attention, once, when there is nowhere to escalate', () => {
    const c = { ...base, config: noEscalation, queuedAt: ago(21), breachAt: ago(10) };
    expect(decideQueueSlaAction(c)).toBe('escalation_needed');
    expect(decideQueueSlaAction({ ...c, neededAt: ago(1) })).toBe('wait');
  });
  it('does not escalate a chat that is already in the fallback team', () => {
    expect(decideQueueSlaAction({ ...base, currentTeamId: ESC, queuedAt: ago(21), breachAt: ago(10) })).toBe('escalation_needed');
  });
});

describe('queue SLA run', () => {
  beforeEach(() => ledger.mockClear());
  const row = (over: Record<string, unknown> = {}) => ({ chat_id: 'chat-1', workspace_id: 'ws', queued_at: ago(11), team_id: T, current_team_id: T,
    breach_at: null, needed_at: null, notice_agent_id: 'sys', team_name: 'Financeiro', ...over });
  const setup = (rows: unknown[], over: Record<string, unknown> = {}) => {
    const query = vi.fn(async (sql: string) => (sql.includes('WITH q AS') ? { rows } : { rows: [], rowCount: 1 }));
    return { now: () => now, database: { query } as never, sendNotice: vi.fn(async () => ({ success: true })),
      escalate: vi.fn(async () => ({ queued: true, teamName: 'Gerência' })), alert: vi.fn(async () => undefined), query, ...over };
  };
  const markers = (d: { query: ReturnType<typeof vi.fn> }) => d.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO messages'))
    .map(([, params]) => JSON.parse(String((params as unknown[])[4])).event);

  it('does nothing when disabled', async () => {
    const d = setup([row()]);
    expect(await runQueueSlaOnce(d, queueSlaConfig({}))).toEqual({ examined: 0, breached: 0, escalated: 0, needsAttention: 0, failed: 0 });
    expect(d.query).not.toHaveBeenCalled();
  });

  it('marks the breach, tells the customer once and alerts without customer data', async () => {
    const d = setup([row()]);
    expect(await runQueueSlaOnce(d, cfg)).toMatchObject({ breached: 1 });
    expect(markers(d)).toEqual(['queue_sla_breached']);
    expect(d.sendNotice).toHaveBeenCalledWith('chat-1', 'sys', expect.stringContaining('continua na fila'));
    expect(d.alert).toHaveBeenCalledWith({ workspaceId: 'ws', chatId: 'chat-1', teamId: T, minutesWaiting: 11, event: 'queue_sla_breached' });
    expect(ledger).toHaveBeenCalledWith(expect.objectContaining({ decisionStage: 'queue_sla', metadata: expect.objectContaining({ basis: 'breach' }) }));
  });

  it('sends no customer note when switched off or when the chat has no system sender', async () => {
    const off = setup([row()]);
    await runQueueSlaOnce(off, { ...cfg, customerNotice: false });
    const noSender = setup([row({ notice_agent_id: null })]);
    await runQueueSlaOnce(noSender, cfg);
    expect(off.sendNotice).not.toHaveBeenCalled();
    expect(noSender.sendNotice).not.toHaveBeenCalled();
    expect(markers(noSender)).toEqual(['queue_sla_breached']);
  });

  it('escalates to the fallback team and records it', async () => {
    const d = setup([row({ queued_at: ago(21), breach_at: ago(10) })]);
    expect(await runQueueSlaOnce(d, cfg)).toMatchObject({ escalated: 1 });
    expect(d.escalate).toHaveBeenCalledWith(expect.objectContaining({ chat_id: 'chat-1' }), ESC, expect.stringMatching(/^sla:chat-1:/));
    expect(markers(d)).toEqual(['queue_sla_escalated']);
  });

  it('does not mark an escalation that did not happen', async () => {
    const d = setup([row({ queued_at: ago(21), breach_at: ago(10) })], { escalate: vi.fn(async () => ({ queued: false })) });
    expect(await runQueueSlaOnce(d, cfg)).toMatchObject({ escalated: 0, failed: 1 });
    expect(markers(d)).toEqual([]);
  });

  it('raises a needs-attention marker when no escalation team exists', async () => {
    const d = setup([row({ queued_at: ago(21), breach_at: ago(10) })]);
    expect(await runQueueSlaOnce(d, noEscalation)).toMatchObject({ needsAttention: 1 });
    expect(markers(d)).toEqual(['queue_sla_escalation_needed']);
    expect(d.escalate).not.toHaveBeenCalled();
  });

  it('leaves chats inside the SLA alone and survives an alert failure', async () => {
    const fresh = setup([row({ queued_at: ago(3) })]);
    expect(await runQueueSlaOnce(fresh, cfg)).toMatchObject({ examined: 1, breached: 0 });
    const flaky = setup([row()], { alert: vi.fn(async () => { throw new Error('webhook down'); }) });
    expect(await runQueueSlaOnce(flaky, cfg)).toMatchObject({ breached: 1, failed: 0 });
  });
});
