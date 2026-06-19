import { enqueueAiAutopilotLearningCycle, shouldEnqueueJob } from '@/lib/queue';
import type { AiAutopilotLearningCyclePayload } from '@/lib/queue/types';

const DEFAULT_RUN_HOUR_UTC = 3;
const DEFAULT_RUN_MINUTE_UTC = 20;
const DEFAULT_SINCE_DAYS = 30;
const DEFAULT_WORKSPACE_LIMIT = 50;
const DEFAULT_PRIORITY = 20;

type SchedulerEnv = Record<string, string | undefined>;

export type AutopilotLearningCycleScheduler = {
  getNextRunAt: () => Date | null;
  stop: () => void;
  triggerNow: () => Promise<{ id: string }>;
};

function parseInteger(value: string | undefined, fallback: number) {
  if (!value?.trim()) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseOptionalInteger(value: string | undefined) {
  if (!value?.trim()) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseBoolean(value: string | undefined, fallback = false) {
  if (!value?.trim()) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'sim', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'nao', 'off'].includes(normalized)) return false;
  return fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function readOptionalText(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function isAutopilotLearningSchedulerEnabled(env: SchedulerEnv = process.env) {
  return parseBoolean(
    env.AUTOPILOT_LEARNING_SCHEDULER_ENABLED,
    env.NODE_ENV === 'production'
  );
}

export function getNextAutopilotLearningRunAt(
  now = new Date(),
  env: SchedulerEnv = process.env
) {
  const hour = clamp(
    parseInteger(env.AUTOPILOT_LEARNING_SCHEDULE_HOUR_UTC, DEFAULT_RUN_HOUR_UTC),
    0,
    23
  );
  const minute = clamp(
    parseInteger(env.AUTOPILOT_LEARNING_SCHEDULE_MINUTE_UTC, DEFAULT_RUN_MINUTE_UTC),
    0,
    59
  );

  const next = new Date(now);
  next.setUTCSeconds(0, 0);
  next.setUTCHours(hour, minute, 0, 0);

  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }

  return next;
}

export function buildScheduledAutopilotLearningPayload(
  now = new Date(),
  env: SchedulerEnv = process.env
): AiAutopilotLearningCyclePayload {
  const workspaceId = readOptionalText(env.AUTOPILOT_LEARNING_WORKSPACE_ID);
  const vertical = readOptionalText(env.AUTOPILOT_LEARNING_VERTICAL);
  const sinceDays = Math.max(
    parseInteger(env.AUTOPILOT_LEARNING_SINCE_DAYS, DEFAULT_SINCE_DAYS),
    1
  );
  const limit = Math.max(
    parseInteger(env.AUTOPILOT_LEARNING_WORKSPACE_LIMIT, DEFAULT_WORKSPACE_LIMIT),
    1
  );
  const dateKey = now.toISOString().slice(0, 10);

  return {
    workspaceId,
    vertical,
    sinceDays,
    limit,
    dryRun: parseBoolean(env.AUTOPILOT_LEARNING_DRY_RUN),
    promoteEcosystem: !parseBoolean(env.AUTOPILOT_LEARNING_SKIP_ECOSYSTEM_PROMOTION),
    createScoreSuggestions: !parseBoolean(env.AUTOPILOT_LEARNING_SKIP_SCORE_SUGGESTIONS),
    jobKey: [
      'daily',
      dateKey,
      workspaceId || 'all',
      vertical || 'all',
      sinceDays,
      limit,
    ].join('__'),
  };
}

export async function enqueueScheduledAutopilotLearningCycle(
  now = new Date(),
  env: SchedulerEnv = process.env
) {
  const payload = buildScheduledAutopilotLearningPayload(now, env);
  return enqueueAiAutopilotLearningCycle(payload, {
    priority: parseInteger(env.AUTOPILOT_LEARNING_QUEUE_PRIORITY, DEFAULT_PRIORITY),
    maxAttempts: parseOptionalInteger(env.AUTOPILOT_LEARNING_QUEUE_ATTEMPTS),
  });
}

export function startAutopilotLearningCycleScheduler(
  env: SchedulerEnv = process.env
): AutopilotLearningCycleScheduler | null {
  if (!isAutopilotLearningSchedulerEnabled(env)) {
    console.log('[AUTOPILOT_LEARNING_SCHEDULER] Disabled.');
    return null;
  }

  if (!shouldEnqueueJob('ai_autopilot_learning_cycle')) {
    console.warn(
      '[AUTOPILOT_LEARNING_SCHEDULER] Queue job ai_autopilot_learning_cycle is not enabled.'
    );
    return null;
  }

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let nextRunAt: Date | null = null;

  const scheduleNext = () => {
    nextRunAt = getNextAutopilotLearningRunAt(new Date(), env);
    const delay = Math.max(nextRunAt.getTime() - Date.now(), 1000);

    timer = setTimeout(async () => {
      try {
        const result = await enqueueScheduledAutopilotLearningCycle(new Date(), env);
        console.log(
          `[AUTOPILOT_LEARNING_SCHEDULER] Enqueued daily learning cycle job ${result.id}.`
        );
      } catch (error) {
        console.error('[AUTOPILOT_LEARNING_SCHEDULER] Failed to enqueue learning cycle:', error);
      } finally {
        if (!stopped) {
          scheduleNext();
        }
      }
    }, delay);

    const maybeNodeTimer = timer as ReturnType<typeof setTimeout> & { unref?: () => void };
    maybeNodeTimer.unref?.();

    console.log(
      `[AUTOPILOT_LEARNING_SCHEDULER] Next learning cycle at ${nextRunAt.toISOString()}.`
    );
  };

  scheduleNext();

  return {
    getNextRunAt: () => nextRunAt,
    stop: () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
    triggerNow: () => enqueueScheduledAutopilotLearningCycle(new Date(), env),
  };
}
