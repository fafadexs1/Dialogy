import 'server-only';

import type { PoolClient } from 'pg';

import { db } from '@/lib/db';
import {
  buildPresenceAvailabilitySql,
  getPresenceRecentActivitySeconds,
  getPresenceTtlSeconds,
  reconcilePresenceSessions,
  type PresenceEventSource,
  type PresenceSessionSnapshot,
} from '@/lib/presence';
import { normalizeSupabaseStorageUrl } from '@/lib/storage-url';
import type { OnlineAgent } from '@/lib/types';

type PresenceMutationOptions = {
  userId: string;
  workspaceId: string;
  isOnline: boolean;
  tabId?: string | null;
  forceOffline?: boolean;
  source?: PresenceEventSource;
  touchRecentActivity?: boolean;
  clearRecentActivity?: boolean;
};

type PresenceProjectionSnapshot = {
  activeSessions: Record<string, string>;
  isOnline: boolean;
  lastSeen: string | null;
  onlineSince: string | null;
  recentActivityAt: string | null;
};

function serializeActiveSessions(sessions: PresenceSessionSnapshot[]): Record<string, string> {
  return Object.fromEntries(sessions.map((session) => [session.sessionId, session.lastSeen]));
}

function buildPresenceProjectionSnapshot(row: any): PresenceProjectionSnapshot {
  const metadata = row?.metadata ?? {};
  return {
    activeSessions:
      metadata && typeof metadata === 'object' && metadata.active_sessions && typeof metadata.active_sessions === 'object'
        ? metadata.active_sessions
        : {},
    isOnline: Boolean(row?.is_online),
    lastSeen: row?.last_seen ? new Date(row.last_seen).toISOString() : null,
    onlineSince: row?.online_since ? new Date(row.online_since).toISOString() : null,
    recentActivityAt: row?.recent_activity_at ? new Date(row.recent_activity_at).toISOString() : null,
  };
}

function logPresenceMutation(input: {
  event: string;
  userId: string;
  workspaceId: string;
  sessionId?: string | null;
  source: PresenceEventSource;
  previousSessionCount: number;
  nextSessionCount: number;
  previousState: PresenceProjectionSnapshot;
  nextState: PresenceProjectionSnapshot;
}) {
  console.info(
    '[PRESENCE]',
    JSON.stringify({
      event: input.event,
      userId: input.userId,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId ?? null,
      source: input.source,
      previousSessionCount: input.previousSessionCount,
      nextSessionCount: input.nextSessionCount,
      previousIsOnline: input.previousState.isOnline,
      nextIsOnline: input.nextState.isOnline,
      previousLastSeen: input.previousState.lastSeen,
      nextLastSeen: input.nextState.lastSeen,
      previousRecentActivityAt: input.previousState.recentActivityAt,
      nextRecentActivityAt: input.nextState.recentActivityAt,
    })
  );
}

async function acquirePresenceLock(client: PoolClient, userId: string, workspaceId: string): Promise<void> {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
    [userId, workspaceId]
  );
}

async function getProjectionSnapshot(
  client: PoolClient,
  userId: string,
  workspaceId: string
): Promise<PresenceProjectionSnapshot> {
  const projectionRes = await client.query(
    `
      SELECT is_online, online_since, last_seen, recent_activity_at, metadata
      FROM user_workspace_presence
      WHERE user_id = $1 AND workspace_id = $2
      FOR UPDATE
    `,
    [userId, workspaceId]
  );

  return buildPresenceProjectionSnapshot(projectionRes.rows[0]);
}

async function getCurrentSessions(
  client: PoolClient,
  userId: string,
  workspaceId: string,
  ttlSeconds: number
): Promise<PresenceSessionSnapshot[]> {
  await client.query(
    `
      DELETE FROM presence_sessions
      WHERE user_id = $1
        AND workspace_id = $2
        AND last_seen < NOW() - ($3 * interval '1 second')
    `,
    [userId, workspaceId, ttlSeconds]
  );

  const sessionsRes = await client.query(
    `
      SELECT session_id, last_seen
      FROM presence_sessions
      WHERE user_id = $1
        AND workspace_id = $2
      ORDER BY last_seen DESC
    `,
    [userId, workspaceId]
  );

  return sessionsRes.rows.map((row) => ({
    sessionId: row.session_id,
    lastSeen: new Date(row.last_seen).toISOString(),
  }));
}

