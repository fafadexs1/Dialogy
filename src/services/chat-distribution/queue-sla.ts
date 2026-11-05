import type { StudioAutomation } from '../agent-studio/types';

/**
 * Queue SLA, pure part (docs/PLAN-ia-autonoma-transferir-encerrar.md, 3.2).
 * A chat that waits in a team queue must not wait unseen: past the SLA it gets a visible marker and an honest note to the
 * customer; past the escalation wait it moves to a fallback team, or raises a "needs attention" marker when none is set.
 *
 * Configured per agent in the Studio (concludeStage.automation.queue): the agent that handed the chat over decides what
 * happens to it. Chats queued because the team is outside business hours are not measured here: their clock would run
 * while nobody is supposed to be working.
 */

export type QueueSlaConfig = {
  slaMs: number;
  escalateAfterMs: number;
  escalationTeamId: string | null;
  customerNotice: boolean;
  alertWebhookUrl: string | null;
};

export const MIN_SLA_MINUTES = 2;

/** null when the agent did not turn the queue follow-up on. Escalation is always later than the alert. */
export function queueSlaConfigFromAutomation(automation: StudioAutomation): QueueSlaConfig | null {
  const { queue } = automation;
  if (!queue.enabled) return null;
  const sla = Math.max(MIN_SLA_MINUTES, queue.alertAfterMinutes);
  const escalate = Math.max(sla + 1, queue.escalateAfterMinutes);
  const team = queue.escalationTeamId?.trim();
  return {
    slaMs: sla * 60_000, escalateAfterMs: escalate * 60_000,
    escalationTeamId: team && /^[0-9a-f-]{36}$/i.test(team) ? team : null,
    customerNotice: queue.notifyCustomer,
    alertWebhookUrl: queue.alertWebhookUrl?.trim() || null,
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
