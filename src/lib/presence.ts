export const PRESENCE_LEGACY_SESSION_ID = '__legacy__';

export type PresenceEventSource =
  | 'activity'
  | 'agent_message'
  | 'api'
  | 'assign_chat'
  | 'beforeunload'
  | 'bootstrap'
  | 'browser_online'
  | 'focus'
  | 'forward_message'
  | 'heartbeat'
  | 'internal_note'
  | 'logout'
  | 'manual_recovery'
  | 'retry_message'
  | 'transfer_chat'
  | 'visibility'
  | 'workspace_switch'
  | 'workspace_switch_bootstrap'
  | 'legacy_beacon'
  | 'unknown';

export type PresenceSessionSnapshot = {
  sessionId: string;
  lastSeen: string;
};

function parsePositiveInt(rawValue: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(rawValue ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const DEFAULT_PRESENCE_TTL_S = parsePositiveInt(process.env.PRESENCE_TTL_SECONDS, 180);
const DEFAULT_PRESENCE_RECENT_ACTIVITY_S = parsePositiveInt(
  process.env.PRESENCE_RECENT_ACTIVITY_SECONDS,
  90
);
const DEFAULT_PRESENCE_HEARTBEAT_MS = parsePositiveInt(
  process.env.PRESENCE_HEARTBEAT_MS,
  30_000
);

export function getPresenceTtlSeconds(): number {
  return DEFAULT_PRESENCE_TTL_S;
}

export function getPresenceRecentActivitySeconds(): number {
  return DEFAULT_PRESENCE_RECENT_ACTIVITY_S;
}

export function getPresenceHeartbeatIntervalMs(): number {
  return DEFAULT_PRESENCE_HEARTBEAT_MS;
}

export function getPresenceTtlInterval(): string {
  return `${getPresenceTtlSeconds()} seconds`;
}

export function normalizePresenceSessionId(sessionId?: string | null): string {
  const trimmed = sessionId?.trim();
  return trimmed ? trimmed : PRESENCE_LEGACY_SESSION_ID;
}

export function pruneExpiredPresenceSessions(
  sessions: PresenceSessionSnapshot[],
  nowIso: string,
  ttlSeconds: number
): PresenceSessionSnapshot[] {
  const threshold = new Date(nowIso).getTime() - ttlSeconds * 1000;

  return sessions
    .filter((session) => new Date(session.lastSeen).getTime() > threshold)
    .sort((left, right) => new Date(right.lastSeen).getTime() - new Date(left.lastSeen).getTime());
}

export function reconcilePresenceSessions(input: {
  currentSessions: PresenceSessionSnapshot[];
  isOnline: boolean;
  nowIso: string;
  sessionId?: string | null;
  forceOffline?: boolean;
  ttlSeconds: number;
}): {
  sessions: PresenceSessionSnapshot[];
  sessionCount: number;
  isOnline: boolean;
} {
  const nextSessions = new Map(
    pruneExpiredPresenceSessions(input.currentSessions, input.nowIso, input.ttlSeconds).map((session) => [
      session.sessionId,
      session.lastSeen,
    ])
  );

  if (input.forceOffline) {
    return {
      sessions: [],
      sessionCount: 0,
      isOnline: false,
    };
  }

  const normalizedSessionId = normalizePresenceSessionId(input.sessionId);
  if (input.isOnline) {
    nextSessions.set(normalizedSessionId, input.nowIso);
  } else {
    nextSessions.delete(normalizedSessionId);
  }

  const sessions = Array.from(nextSessions.entries())
    .map(([sessionId, lastSeen]) => ({ sessionId, lastSeen }))
    .sort((left, right) => new Date(right.lastSeen).getTime() - new Date(left.lastSeen).getTime());

  return {
    sessions,
    sessionCount: sessions.length,
    isOnline: sessions.length > 0,
  };
}

export function buildPresenceAvailabilitySql(
  presenceAlias: string,
  ttlParam: string,
  recentActivityParam: string
): string {
  return `(
    (
      ${presenceAlias}.is_online = TRUE
      AND ${presenceAlias}.last_seen > NOW() - (${ttlParam} * interval '1 second')
    )
    OR (
      ${presenceAlias}.recent_activity_at IS NOT NULL
      AND ${presenceAlias}.recent_activity_at > NOW() - (${recentActivityParam} * interval '1 second')
    )
  )`;
}
