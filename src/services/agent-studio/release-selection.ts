import 'server-only';

import { loadStudioRelease } from './repository';
import { studioSessionStore } from './session-store';
import { studioHasUncertainOperation } from './engine';
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
    || studioHasUncertainOperation(store.state)
    || (input.sourceMessageId && store.state.lastTurn?.messageId === input.sourceMessageId)
  ));

  if (shouldResumePinned && store.state) {
    const release = await dependencies.loadRelease(input.workspaceId, input.agentId, store.state.releaseId);
    if (!release) throw new Error('A versão vinculada a esta conversa está indisponível. O estado foi preservado; não é seguro continuar com outra configuração.');
    if (release.releaseId !== store.state.releaseId || release.agentId !== input.agentId || release.workspaceId !== input.workspaceId) {
      throw new Error('A versão carregada não corresponde à conversa em andamento.');
    }
    return { store, release };
  }
  return { store, release: await dependencies.loadRelease(input.workspaceId, input.agentId) };
}
