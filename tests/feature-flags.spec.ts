import { describe, expect, it } from 'vitest';
import { evaluateFeatureFlag } from '@/lib/feature-flags/evaluate';

describe('evaluateFeatureFlag', () => {
  it('returns disabled when flag is not configured', () => {
    const result = evaluateFeatureFlag('flag', undefined, undefined, {});
    expect(result.enabled).toBe(false);
    expect(result.reason).toBe('not_configured');
  });

  it('blocks flags outside the time window', () => {
    const now = new Date('2025-01-01T00:00:00Z');
    const result = evaluateFeatureFlag(
      'flag',
      { enabled: true, startAt: '2025-02-01T00:00:00Z' },
      undefined,
      { now }
    );
    expect(result.enabled).toBe(false);
    expect(result.reason).toBe('outside_window');
  });

  it('blocks flags on unmatched release channels', () => {
    const result = evaluateFeatureFlag(
      'flag',
      { enabled: true, releaseChannels: ['canary'] },
      undefined,
      { releaseChannel: 'stable' }
    );
    expect(result.enabled).toBe(false);
    expect(result.reason).toBe('channel_blocked');
  });

  it('enables flags for targeted users even if disabled', () => {
    const result = evaluateFeatureFlag(
      'flag',
      { enabled: false, users: ['user-1'] },
      undefined,
      { userId: 'user-1' }
    );
    expect(result.enabled).toBe(true);
    expect(result.reason).toBe('targeted');
  });

  it('enables flags only for a targeted workspace even if globally disabled', () => {
    const config = { enabled: false, workspaces: ['workspace-canary'] };
    expect(evaluateFeatureFlag('flag', config, undefined, { workspaceId: 'workspace-canary' }))
      .toMatchObject({ enabled: true, reason: 'targeted' });
    expect(evaluateFeatureFlag('flag', config, undefined, { workspaceId: 'workspace-other' }))
      .toMatchObject({ enabled: false, reason: 'disabled' });
  });

  it('respects explicit disabled flags', () => {
    const result = evaluateFeatureFlag('flag', { enabled: false }, undefined, {});
    expect(result.enabled).toBe(false);
    expect(result.reason).toBe('disabled');
  });

  it('uses rollout buckets when enabled', () => {
    const result = evaluateFeatureFlag(
      'flag',
      { enabled: true, rollout: 0 },
      undefined,
      { workspaceId: 'workspace-1' }
    );
    expect(result.enabled).toBe(false);
    expect(result.reason).toBe('rollout');
    expect(result.bucket).toBeTypeOf('number');
  });

  it('falls back to defaults when flag values are missing', () => {
    const result = evaluateFeatureFlag(
      'flag',
      {},
      { enabled: true, rollout: 100 },
      {}
    );
    expect(result.enabled).toBe(true);
    expect(result.reason).toBe('enabled');
  });
});
