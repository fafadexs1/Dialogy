import { createHash } from 'node:crypto';

export type AnalyticsSnapshotKind = 'overview' | 'agent_performance' | 'conversions';

export type AnalyticsSnapshotIdentity = {
  workspaceId: string;
  kind: AnalyticsSnapshotKind;
  teamId?: string;
  agentId?: string;
  from: string;
  to: string;
  counterMode?: string;
};

const DEFAULT_FRESH_MS = 5 * 60 * 1000;
const DEFAULT_HISTORICAL_GRACE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_REFRESH_LEASE_MS = 10 * 60 * 1000;
const DEFAULT_FALLBACK_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function analyticsSnapshotsEnabled(): boolean {
  return process.env.ANALYTICS_SNAPSHOT_ENABLED !== 'false';
}

export function analyticsSnapshotFreshMs(): number {
  return positiveInteger(process.env.ANALYTICS_SNAPSHOT_FRESH_MS, DEFAULT_FRESH_MS);
}

export function analyticsSnapshotHistoricalGraceMs(): number {
  return positiveInteger(
    process.env.ANALYTICS_SNAPSHOT_HISTORICAL_GRACE_MS,
    DEFAULT_HISTORICAL_GRACE_MS,
  );
}

export function analyticsSnapshotRefreshLeaseMs(): number {
  return positiveInteger(
    process.env.ANALYTICS_SNAPSHOT_REFRESH_LEASE_MS,
    DEFAULT_REFRESH_LEASE_MS,
  );
}

export function analyticsSnapshotFallbackMaxAgeMs(): number {
  return positiveInteger(
    process.env.ANALYTICS_SNAPSHOT_FALLBACK_MAX_AGE_MS,
    DEFAULT_FALLBACK_MAX_AGE_MS,
  );
}

export function isHistoricalAnalyticsRange(to: string, nowMs = Date.now()): boolean {
  const endMs = Date.parse(to);
  return Number.isFinite(endMs) && endMs <= nowMs - analyticsSnapshotHistoricalGraceMs();
}

export function buildAnalyticsSnapshotKey(identity: AnalyticsSnapshotIdentity): string {
  const version = process.env.ANALYTICS_SNAPSHOT_SCHEMA_VERSION || 'v1';
  const canonical = JSON.stringify({
    version,
    workspaceId: identity.workspaceId,
    kind: identity.kind,
    teamId: identity.teamId || null,
    agentId: identity.agentId || null,
    from: new Date(identity.from).toISOString(),
    to: new Date(identity.to).toISOString(),
    counterMode: identity.counterMode || null,
  });

  return createHash('sha256').update(canonical).digest('hex');
}
