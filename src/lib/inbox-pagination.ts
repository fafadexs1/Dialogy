import type { Chat } from '@/lib/types';

export type InboxTabId = 'robo' | 'gerais' | 'atendimentos' | 'encerrados';

export type InboxTabCounts = Record<InboxTabId, number>;

export type InboxQueueScope = 'robo' | 'fila';

export type InboxStatusFilter = 'all' | 'open' | 'closed';

export type InboxListFilters = {
  queueScope?: InboxQueueScope;
  teamIds?: string[];
  responsibleId?: string | null;
  onlyUnread?: boolean;
  unassignedOnly?: boolean;
  includeMarketing?: boolean;
};

export function isInboxAssignmentFilterTab(tab: InboxTabId): boolean {
  return tab === 'atendimentos' || tab === 'encerrados';
}

/**
 * Equipe, responsável, não lidas e sem responsável pertencem ao escopo de
 * Atendendo/Encerrados. Robô e Fila são listas compartilhadas e recebem apenas
 * a divisão por tag que identifica cada uma delas.
 */
export function scopeInboxListFilters(
  tab: InboxTabId,
  filters: Omit<InboxListFilters, 'queueScope'>
): InboxListFilters {
  if (isInboxAssignmentFilterTab(tab)) {
    return { ...filters, queueScope: undefined };
  }

  return {
    queueScope: tab === 'robo' ? 'robo' : 'fila',
    includeMarketing: filters.includeMarketing,
  };
}

export type InboxPageCursor = {
  lastActivityAt: string;
  id: string;
};

export const INBOX_CHAT_PAGE_SIZE = 50;

export type InboxPaginationPage = {
  hasMore: boolean;
  cursor: InboxPageCursor | null;
};

// Robô e Fila usam o mesmo status `gerais` no banco, mas são duas listas
// paginadas independentes. Guardar o cursor apenas por status faz a última aba
// visitada sobrescrever a paginação da outra.
export type InboxTabPagination = Record<InboxTabId, InboxPaginationPage>;

// Mantido como alias para não quebrar os payloads de hidratação existentes.
export type InboxStatusPagination = InboxTabPagination;

export const EMPTY_INBOX_TAB_COUNTS: InboxTabCounts = {
  robo: 0,
  gerais: 0,
  atendimentos: 0,
  encerrados: 0,
};

export const EMPTY_INBOX_STATUS_PAGINATION: InboxTabPagination = {
  robo: { hasMore: false, cursor: null },
  gerais: { hasMore: false, cursor: null },
  atendimentos: { hasMore: false, cursor: null },
  encerrados: { hasMore: false, cursor: null },
};

export function isChatInInboxQueueScope(
  chat: {
    status?: Chat['status'] | null;
    tag?: string | null;
    agentId?: string | null;
    agent_id?: string | null;
    agent?: { id?: string | null } | null;
    team_id?: string | null;
    teamName?: string | null;
  },
  scope: InboxQueueScope
): boolean {
  if (chat.status !== 'gerais') return false;

  // Um chat com agente humano atribuído nunca deve aparecer em Robô nem em Fila.
  const hasHumanAgent = Boolean(chat.agentId || chat.agent_id || chat.agent?.id);
  if (hasHumanAgent) return false;

  // Um chat pertence à fila humana se tiver equipe ou tag de equipe definida.
  const hasTeamOrTag = Boolean(chat.tag?.trim() || chat.team_id || chat.teamName?.trim());
  return scope === 'robo' ? !hasTeamOrTag : hasTeamOrTag;
}

export function getInboxPaginationTab(
  status: Chat['status'],
  queueScope?: InboxQueueScope
): InboxTabId {
  if (status === 'gerais' && queueScope === 'robo') return 'robo';
  return status;
}

export function resolveInboxStatusFilterForTab(
  tab: InboxTabId,
  current: InboxStatusFilter
): InboxStatusFilter {
  if (tab === 'encerrados' && current === 'open') return 'all';
  if (tab !== 'encerrados' && current === 'closed') return 'all';
  return current;
}

export function getInboxPaginationScope(
  tab: InboxTabId,
  counts: InboxTabCounts
): { tab: InboxTabId; status: Chat['status']; total: number } {
  if (tab === 'robo' || tab === 'gerais') {
    return {
      tab,
      status: 'gerais',
      total: counts[tab],
    };
  }

  return {
    tab,
    status: tab,
    total: counts[tab],
  };
}

export function hasMoreChatsInScope(input: {
  loaded: number;
  total: number;
  paginationHasMore: boolean;
}): boolean {
  return input.paginationHasMore && input.loaded < input.total;
}

export function formatInboxCount(count: number): string {
  if (count < 1_000) return String(count);

  const thousands = count / 1_000;
  const maximumFractionDigits = thousands < 10 ? 1 : 0;
  return `${thousands.toLocaleString('pt-BR', { maximumFractionDigits })}k`;
}
