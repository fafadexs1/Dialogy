/**
 * Queue SLA, pure part (docs/PLAN-ia-autonoma-transferir-encerrar.md, 3.2).
 * A chat that waits in a team queue must not wait unseen: past the SLA it gets a visible marker and an honest note to the
 * customer; past the escalation wait it moves to a fallback team, or raises a "needs attention" marker when none is set.
 *
 * Off unless QUEUE_SLA_ENABLED=true. Chats queued because the team is outside business hours are not measured here:
 * their clock would run while nobody is supposed to be working.
 */

export type QueueSlaConfig = {
  enabled: boolean;
  slaMs: number;
  escalateAfterMs: number;
  escalationTeamId: string | null;
  customerNotice: boolean;
  alertWebhookUrl: string | null;
};

export const MIN_SLA_MINUTES = 2;

export function queueSlaConfig(env: Record<string, string | undefined> = process.env): QueueSlaConfig {
  const parse = (value: string | undefined, fallback: number, floor: number) => {
    const parsed = Number.parseInt(value || '', 10);
    return Math.max(floor, Number.isInteger(parsed) && parsed > 0 ? parsed : fallback);
  };
  const sla = parse(env.QUEUE_SLA_MINUTES, 10, MIN_SLA_MINUTES);
  const escalate = Math.max(sla + 1, parse(env.QUEUE_SLA_ESCALATE_MINUTES, sla * 2, sla + 1));
  const team = env.QUEUE_SLA_ESCALATION_TEAM_ID?.trim();
  return {
    enabled: (env.QUEUE_SLA_ENABLED || 'false').trim().toLowerCase() === 'true',
    slaMs: sla * 60_000, escalateAfterMs: escalate * 60_000,
    escalationTeamId: team && /^[0-9a-f-]{36}$/i.test(team) ? team : null,
    customerNotice: (env.QUEUE_SLA_CUSTOMER_NOTICE || 'true').trim().toLowerCase() !== 'false',
    alertWebhookUrl: env.QUEUE_SLA_ALERT_WEBHOOK_URL?.trim() || null,
  };
}

export type QueueSlaAction = 'wait' | 'breach' | 'escalate' | 'escalation_needed';

export function decideQueueSlaAction(input: {
  now: Date;
  queuedAt: Date;
  /** Markers written after `queuedAt`; a new queueing (including an escalation) resets both. */
  breachAt: Date | null;
  neededAt: Date | null;
  currentTeamId: string | null;
  config: Pick<QueueSlaConfig, 'slaMs' | 'escalateAfterMs' | 'escalationTeamId'>;
}): QueueSlaAction {
  const { now, queuedAt, breachAt, neededAt, currentTeamId, config } = input;
  const age = now.getTime() - queuedAt.getTime();
  if (age < config.slaMs) return 'wait';
  if (!breachAt) return 'breach';
  if (age < config.escalateAfterMs) return 'wait';
  if (config.escalationTeamId && currentTeamId !== config.escalationTeamId) return 'escalate';
  return neededAt ? 'wait' : 'escalation_needed';
}
