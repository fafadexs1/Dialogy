import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ db: { query: vi.fn(), connect: vi.fn() } }));
const ledger = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('@/services/autopilot/decision-ledger', () => ({ recordAgentDecisionLedger: ledger }));

import { decideInactivityAction, insideAllowedHours, MIN_WAIT_MINUTES, studioInactivityConfig } from '@/services/agent-studio/inactivity';
import { runInactivityWatchdogOnce } from '@/services/agent-studio/inactivity-runner';

const config = studioInactivityConfig({});
// 2026-11-05 is a Thursday. 15:00 UTC is 12:00 in America/Sao_Paulo; 02:00 UTC is 23:00 the day before.
const noon = new Date('2026-11-05T15:00:00Z');
const minutesAgo = (base: Date, m: number) => new Date(base.getTime() - m * 60_000);

describe('inactivity configuration', () => {
  it('defaults to 30 + 30 minutes inside 8h to 21h São Paulo time', () => {
    expect(config).toMatchObject({ followupAfterMs: 30 * 60_000, closeAfterMs: 30 * 60_000, windowStartHour: 8, windowEndHour: 21, timeZone: 'America/Sao_Paulo' });
  });

  it('never accepts a wait below the floor, however it is configured', () => {
    const c = studioInactivityConfig({ STUDIO_INACTIVITY_FOLLOWUP_MINUTES: '1', STUDIO_INACTIVITY_CLOSE_MINUTES: '0' });
    expect(c.followupAfterMs).toBe(MIN_WAIT_MINUTES * 60_000);
    expect(c.closeAfterMs).toBe(30 * 60_000);
    expect(studioInactivityConfig({ STUDIO_INACTIVITY_CLOSE_MINUTES: '2' }).closeAfterMs).toBe(MIN_WAIT_MINUTES * 60_000);
  });

  it('falls back to the default window when the setting is invalid', () => {
    for (const bad of ['banana', '21-8', '8-25', '9-9']) expect(studioInactivityConfig({ STUDIO_INACTIVITY_WINDOW: bad })).toMatchObject({ windowStartHour: 8, windowEndHour: 21 });
    expect(studioInactivityConfig({ STUDIO_INACTIVITY_WINDOW: '9-18' })).toMatchObject({ windowStartHour: 9, windowEndHour: 18 });
  });

  it('knows the allowed hours in the configured time zone', () => {
    expect(insideAllowedHours(noon, config)).toBe(true);
    expect(insideAllowedHours(new Date('2026-11-05T02:00:00Z'), config)).toBe(false);
    expect(insideAllowedHours(new Date('2026-11-05T23:59:00Z'), config)).toBe(true);
    expect(insideAllowedHours(new Date('2026-11-06T00:00:00Z'), config)).toBe(false);
  });
});

describe('inactivity decision', () => {
  const base = { now: noon, config, lastCustomerAt: minutesAgo(noon, 120), followupAt: null as Date | null };

  it('waits while the silence is shorter than the follow-up wait', () => {
    expect(decideInactivityAction({ ...base, lastAiAt: minutesAgo(noon, 29) })).toBe('wait');
  });

  it('sends one follow-up after the wait', () => {
    expect(decideInactivityAction({ ...base, lastAiAt: minutesAgo(noon, 31) })).toBe('followup');
  });

  it('does not close until the wait after the follow-up has passed, and only then', () => {
    const lastAiAt = minutesAgo(noon, 40);
    expect(decideInactivityAction({ ...base, lastAiAt, followupAt: minutesAgo(noon, 29) })).toBe('wait');
    expect(decideInactivityAction({ ...base, lastAiAt, followupAt: minutesAgo(noon, 31) })).toBe('close');
  });

  it('never closes a chat that was not warned first', () => {
    expect(decideInactivityAction({ ...base, lastCustomerAt: minutesAgo(noon, 700), lastAiAt: minutesAgo(noon, 600), followupAt: null })).toBe('followup');
  });

  it('leaves the chat alone when the customer answered after the AI', () => {
    expect(decideInactivityAction({ ...base, lastAiAt: minutesAgo(noon, 90), lastCustomerAt: minutesAgo(noon, 10) })).toBe('wait');
  });

  it('does nothing outside the allowed hours, even if everything is overdue', () => {
    const night = new Date('2026-11-05T03:00:00Z');
    expect(decideInactivityAction({ now: night, config, lastAiAt: minutesAgo(night, 600), lastCustomerAt: minutesAgo(night, 700), followupAt: minutesAgo(night, 500) })).toBe('wait');
  });

  it('closes silently, after the full wait, when the free-form window of the channel has passed', () => {
    const lastCustomerAt = minutesAgo(noon, 24 * 60);
    expect(decideInactivityAction({ ...base, lastCustomerAt, lastAiAt: minutesAgo(noon, 45) })).toBe('wait');
    expect(decideInactivityAction({ ...base, lastCustomerAt, lastAiAt: minutesAgo(noon, 61) })).toBe('close_silent');
  });

  it('handles a chat where the customer never wrote', () => {
    expect(decideInactivityAction({ ...base, lastCustomerAt: null, lastAiAt: minutesAgo(noon, 31) })).toBe('followup');
  });
});

