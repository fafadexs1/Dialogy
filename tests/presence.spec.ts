import { describe, expect, it } from 'vitest';

import {
  PRESENCE_LEGACY_SESSION_ID,
  buildPresenceAvailabilitySql,
  normalizePresenceSessionId,
  reconcilePresenceSessions,
} from '@/lib/presence';

describe('presence helpers', () => {
  it('normalizes empty session ids to the legacy slot', () => {
    expect(normalizePresenceSessionId(undefined)).toBe(PRESENCE_LEGACY_SESSION_ID);
    expect(normalizePresenceSessionId('')).toBe(PRESENCE_LEGACY_SESSION_ID);
    expect(normalizePresenceSessionId('  abc  ')).toBe('abc');
  });

  it('keeps another tab online when one tab goes offline', () => {
    const nowIso = '2026-03-28T12:00:00.000Z';
    const result = reconcilePresenceSessions({
      currentSessions: [
        { sessionId: 'tab-a', lastSeen: '2026-03-28T11:59:40.000Z' },
        { sessionId: 'tab-b', lastSeen: '2026-03-28T11:59:50.000Z' },
      ],
      isOnline: false,
      nowIso,
      sessionId: 'tab-a',
      ttlSeconds: 180,
    });

    expect(result.isOnline).toBe(true);
    expect(result.sessionCount).toBe(1);
    expect(result.sessions).toEqual([{ sessionId: 'tab-b', lastSeen: '2026-03-28T11:59:50.000Z' }]);
  });

  it('force offline clears every live session', () => {
    const result = reconcilePresenceSessions({
      currentSessions: [
        { sessionId: 'tab-a', lastSeen: '2026-03-28T11:59:40.000Z' },
        { sessionId: 'tab-b', lastSeen: '2026-03-28T11:59:50.000Z' },
      ],
      isOnline: false,
      nowIso: '2026-03-28T12:00:00.000Z',
      forceOffline: true,
      ttlSeconds: 180,
    });

    expect(result.isOnline).toBe(false);
    expect(result.sessionCount).toBe(0);
    expect(result.sessions).toEqual([]);
  });

  it('prunes expired sessions before applying the mutation', () => {
    const result = reconcilePresenceSessions({
      currentSessions: [
        { sessionId: 'stale-tab', lastSeen: '2026-03-28T11:56:00.000Z' },
      ],
      isOnline: true,
      nowIso: '2026-03-28T12:00:00.000Z',
      sessionId: 'fresh-tab',
      ttlSeconds: 180,
    });

    expect(result.isOnline).toBe(true);
    expect(result.sessions).toEqual([{ sessionId: 'fresh-tab', lastSeen: '2026-03-28T12:00:00.000Z' }]);
  });

  it('builds a shared availability predicate with recent human activity fallback', () => {
    const sql = buildPresenceAvailabilitySql('uwp', '$2', '$3');

    expect(sql).toContain('uwp.is_online = TRUE');
    expect(sql).toContain('uwp.last_seen > NOW() - ($2 * interval \'1 second\')');
    expect(sql).toContain('uwp.recent_activity_at IS NOT NULL');
    expect(sql).toContain('uwp.recent_activity_at > NOW() - ($3 * interval \'1 second\')');
  });
});
