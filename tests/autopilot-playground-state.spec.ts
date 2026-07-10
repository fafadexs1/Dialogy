import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: { query: vi.fn() },
}));

import { db } from '@/lib/db';
import {
  getAutopilotPlaygroundState,
  saveAutopilotPlaygroundState,
} from '@/services/autopilot/playground-state-store';

describe('autopilot playground state', () => {
  beforeEach(() => vi.mocked(db.query).mockReset());

  it('stores synthetic preview sessions outside the chat-backed state table', async () => {
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any);

    await saveAutopilotPlaygroundState({
      sessionId: '4092eadc-058e-47c5-ba67-1576cc3e04d2',
      workspaceId: 'workspace',
      autopilotConfigId: 'config',
      activeNodeId: 'node-2',
    });

    const [query, params] = vi.mocked(db.query).mock.calls[0];
    expect(query).toContain('INSERT INTO autopilot_playground_states');
    expect(query).toContain('ON CONFLICT (session_id, workspace_id)');
    expect(query).not.toContain('autopilot_conversation_states');
    expect(params).toEqual([
      '4092eadc-058e-47c5-ba67-1576cc3e04d2',
      'workspace',
      'config',
      'node-2',
    ]);
  });

  it('scopes preview state reads to the authenticated workspace', async () => {
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any);

    await getAutopilotPlaygroundState('session', 'workspace');

    const [query, params] = vi.mocked(db.query).mock.calls[0];
    expect(query).toContain('session_id = $1 AND workspace_id = $2');
    expect(params).toEqual(['session', 'workspace']);
  });
});
