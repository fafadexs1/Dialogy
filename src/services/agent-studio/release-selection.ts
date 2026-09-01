import 'server-only';

import { loadStudioRelease } from './repository';
import { studioSessionStore } from './session-store';
import type { AgentReleaseManifest } from './types';

type Store = Awaited<ReturnType<typeof studioSessionStore>>;
type SelectionDependencies = {
  loadRelease: typeof loadStudioRelease;
  loadStore: typeof studioSessionStore;
};

const defaults: SelectionDependencies = { loadRelease: loadStudioRelease, loadStore: studioSessionStore };

/**
 * An in-progress conversation stays pinned to the release that started it,
 * even when the agent has since been rolled back to the legacy runtime.
 */
export async function selectStudioConversationRelease(input: {
  workspaceId: string;
  agentId: string;
  chatId: string;
  sourceMessageId?: string | null;
}, dependencies: SelectionDependencies = defaults): Promise<{ store: Store; release: AgentReleaseManifest | null }> {
  const store = await dependencies.loadStore({ workspaceId: input.workspaceId, agentId: input.agentId, chatId: input.chatId });
  const shouldResumePinned = Boolean(store.state && (
    store.state.phase !== 'done'
    || store.state.inFlight
    || (input.sourceMessageId && store.state.lastTurn?.messageId === input.sourceMessageId)
  ));

  if (shouldResumePinned && store.state) {
    return { store, release: await dependencies.loadRelease(input.workspaceId, input.agentId, store.state.releaseId) };
  }
  return { store, release: await dependencies.loadRelease(input.workspaceId, input.agentId) };
}
