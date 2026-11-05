import { describe, expect, it } from 'vitest';

import {
  formatInboxCount,
  getInboxPaginationTab,
  getInboxPaginationScope,
  hasMoreChatsInScope,
  INBOX_CHAT_PAGE_SIZE,
  isChatInInboxQueueScope,
  isInboxAssignmentFilterTab,
  resolveInboxStatusFilterForTab,
  scopeInboxListFilters,
  type InboxTabCounts,
} from '@/lib/inbox-pagination';

const counts: InboxTabCounts = {
  robo: 7,
  gerais: 11,
  atendimentos: 58,
  encerrados: 173_099,
};

describe('inbox pagination', () => {
  it('loads conversations in fixed pages of 50', () => {
    expect(INBOX_CHAT_PAGE_SIZE).toBe(50);
  });

  it('uses one shared database status for the two queue tabs', () => {
    expect(getInboxPaginationScope('robo', counts)).toEqual({
      tab: 'robo',
      status: 'gerais',
      total: 7,
    });
    expect(getInboxPaginationScope('gerais', counts)).toEqual({
      tab: 'gerais',
      status: 'gerais',
      total: 11,
    });
    expect(getInboxPaginationTab('gerais', 'robo')).toBe('robo');
    expect(getInboxPaginationTab('gerais', 'fila')).toBe('gerais');
  });

  it('keeps the product rule: robot has no tag and queue has a tag', () => {
    expect(isChatInInboxQueueScope({ status: 'gerais' }, 'robo')).toBe(true);
    expect(isChatInInboxQueueScope({ status: 'gerais', tag: '  ' }, 'robo')).toBe(true);
    expect(isChatInInboxQueueScope({ status: 'gerais', tag: 'Suporte' }, 'fila')).toBe(true);
    expect(isChatInInboxQueueScope({ status: 'gerais', tag: 'Suporte' }, 'robo')).toBe(false);
    expect(isChatInInboxQueueScope({ status: 'atendimentos', tag: 'Suporte' }, 'fila')).toBe(false);
  });

  it('does not leak attending filters into robot or queue', () => {
    const attendingFilters = {
      teamIds: ['team-1'],
      responsibleId: 'user-1',
      onlyUnread: true,
      unassignedOnly: true,
      includeMarketing: true,
    };

    expect(isInboxAssignmentFilterTab('atendimentos')).toBe(true);
    expect(isInboxAssignmentFilterTab('encerrados')).toBe(true);
    expect(isInboxAssignmentFilterTab('robo')).toBe(false);
    expect(isInboxAssignmentFilterTab('gerais')).toBe(false);
    expect(scopeInboxListFilters('robo', attendingFilters)).toEqual({
      queueScope: 'robo',
      includeMarketing: true,
    });
    expect(scopeInboxListFilters('gerais', attendingFilters)).toEqual({
      queueScope: 'fila',
      includeMarketing: true,
    });
    expect(scopeInboxListFilters('atendimentos', attendingFilters)).toEqual({
      ...attendingFilters,
      queueScope: undefined,
    });
  });

  it('clears a contradictory global status filter when another tab is selected', () => {
    expect(resolveInboxStatusFilterForTab('robo', 'closed')).toBe('all');
    expect(resolveInboxStatusFilterForTab('gerais', 'closed')).toBe('all');
    expect(resolveInboxStatusFilterForTab('atendimentos', 'closed')).toBe('all');
    expect(resolveInboxStatusFilterForTab('encerrados', 'open')).toBe('all');
    expect(resolveInboxStatusFilterForTab('encerrados', 'closed')).toBe('closed');
  });

  it('keeps attending and closed totals independent', () => {
    expect(getInboxPaginationScope('atendimentos', counts)).toEqual({
      tab: 'atendimentos',
      status: 'atendimentos',
      total: 58,
    });
    expect(getInboxPaginationScope('encerrados', counts)).toEqual({
      tab: 'encerrados',
      status: 'encerrados',
      total: 173_099,
    });
  });

  it('only loads another page when the cursor and exact total both say there is more', () => {
    expect(hasMoreChatsInScope({ loaded: 49, total: 58, paginationHasMore: true })).toBe(true);
    expect(hasMoreChatsInScope({ loaded: 58, total: 58, paginationHasMore: true })).toBe(false);
    expect(hasMoreChatsInScope({ loaded: 10, total: 173_099, paginationHasMore: false })).toBe(false);
  });

  it('renders useful compact totals instead of hiding every value above 99', () => {
    expect(formatInboxCount(58)).toBe('58');
    expect(formatInboxCount(1_250)).toBe('1,3k');
    expect(formatInboxCount(173_099)).toBe('173k');
  });
});
