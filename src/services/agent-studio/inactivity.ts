import type { AgentStudioDocument, StudioAutomation } from './types';
import { studioAutomation } from './automation';

/**
 * Inactivity watchdog, pure part (docs/PLAN-ia-autonoma-transferir-encerrar.md, 3.5).
 * An AI chat where the customer stopped answering is followed up once and, if still silent, closed with an explicit
 * basis (`inatividade_pos_followup`). It never closes without having warned the customer first, never acts outside
 * the allowed hours, and enforces a floor on every wait so a misconfiguration cannot recreate 6-second closes.
 *
 * Each agent turns it on and sets the waits, hours and messages in the Studio (concludeStage.automation.inactivity).
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

/** null when the agent did not turn the watchdog on. The floor applies even if a stored value is lower. */
export function inactivityConfigFromAutomation(automation: StudioAutomation, timeZone?: string | null): InactivityConfig | null {
  const { inactivity } = automation;
  if (!inactivity.enabled) return null;
  const valid = inactivity.windowStartHour < inactivity.windowEndHour;
  return {
    followupAfterMs: Math.max(MIN_WAIT_MINUTES, inactivity.followupMinutes) * 60_000,
    closeAfterMs: Math.max(MIN_WAIT_MINUTES, inactivity.closeMinutes) * 60_000,
    windowStartHour: valid ? inactivity.windowStartHour : 8, windowEndHour: valid ? inactivity.windowEndHour : 21,
    timeZone: timeZone || 'America/Sao_Paulo',
    followupText: inactivity.followupMessage.trim() || DEFAULT_FOLLOWUP,
    closeText: inactivity.closeMessage.trim() || DEFAULT_CLOSE,
  };
}

export function inactivityConfigForAgent(document: Pick<AgentStudioDocument, 'concludeStage' | 'rules'>, env: Record<string, string | undefined> = process.env): InactivityConfig | null {
  return inactivityConfigFromAutomation(studioAutomation(document, env), document.rules?.timeZone);
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
