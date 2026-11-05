/**
 * Inactivity watchdog, pure part (docs/PLAN-ia-autonoma-transferir-encerrar.md, 3.5).
 * An AI chat where the customer stopped answering is followed up once and, if still silent, closed with an explicit
 * basis (`inatividade_pos_followup`). It never closes without having warned the customer first, never acts outside
 * the allowed hours, and enforces a floor on every wait so a misconfiguration cannot recreate 6-second closes.
 *
 * Opt-in per agent (STUDIO_INACTIVITY_AGENT_IDS, ids or *). Empty keeps the watchdog off.
 */

export const MIN_WAIT_MINUTES = 10;
const WHATSAPP_FREE_FORM_WINDOW_MS = 23 * 3_600_000;

export type InactivityConfig = {
  followupAfterMs: number;
  closeAfterMs: number;
  /** Local hours during which the watchdog may message or close, e.g. 8 to 21. */
  windowStartHour: number;
  windowEndHour: number;
  timeZone: string;
  followupText: string;
  closeText: string;
};

const DEFAULT_FOLLOWUP = 'Oi! Você ainda está por aí? Se precisar de mais alguma coisa, é só me dizer. Se não precisar, vou encerrar este atendimento em breve.';
const DEFAULT_CLOSE = 'Como não tivemos retorno, estou encerrando este atendimento por aqui. Se precisar de algo, é só chamar de novo!';

const minutes = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value || '', 10);
  return Math.max(MIN_WAIT_MINUTES, Number.isInteger(parsed) && parsed > 0 ? parsed : fallback);
};

export function studioInactivityAgentIds(): string[] {
  return process.env.STUDIO_INACTIVITY_AGENT_IDS?.split(',').map((id) => id.trim()).filter(Boolean) || [];
}

export function studioInactivityConfig(env: Record<string, string | undefined> = process.env): InactivityConfig {
  const [start, end] = (env.STUDIO_INACTIVITY_WINDOW || '8-21').split('-').map((part) => Number.parseInt(part, 10));
  const valid = Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end <= 24 && start < end;
  return {
    followupAfterMs: minutes(env.STUDIO_INACTIVITY_FOLLOWUP_MINUTES, 30) * 60_000,
    closeAfterMs: minutes(env.STUDIO_INACTIVITY_CLOSE_MINUTES, 30) * 60_000,
    windowStartHour: valid ? start : 8, windowEndHour: valid ? end : 21,
    timeZone: env.STUDIO_INACTIVITY_TZ || 'America/Sao_Paulo',
    followupText: env.STUDIO_INACTIVITY_FOLLOWUP_TEXT?.trim() || DEFAULT_FOLLOWUP,
    closeText: env.STUDIO_INACTIVITY_CLOSE_TEXT?.trim() || DEFAULT_CLOSE,
  };
}

export function insideAllowedHours(now: Date, config: Pick<InactivityConfig, 'windowStartHour' | 'windowEndHour' | 'timeZone'>): boolean {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: config.timeZone, hour: '2-digit', hourCycle: 'h23' }).format(now));
  return hour >= config.windowStartHour && hour < config.windowEndHour;
}

export type InactivityAction = 'wait' | 'followup' | 'close' | 'close_silent';

/**
 * @param lastAiAt        when the AI last wrote to the customer (the follow-up itself counts)
 * @param lastCustomerAt  when the customer last wrote, if ever
 * @param followupAt      when this watchdog's follow-up was sent after the customer's last message, if it was
 */
export function decideInactivityAction(input: {
  now: Date; lastAiAt: Date; lastCustomerAt: Date | null; followupAt: Date | null; config: InactivityConfig;
}): InactivityAction {
  const { now, lastAiAt, lastCustomerAt, followupAt, config } = input;
  // The customer answered after the AI spoke: the conversation is theirs to continue.
  if (lastCustomerAt && lastCustomerAt.getTime() >= lastAiAt.getTime()) return 'wait';
  if (!insideAllowedHours(now, config)) return 'wait';
  if (followupAt) return now.getTime() - followupAt.getTime() >= config.closeAfterMs ? 'close' : 'wait';
  const idle = now.getTime() - lastAiAt.getTime();
  if (idle < config.followupAfterMs) return 'wait';
  // Past the free-form window of the official channel a follow-up cannot be delivered; close once the full wait has passed.
  if (lastCustomerAt && now.getTime() - lastCustomerAt.getTime() > WHATSAPP_FREE_FORM_WINDOW_MS) {
    return idle >= config.followupAfterMs + config.closeAfterMs ? 'close_silent' : 'wait';
  }
  return 'followup';
}
