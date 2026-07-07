import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import type { CampaignScheduleConfig } from '@/lib/types';

const DEFAULT_TIME_ZONE = 'America/Sao_Paulo';
const DEFAULT_IMMEDIATE_INTERVAL_SECONDS = 2;
const MAX_SCHEDULE_LOOKAHEAD_DAYS = 370;

export type CampaignRecipientSchedule = {
  recipientId: string;
  scheduledAt: Date;
  status: 'waiting' | 'scheduled';
};

function parseClock(value: string, fallback: string): { hours: number; minutes: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(value || fallback);
  if (!match) {
    return parseClock(fallback, '00:00');
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return parseClock(fallback, '00:00');
  }

  return { hours, minutes };
}

function localDateKey(date: Date, timeZone: string): string {
  const local = toZonedTime(date, timeZone);
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
}

function localClockDate(base: Date, clock: string, timeZone: string): Date {
  const local = toZonedTime(base, timeZone);
  const { hours, minutes } = parseClock(clock, '00:00');
  local.setHours(hours, minutes, 0, 0);
  return fromZonedTime(local, timeZone);
}

function nextLocalDayStart(base: Date, clock: string, timeZone: string): Date {
  const local = toZonedTime(base, timeZone);
  local.setDate(local.getDate() + 1);
  const { hours, minutes } = parseClock(clock, '00:00');
  local.setHours(hours, minutes, 0, 0);
  return fromZonedTime(local, timeZone);
}

function nextAllowedInstant(candidate: Date, config: CampaignScheduleConfig): Date {
  const timeZone = config.timeZone || DEFAULT_TIME_ZONE;
  const allowedWeekdays = new Set(config.allowedWeekdays.length ? config.allowedWeekdays : [0, 1, 2, 3, 4, 5, 6]);
  let cursor = new Date(candidate);

  for (let dayOffset = 0; dayOffset <= MAX_SCHEDULE_LOOKAHEAD_DAYS; dayOffset += 1) {
    const local = toZonedTime(cursor, timeZone);
    const start = localClockDate(cursor, config.windowStart, timeZone);
    const end = localClockDate(cursor, config.windowEnd, timeZone);
    const weekdayAllowed = allowedWeekdays.has(local.getDay());

    if (weekdayAllowed && end.getTime() > start.getTime()) {
      if (cursor < start) {
        return start;
      }
      if (cursor < end) {
        return cursor;
      }
    }

    cursor = nextLocalDayStart(cursor, config.windowStart, timeZone);
  }

  throw new Error('Nao foi possivel encontrar uma janela valida para o agendamento.');
}

function deterministicUnitInterval(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function intervalSecondsFor(recipientId: string, config: CampaignScheduleConfig): number {
  if (config.intervalMode === 'fixed') {
    return config.intervalSeconds;
  }

  const min = Math.min(config.minIntervalSeconds, config.maxIntervalSeconds);
  const max = Math.max(config.minIntervalSeconds, config.maxIntervalSeconds);
  return Math.round(min + deterministicUnitInterval(recipientId) * (max - min));
}

function normalizeTimeZone(value: string | undefined, fallback: string): string {
  const candidate = value?.trim() || fallback;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return fallback;
  }
}

export function normalizeCampaignScheduleConfig(
  input: Partial<CampaignScheduleConfig> | null | undefined,
  timeZoneFallback = DEFAULT_TIME_ZONE,
): CampaignScheduleConfig {
  const mode = input?.mode === 'custom' ? 'custom' : 'immediate';
  const timeZone = normalizeTimeZone(input?.timeZone, timeZoneFallback);
  const intervalMode = input?.intervalMode === 'variable' ? 'variable' : 'fixed';
  const intervalSeconds = Math.max(2, Math.min(86_400, Math.round(input?.intervalSeconds || 30)));
  const minIntervalSeconds = Math.max(2, Math.min(86_400, Math.round(input?.minIntervalSeconds || 20)));
  const maxIntervalSeconds = Math.max(minIntervalSeconds, Math.min(86_400, Math.round(input?.maxIntervalSeconds || 60)));
  const dailyLimit = input?.dailyLimit == null
    ? null
    : Math.max(1, Math.min(100_000, Math.round(input.dailyLimit)));
  const allowedWeekdays = [...new Set((input?.allowedWeekdays || [1, 2, 3, 4, 5]).filter(day => Number.isInteger(day) && day >= 0 && day <= 6))];

  return {
    mode,
    timeZone,
    endAt: input?.endAt,
    windowStart: input?.windowStart || '09:00',
    windowEnd: input?.windowEnd || '18:00',
    allowedWeekdays: allowedWeekdays.length ? allowedWeekdays : [0, 1, 2, 3, 4, 5, 6],
    intervalMode,
    intervalSeconds,
    minIntervalSeconds,
    maxIntervalSeconds,
    dailyLimit,
    maxAttempts: Math.max(1, Math.min(5, Math.round(input?.maxAttempts || 3))),
    autoPauseFailureRate: Math.max(1, Math.min(100, Math.round(input?.autoPauseFailureRate || 20))),
    autoPauseMinAttempts: Math.max(5, Math.min(10_000, Math.round(input?.autoPauseMinAttempts || 20))),
    consentConfirmed: input?.consentConfirmed === true,
  };
}

export function buildCampaignRecipientSchedule(params: {
  recipientIds: string[];
  config: CampaignScheduleConfig;
  now?: Date;
}): CampaignRecipientSchedule[] {
  const now = params.now ? new Date(params.now) : new Date();
  const { recipientIds, config } = params;
  if (recipientIds.length === 0) {
    return [];
  }
  if (!config.consentConfirmed) {
    throw new Error('Confirme o consentimento dos destinatarios antes de criar a campanha.');
  }

  if (config.mode === 'immediate') {
    return recipientIds.map((recipientId, index) => ({
      recipientId,
      scheduledAt: new Date(now.getTime() + index * DEFAULT_IMMEDIATE_INTERVAL_SECONDS * 1000),
      status: 'waiting',
    }));
  }

  const endAt = config.endAt ? new Date(config.endAt) : null;
  if (!endAt || Number.isNaN(endAt.getTime()) || endAt <= now) {
    throw new Error('A data limite do envio customizado deve estar no futuro.');
  }
  const timeZone = config.timeZone || DEFAULT_TIME_ZONE;
  let cursor = nextAllowedInstant(now, config);
  let currentDay = localDateKey(cursor, timeZone);
  let sentOnCurrentDay = 0;
  const schedule: CampaignRecipientSchedule[] = [];

  for (const recipientId of recipientIds) {
    cursor = nextAllowedInstant(cursor, config);
    const cursorDay = localDateKey(cursor, timeZone);
    if (cursorDay !== currentDay) {
      currentDay = cursorDay;
      sentOnCurrentDay = 0;
    }

    if (config.dailyLimit && sentOnCurrentDay >= config.dailyLimit) {
      cursor = nextAllowedInstant(nextLocalDayStart(cursor, config.windowStart, timeZone), config);
      currentDay = localDateKey(cursor, timeZone);
      sentOnCurrentDay = 0;
    }

    if (cursor > endAt) {
      throw new Error('A janela escolhida nao comporta todos os destinatarios ate a data limite.');
    }

    schedule.push({
      recipientId,
      scheduledAt: new Date(cursor),
      status: 'scheduled',
    });
    sentOnCurrentDay += 1;

    cursor = new Date(cursor.getTime() + intervalSecondsFor(recipientId, config) * 1000);
  }

  return schedule;
}
