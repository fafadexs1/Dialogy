import { StudioAutomationSchema, type AgentStudioDocument, type StudioAutomation } from './types';

/**
 * The only place that turns an agent's settings into runtime behaviour. Everything the plan added (explicit close,
 * human-request guard, promise guard, inactivity watchdog, queue SLA) is configured per agent in the Studio.
 *
 * STUDIO_AUTOMATION_KILL_SWITCH=true is an operator-only brake for the whole platform (not a tenant setting): it forces
 * every automation off without touching anyone's configuration.
 */
export function studioAutomationKilled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.STUDIO_AUTOMATION_KILL_SWITCH || '').trim().toLowerCase() === 'true';
}

const OFF: StudioAutomation = StudioAutomationSchema.parse({ promiseGuard: 'off' });

/** Always returns a complete, valid object, even for documents saved before these settings existed. */
export function studioAutomation(document: Pick<AgentStudioDocument, 'concludeStage'>, env: Record<string, string | undefined> = process.env): StudioAutomation {
  if (studioAutomationKilled(env)) return OFF;
  const parsed = StudioAutomationSchema.safeParse(document.concludeStage?.automation ?? {});
  return parsed.success ? parsed.data : StudioAutomationSchema.parse({});
}

export type StudioAutomationIssue = { code: string; title: string };

/** Pure checks for publication. Team existence is verified when the escalation runs, because it needs the database. */
export function checkStudioAutomation(document: Pick<AgentStudioDocument, 'concludeStage'>): StudioAutomationIssue[] {
  const parsed = StudioAutomationSchema.safeParse(document.concludeStage?.automation ?? {});
  if (!parsed.success) return [{ code: 'AUTOMATION_INVALID', title: `Revise a autonomia do agente: ${parsed.error.issues[0]?.message || 'valor inválido'}.` }];
  const { inactivity, queue } = parsed.data;
  const issues: StudioAutomationIssue[] = [];
  if (inactivity.enabled && inactivity.windowStartHour >= inactivity.windowEndHour) {
    issues.push({ code: 'AUTOMATION_WINDOW_INVALID', title: 'O horário de aviso por inatividade precisa ter início antes do fim.' });
  }
  if (queue.enabled && queue.escalateAfterMinutes <= queue.alertAfterMinutes) {
    issues.push({ code: 'AUTOMATION_QUEUE_ORDER', title: 'O escalonamento da fila precisa vir depois do alerta.' });
  }
  if (queue.alertWebhookUrl) {
    try {
      const url = new URL(queue.alertWebhookUrl);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
    } catch {
      issues.push({ code: 'AUTOMATION_WEBHOOK_INVALID', title: 'O endereço de alerta da fila precisa ser uma URL https sem usuário e senha.' });
    }
  }
  return issues;
}