describe('watchdog run', () => {
  const original = process.env.STUDIO_INACTIVITY_AGENT_IDS;
  beforeEach(() => { ledger.mockClear(); process.env.STUDIO_INACTIVITY_AGENT_IDS = 'agent-1'; });
  afterEach(() => { if (original === undefined) delete process.env.STUDIO_INACTIVITY_AGENT_IDS; else process.env.STUDIO_INACTIVITY_AGENT_IDS = original; });

  const candidate = (over: Record<string, unknown> = {}) => ({ chat_id: 'chat-1', workspace_id: 'ws', system_agent_id: 'sys', system_agent_name: 'Ana', agent_id: 'agent-1', session_id: 's1',
    last_ai_at: minutesAgo(noon, 40), last_customer_at: minutesAgo(noon, 120), followup_at: null, ...over });
  const database = (rows: unknown[]) => ({ query: vi.fn(async (sql: string, _params?: unknown[]) => (sql.includes('FROM chats c') ? { rows } : { rows: [], rowCount: 1 })) });
  const deps = (rows: unknown[], over: Record<string, unknown> = {}) => {
    const db = database(rows);
    return { now: () => noon, database: db as never, query: db.query,
      sendMessage: vi.fn(async () => ({ success: true })), closeChat: vi.fn(async () => ({ success: true })), ...over };
  };

  it('is off without opted-in agents', async () => {
    delete process.env.STUDIO_INACTIVITY_AGENT_IDS;
    const d = deps([candidate()]);
    expect(await runInactivityWatchdogOnce(d)).toEqual({ examined: 0, followups: 0, closed: 0, failed: 0 });
    expect(d.sendMessage).not.toHaveBeenCalled();
  });

  it('sends the follow-up once and records the marker that gates the close', async () => {
    const d = deps([candidate()]);
    expect(await runInactivityWatchdogOnce(d)).toMatchObject({ followups: 1, closed: 0 });
    expect(d.sendMessage).toHaveBeenCalledWith('chat-1', 'sys', expect.stringContaining('ainda está por aí'));
    const marker = d.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO messages'))!;
    expect(JSON.parse(String((marker[1] as unknown[])[3]))).toMatchObject({ event: 'studio_inactivity_followup', sessionId: 's1' });
    expect(ledger).toHaveBeenCalledWith(expect.objectContaining({ decisionType: 'answer', metadata: expect.objectContaining({ basis: 'inactivity_followup' }) }));
  });

  it('writes no marker when the follow-up was not delivered', async () => {
    const d = deps([candidate()], { sendMessage: vi.fn(async () => ({ success: false })) });
    expect(await runInactivityWatchdogOnce(d)).toMatchObject({ followups: 0, failed: 1 });
    expect(d.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO messages'))).toBe(false);
  });

  it('tells the customer and closes with an explicit basis once the second wait is over', async () => {
    const d = deps([candidate({ followup_at: minutesAgo(noon, 35), last_ai_at: minutesAgo(noon, 35) })]);
    expect(await runInactivityWatchdogOnce(d)).toMatchObject({ closed: 1, followups: 0 });
    expect(d.sendMessage).toHaveBeenCalledWith('chat-1', 'sys', expect.stringContaining('encerrando este atendimento'));
    expect(d.closeChat).toHaveBeenCalledOnce();
    expect(ledger).toHaveBeenCalledWith(expect.objectContaining({ decisionType: 'close', metadata: expect.objectContaining({ basis: 'inatividade_pos_followup', chatClosed: true }) }));
  });

  it('keeps the chat open when the closing message cannot be delivered', async () => {
    const d = deps([candidate({ followup_at: minutesAgo(noon, 35), last_ai_at: minutesAgo(noon, 35) })], { sendMessage: vi.fn(async () => ({ success: false })) });
    expect(await runInactivityWatchdogOnce(d)).toMatchObject({ closed: 0, failed: 1 });
    expect(d.closeChat).not.toHaveBeenCalled();
  });

  it('does not touch a chat that is not due, or anything outside the allowed hours', async () => {
    const fresh = deps([candidate({ last_ai_at: minutesAgo(noon, 5) })]);
    expect(await runInactivityWatchdogOnce(fresh)).toMatchObject({ examined: 1, followups: 0, closed: 0 });
    const night = new Date('2026-11-05T03:00:00Z');
    const overdue = deps([candidate({ last_ai_at: minutesAgo(night, 600), followup_at: minutesAgo(night, 500) })], { now: () => night });
    expect(await runInactivityWatchdogOnce(overdue)).toMatchObject({ followups: 0, closed: 0 });
    expect(overdue.sendMessage).not.toHaveBeenCalled();
  });

  it('survives one broken chat and keeps going', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const send = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ success: true });
    const d = deps([candidate({ chat_id: 'a' }), candidate({ chat_id: 'b' })], { sendMessage: send });
    expect(await runInactivityWatchdogOnce(d)).toMatchObject({ followups: 1, failed: 1 });
    error.mockRestore();
  });
});
