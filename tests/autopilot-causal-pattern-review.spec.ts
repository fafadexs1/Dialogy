import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/lib/db';
import { reviewCausalPattern } from '@/services/autopilot/causal-pattern-review';

vi.mock('@/lib/db', () => ({
  db: {
    query: vi.fn(),
  },
}));

describe('autopilot causal pattern review', () => {
  beforeEach(() => {
    vi.mocked(db.query).mockReset();
  });

  it('approves a pending causal pattern with review metadata', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({
      rows: [{
        id: 'pattern-1',
        status: 'approved',
        reviewed_at: '2026-06-15T18:20:00.000Z',
        applied_at: null,
      }],
    } as any);

    const result = await reviewCausalPattern({
      workspaceId: 'workspace-1',
      patternId: 'pattern-1',
      decision: 'approve',
      reviewedByUserId: 'user-1',
      note: 'Faz sentido.',
    });

    expect(result.pattern).toMatchObject({
      id: 'pattern-1',
      status: 'approved',
      reviewedAt: '2026-06-15T18:20:00.000Z',
      appliedAt: null,
    });
    expect(vi.mocked(db.query).mock.calls[0]?.[1]).toEqual([
      'pattern-1',
      'workspace-1',
      'approved',
      'user-1',
      expect.stringContaining('"decision":"approve"'),
    ]);
  });

  it('marks an approved pattern as applied', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({
      rows: [{
        id: 'pattern-2',
        status: 'applied',
        reviewed_at: '2026-06-15T18:20:00.000Z',
        applied_at: '2026-06-15T18:22:00.000Z',
      }],
    } as any);

    const result = await reviewCausalPattern({
      workspaceId: 'workspace-1',
      patternId: 'pattern-2',
      decision: 'mark_applied',
    });

    expect(result.pattern).toMatchObject({
      id: 'pattern-2',
      status: 'applied',
      appliedAt: '2026-06-15T18:22:00.000Z',
    });
  });

  it('returns a friendly error when the pattern cannot be reviewed', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] } as any);

    const result = await reviewCausalPattern({
      workspaceId: 'workspace-1',
      patternId: 'pattern-missing',
      decision: 'dismiss',
    });

    expect(result.pattern).toBeNull();
    expect(result.error).toContain('ja revisado');
  });
});
