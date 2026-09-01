import 'server-only';

import { db } from '@/lib/db';
import { purgeExpiredStudioOperationalData, studioHistoryRetentionDays } from './operations';

const DEFAULT_INTERVAL_MS = 24 * 60 * 60_000;
const RETENTION_ADVISORY_LOCK_KEY = 6_178_202_608;
let timer: ReturnType<typeof setInterval> | undefined;
let running = false;

const positiveInteger = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export async function runAgentStudioRetentionOnce() {
  const client = await db.connect();
  try {
    const lock = await client.query('SELECT pg_try_advisory_lock($1::bigint) AS acquired', [RETENTION_ADVISORY_LOCK_KEY]);
    if (!lock.rows[0]?.acquired) return { skipped: true as const };
    try { return { skipped: false as const, ...await purgeExpiredStudioOperationalData(studioHistoryRetentionDays()) }; }
    finally { await client.query('SELECT pg_advisory_unlock($1::bigint)', [RETENTION_ADVISORY_LOCK_KEY]); }
  } finally { client.release(); }
}

export function startAgentStudioRetention() {
  if ((process.env.AGENT_STUDIO_RETENTION_ENABLED || 'false').toLowerCase() !== 'true' || timer) return;
  const interval = positiveInteger(process.env.AGENT_STUDIO_RETENTION_INTERVAL_MS, DEFAULT_INTERVAL_MS);
  const tick = () => {
    if (running) return;
    running = true;
    void runAgentStudioRetentionOnce().then((result) => {
      if (!result.skipped && (result.deletedSessions || result.clearedStates)) console.log('[AGENT_STUDIO_RETENTION]', result);
    }).catch((error) => console.error('[AGENT_STUDIO_RETENTION] Ciclo falhou:', error)).finally(() => { running = false; });
  };
  const initial = setTimeout(tick, 60_000); (initial as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
  timer = setInterval(tick, interval); (timer as ReturnType<typeof setInterval> & { unref?: () => void }).unref?.();
}

export function stopAgentStudioRetention() {
  if (timer) clearInterval(timer);
  timer = undefined; running = false;
}
