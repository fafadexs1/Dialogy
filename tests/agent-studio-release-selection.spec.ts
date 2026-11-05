import { describe, expect, it, vi } from 'vitest';
import { createStudioSession } from '@/services/agent-studio/engine';
import { selectStudioConversationRelease } from '@/services/agent-studio/release-selection';

const scope = { workspaceId: 'workspace', agentId: 'agent', chatId: 'chat', sourceMessageId: 'message-new' };
const release = (releaseId: string) => ({ releaseId, agentId: scope.agentId, workspaceId: scope.workspaceId }) as never;
const store = (state: ReturnType<typeof createStudioSession> | null) => ({ state, checkpoint: vi.fn() });

describe('Studio conversation release selection', () => {
  it('keeps an active conversation on its pinned release after a legacy rollback', async () => {
    const state = createStudioSession('agent', 'release-pinned', 'session');
    const loadRelease = vi.fn(async (_workspace: string, _agent: string, releaseId?: string) => releaseId ? release(releaseId) : null);
    const selected = await selectStudioConversationRelease(scope, { loadStore: vi.fn(async () => store(state)), loadRelease });
    expect(selected.release).toEqual(release('release-pinned'));
    expect(loadRelease).toHaveBeenCalledTimes(1);
    expect(loadRelease).toHaveBeenCalledWith('workspace', 'agent', 'release-pinned');
  });

  it('uses the newest publication for a new conversation', async () => {
    const loadRelease = vi.fn(async (_workspace: string, _agent: string, releaseId?: string) => release(releaseId || 'release-latest'));
    const selected = await selectStudioConversationRelease(scope, { loadStore: vi.fn(async () => store(null)), loadRelease });
    expect(selected.release).toEqual(release('release-latest'));
    expect(loadRelease).toHaveBeenCalledWith('workspace', 'agent');
  });

  it('replays the last completed Studio turn with the same pinned release', async () => {
    const state = createStudioSession('agent', 'release-pinned', 'session');
    state.phase = 'done'; state.status = 'resolved'; state.lastTurn = { messageId: 'message-new', response: 'ok', outcome: 'resolved' };
    const loadRelease = vi.fn(async (_workspace: string, _agent: string, releaseId?: string) => release(releaseId || 'release-latest'));
    const selected = await selectStudioConversationRelease(scope, { loadStore: vi.fn(async () => store(state)), loadRelease });
    expect(selected.release).toEqual(release('release-pinned'));
  });
});