async function replaceSessions(
  client: PoolClient,
  userId: string,
  workspaceId: string,
  sessions: PresenceSessionSnapshot[],
  source: PresenceEventSource
): Promise<void> {
  await client.query(
    'DELETE FROM presence_sessions WHERE user_id = $1 AND workspace_id = $2',
    [userId, workspaceId]
  );

  if (sessions.length === 0) {
    return;
  }

  const values: Array<string | Date> = [];
  const placeholders = sessions.map((session, index) => {
    const base = index * 6;
    values.push(
      userId,
      workspaceId,
      session.sessionId,
      new Date(session.lastSeen),
      source,
      JSON.stringify({ last_source: source })
    );
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, NOW(), $${base + 5}, $${base + 6}::jsonb)`;
  });

  await client.query(
    `
      INSERT INTO presence_sessions (
        user_id,
        workspace_id,
        session_id,
        last_seen,
        last_event_at,
        last_event_source,
        metadata
      )
      VALUES ${placeholders.join(', ')}
    `,
    values
  );
}

async function syncPresenceProjection(
  client: PoolClient,
  input: {
    userId: string;
    workspaceId: string;
    source: PresenceEventSource;
    nowIso: string;
    sessions: PresenceSessionSnapshot[];
    touchRecentActivity?: boolean;
    clearRecentActivity?: boolean;
  }
): Promise<PresenceProjectionSnapshot> {
  const sessionsMetadata = serializeActiveSessions(input.sessions);
  const sessionCount = input.sessions.length;
  const isOnline = sessionCount > 0;
  const lastSeenAt = isOnline ? input.nowIso : null;
  const recentActivityAt = input.touchRecentActivity ? input.nowIso : null;

  await client.query(
    `
      INSERT INTO user_workspace_presence (
        user_id,
        workspace_id,
        is_online,
        online_since,
        last_seen,
        recent_activity_at,
        last_event_at,
        last_event_source,
        metadata
      )
      VALUES (
        $1,
        $2,
        $3,
        CASE WHEN $3 THEN $4::timestamptz ELSE NULL END,
        COALESCE($5::timestamptz, NOW()),
        $6::timestamptz,
        NOW(),
        $7,
        jsonb_build_object(
          'active_sessions',
          $8::jsonb,
          'session_count',
          to_jsonb($9::int),
          'last_event_source',
          to_jsonb($7::text),
          'last_event_at',
          to_jsonb(NOW())
        )
      )
      ON CONFLICT (user_id, workspace_id)
      DO UPDATE SET
        is_online = $3,
        online_since = CASE
          WHEN $3 THEN
            CASE
              WHEN user_workspace_presence.is_online = TRUE THEN COALESCE(user_workspace_presence.online_since, $4::timestamptz)
              ELSE $4::timestamptz
            END
          ELSE NULL
        END,
        last_seen = CASE
          WHEN $5::timestamptz IS NOT NULL THEN GREATEST(COALESCE(user_workspace_presence.last_seen, $5::timestamptz), $5::timestamptz)
          ELSE user_workspace_presence.last_seen
        END,
        recent_activity_at = CASE
          WHEN $10 = TRUE THEN NULL
          WHEN $6::timestamptz IS NOT NULL THEN GREATEST(COALESCE(user_workspace_presence.recent_activity_at, $6::timestamptz), $6::timestamptz)
          ELSE user_workspace_presence.recent_activity_at
        END,
        last_event_at = NOW(),
        last_event_source = $7,
        metadata = COALESCE(user_workspace_presence.metadata, '{}'::jsonb) || jsonb_build_object(
          'active_sessions',
          $8::jsonb,
          'session_count',
          to_jsonb($9::int),
          'last_event_source',
          to_jsonb($7::text),
          'last_event_at',
          to_jsonb(NOW())
        )
    `,
    [
      input.userId,
      input.workspaceId,
      isOnline,
      input.nowIso,
      lastSeenAt,
      recentActivityAt,
      input.source,
      JSON.stringify(sessionsMetadata),
      sessionCount,
      input.clearRecentActivity ?? false,
    ]
  );

  return {
    activeSessions: sessionsMetadata,
    isOnline,
    lastSeen: lastSeenAt,
    onlineSince: isOnline ? input.nowIso : null,
    recentActivityAt,
  };
}

async function mutatePresence(options: PresenceMutationOptions): Promise<void> {
  if (!options.userId || !options.workspaceId) {
    console.warn('[PRESENCE] Missing userId or workspaceId.');
    return;
  }

  const source = options.source ?? 'unknown';
  const nowIso = new Date().toISOString();
  const ttlSeconds = getPresenceTtlSeconds();

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await acquirePresenceLock(client, options.userId, options.workspaceId);

    const previousProjection = await getProjectionSnapshot(client, options.userId, options.workspaceId);
    const currentSessions = await getCurrentSessions(client, options.userId, options.workspaceId, ttlSeconds);
    const previousSessionCount = currentSessions.length;

    const next = reconcilePresenceSessions({
      currentSessions,
      isOnline: options.isOnline,
      nowIso,
      sessionId: options.tabId,
      forceOffline: options.forceOffline,
      ttlSeconds,
    });

    await replaceSessions(client, options.userId, options.workspaceId, next.sessions, source);

    const nextProjection = await syncPresenceProjection(client, {
      userId: options.userId,
      workspaceId: options.workspaceId,
      source,
      nowIso,
      sessions: next.sessions,
      touchRecentActivity: options.touchRecentActivity,
      clearRecentActivity: options.clearRecentActivity,
    });

    await client.query('COMMIT');

    logPresenceMutation({
      event: 'presence_mutation',
      userId: options.userId,
      workspaceId: options.workspaceId,
      sessionId: options.tabId ?? null,
      source,
      previousSessionCount,
      nextSessionCount: next.sessionCount,
      previousState: previousProjection,
      nextState: nextProjection,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error(
      `[PRESENCE] Failed to mutate presence for user ${options.userId} on workspace ${options.workspaceId}:`,
      error
    );
  } finally {
    client.release();
  }
}

export async function sweepStalePresence(workspaceId?: string): Promise<number> {
  const ttlSeconds = getPresenceTtlSeconds();
  const params: Array<string | number> = [ttlSeconds];
  const workspaceClause = workspaceId ? 'AND ps.workspace_id = $2' : '';
  if (workspaceId) {
    params.push(workspaceId);
  }

  const staleSessionsRes = await db.query(
    `
      DELETE FROM presence_sessions ps
      WHERE ps.last_seen < NOW() - ($1 * interval '1 second')
        ${workspaceClause}
    `,
    params
  );

  const projectionParams: Array<string | number> = [ttlSeconds];
  const projectionWorkspaceClause = workspaceId ? 'AND uwp.workspace_id = $2' : '';
  if (workspaceId) {
    projectionParams.push(workspaceId);
  }

  await db.query(
    `
      UPDATE user_workspace_presence uwp
      SET
        is_online = FALSE,
        online_since = NULL,
        last_event_at = NOW(),
        last_event_source = 'sweep',
        metadata = COALESCE(uwp.metadata, '{}'::jsonb) || jsonb_build_object(
          'active_sessions',
          '{}'::jsonb,
          'session_count',
          to_jsonb(0),
          'last_event_source',
          to_jsonb('sweep'::text),
          'last_event_at',
          to_jsonb(NOW())
        )
      WHERE uwp.is_online = TRUE
        ${projectionWorkspaceClause}
        AND NOT EXISTS (
          SELECT 1
          FROM presence_sessions ps
          WHERE ps.user_id = uwp.user_id
            AND ps.workspace_id = uwp.workspace_id
            AND ps.last_seen > NOW() - ($1 * interval '1 second')
        )
    `,
    projectionParams
  );

  return staleSessionsRes.rowCount ?? 0;
}

export async function updateUserOnlineStatus(
  userId: string,
  workspaceId: string,
  isOnline: boolean,
  tabId?: string | null,
  forceOffline: boolean = false,
  source: PresenceEventSource = 'api'
): Promise<void> {
  await mutatePresence({
    userId,
    workspaceId,
    isOnline,
    tabId,
    forceOffline,
    source,
    clearRecentActivity: forceOffline,
  });
}

export async function touchUserPresenceActivity(
  userId: string,
  workspaceId: string,
  tabId?: string | null,
  source: PresenceEventSource = 'activity'
): Promise<void> {
  await mutatePresence({
    userId,
    workspaceId,
    isOnline: true,
    tabId,
    source,
    touchRecentActivity: true,
  });
}

export async function touchUserPresenceFromChat(
  userId: string,
  chatId: string,
  tabId?: string | null,
  source: PresenceEventSource = 'activity'
): Promise<void> {
  if (!userId || !chatId) {
    return;
  }

  const chatRes = await db.query(
    `
      SELECT workspace_id
      FROM chats
      WHERE id = $1
      LIMIT 1
    `,
    [chatId]
  );

  const workspaceId = chatRes.rows[0]?.workspace_id as string | undefined;
  if (!workspaceId) {
    return;
  }

  await touchUserPresenceActivity(userId, workspaceId, tabId, source);
}

export async function getOnlineAgents(workspaceId: string): Promise<OnlineAgent[]> {
  if (!workspaceId) {
    console.error('[GET_ONLINE_AGENTS] Workspace ID nao fornecido.');
    return [];
  }

  try {
    const ttlSeconds = getPresenceTtlSeconds();
    const recentActivitySeconds = getPresenceRecentActivitySeconds();
    const availabilitySql = buildPresenceAvailabilitySql('uwp', '$2', '$3');

    const res = await db.query(
      `
        SELECT
          u.id,
          u.full_name,
          u.avatar_url,
          u.email,
          u.is_superadmin,
          uwp.online_since,
          STRING_AGG(DISTINCT t.name, ', ' ORDER BY t.name) FILTER (WHERE t.name IS NOT NULL) AS team_names,
          MAX(r.name) AS role_name
        FROM user_workspace_presence uwp
        JOIN users u ON u.id = uwp.user_id
        LEFT JOIN team_members tm ON u.id = tm.user_id
        LEFT JOIN teams t ON tm.team_id = t.id AND t.workspace_id = uwp.workspace_id
        LEFT JOIN user_workspace_roles uwr ON u.id = uwr.user_id AND uwr.workspace_id = uwp.workspace_id
        LEFT JOIN roles r ON uwr.role_id = r.id
        WHERE uwp.workspace_id = $1
          AND ${availabilitySql}
        GROUP BY u.id, u.full_name, u.avatar_url, u.email, u.is_superadmin, uwp.online_since
        ORDER BY u.full_name ASC
      `,
      [workspaceId, ttlSeconds, recentActivitySeconds]
    );

    return res.rows.map((row): OnlineAgent => {
      const normalizedAvatar = normalizeSupabaseStorageUrl(row.avatar_url);
      return {
        user: {
          id: row.id,
          name: row.full_name,
          email: row.email,
          avatar_url: normalizedAvatar || undefined,
          avatar: normalizedAvatar || undefined,
          is_superadmin: row.is_superadmin,
          firstName: row.full_name?.split(' ')[0] ?? row.full_name,
          lastName: row.full_name?.split(' ').slice(1).join(' ') ?? '',
          team: row.team_names || undefined,
          role: row.role_name ? ({ name: row.role_name } as any) : undefined,
        },
        joined_at: row.online_since ? new Date(row.online_since).toISOString() : new Date().toISOString(),
      };
    });
  } catch (error) {
    console.error('[GET_ONLINE_AGENTS] Error fetching presence data:', error);
    return [];
  }
}

export async function getPresenceDiagnostics(workspaceId: string): Promise<{
  presence: any[];
  sessions: any[];
}> {
  const [presenceRes, sessionsRes] = await Promise.all([
    db.query(
      `
        SELECT *
        FROM user_workspace_presence
        WHERE workspace_id = $1
        ORDER BY last_event_at DESC NULLS LAST, last_seen DESC NULLS LAST
      `,
      [workspaceId]
    ),
    db.query(
      `
        SELECT *
        FROM presence_sessions
        WHERE workspace_id = $1
        ORDER BY last_seen DESC
      `,
      [workspaceId]
    ),
  ]);

  return {
    presence: presenceRes.rows,
    sessions: sessionsRes.rows,
  };
}
