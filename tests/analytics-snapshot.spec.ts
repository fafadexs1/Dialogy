import { afterEach, describe, expect, it } from 'vitest';

import {
  analyticsSnapshotFreshMs,
  buildAnalyticsSnapshotKey,
  isHistoricalAnalyticsRange,
} from '@/lib/analytics-snapshot';

const originalEnv = {
  freshMs: process.env.ANALYTICS_SNAPSHOT_FRESH_MS,
  graceMs: process.env.ANALYTICS_SNAPSHOT_HISTORICAL_GRACE_MS,
  version: process.env.ANALYTICS_SNAPSHOT_SCHEMA_VERSION,
};

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  restoreEnv('ANALYTICS_SNAPSHOT_FRESH_MS', originalEnv.freshMs);
  restoreEnv('ANALYTICS_SNAPSHOT_HISTORICAL_GRACE_MS', originalEnv.graceMs);
  restoreEnv('ANALYTICS_SNAPSHOT_SCHEMA_VERSION', originalEnv.version);
});

describe('analytics snapshot identity', () => {
  const identity = {
    workspaceId: '00000000-0000-0000-0000-000000000001',
    kind: 'overview' as const,
    from: '2026-07-01T03:00:00.000Z',
    to: '2026-07-14T02:59:59.999Z',
  };

  it('is deterministic and separates filter combinations', () => {
    expect(buildAnalyticsSnapshotKey(identity)).toBe(buildAnalyticsSnapshotKey({ ...identity }));
    expect(buildAnalyticsSnapshotKey(identity)).not.toBe(
      buildAnalyticsSnapshotKey({ ...identity, agentId: '00000000-0000-0000-0000-000000000002' }),
    );
  });

  it('changes when the schema version is bumped', () => {
    process.env.ANALYTICS_SNAPSHOT_SCHEMA_VERSION = 'v1';
    const v1 = buildAnalyticsSnapshotKey(identity);
    process.env.ANALYTICS_SNAPSHOT_SCHEMA_VERSION = 'v2';
    expect(buildAnalyticsSnapshotKey(identity)).not.toBe(v1);
  });
});

describe('analytics snapshot freshness', () => {
  it('uses safe defaults for invalid configuration', () => {
    process.env.ANALYTICS_SNAPSHOT_FRESH_MS = '-1';
    expect(analyticsSnapshotFreshMs()).toBe(300_000);
  });

  it('marks only ranges beyond the historical grace window as immutable', () => {
    process.env.ANALYTICS_SNAPSHOT_HISTORICAL_GRACE_MS = '86400000';
    const now = Date.parse('2026-07-13T12:00:00.000Z');

    expect(isHistoricalAnalyticsRange('2026-07-12T11:59:59.999Z', now)).toBe(true);
    expect(isHistoricalAnalyticsRange('2026-07-13T23:59:59.999Z', now)).toBe(false);
  });
});
