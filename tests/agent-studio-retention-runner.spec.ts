import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn(), connect: vi.fn(), purge: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { connect: mocks.connect } }));
vi.mock('@/services/agent-studio/operations', () => ({ studioHistoryRetentionDays: () => 90, purgeExpiredStudioOperationalData: mocks.purge }));
import { runAgentStudioRetentionOnce } from '@/services/agent-studio/retention-runner';

describe('Agent Studio retention runner', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release });
    mocks.query.mockResolvedValueOnce({ rows: [{ acquired: true }] }).mockResolvedValueOnce({ rows: [{ pg_advisory_unlock: true }] });
    mocks.purge.mockResolvedValue({ days: 90, deletedSessions: 3, clearedStates: 2 });
  });
  it('runs one retention pass under a PostgreSQL advisory lock', async () => {
    await expect(runAgentStudioRetentionOnce()).resolves.toEqual({ skipped: false, days: 90, deletedSessions: 3, clearedStates: 2 });
    expect(mocks.purge).toHaveBeenCalledWith(90); expect(mocks.query).toHaveBeenCalledTimes(2); expect(mocks.release).toHaveBeenCalledOnce();
  });
  it('skips when another worker owns the lock', async () => {
    mocks.query.mockReset().mockResolvedValueOnce({ rows: [{ acquired: false }] });
    await expect(runAgentStudioRetentionOnce()).resolves.toEqual({ skipped: true });
    expect(mocks.purge).not.toHaveBeenCalled(); expect(mocks.release).toHaveBeenCalledOnce();
  });
  it('always releases the advisory lock after a failed purge', async () => {
    mocks.purge.mockRejectedValueOnce(new Error('injected'));
    await expect(runAgentStudioRetentionOnce()).rejects.toThrow('injected');
    expect(mocks.query).toHaveBeenCalledTimes(2); expect(mocks.release).toHaveBeenCalledOnce();
  });
});
