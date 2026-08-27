import { describe, expect, it } from 'vitest';

import {
  getWorkspaceMessageDisposition,
  hasCompleteRealtimeChatPresentation,
  parseVisibleIdSet,
  reconcileRealtimeChatAssignment,
  reconcileRealtimeChatPresentation,
  shouldDeliverChatPayload,
  shouldDeliverMessagePayload,
  toPostgresChangesPayload,
  type RealtimeBroadcastChangesPayload,
} from '@/lib/realtime/realtime-reconciler';
import type { Chat } from '@/lib/types';

const broadcastPayload = (record: Record<string, unknown>, oldRecord: Record<string, unknown> = {}): RealtimeBroadcastChangesPayload => ({
  id: 'evt-1',
  schema: 'public',
  table: 'messages',
  operation: 'INSERT',
  record,
  old_record: oldRecord,
});

describe('realtime reconciler', () => {
  it('parses visible id csv into a stable set', () => {
    expect(parseVisibleIdSet(' chat-1,chat-2,, chat-1 ')?.has('chat-2')).toBe(true);
    expect(parseVisibleIdSet('   ')).toBeNull();
  });

  it('normalizes broadcast payloads to postgres change payloads', () => {
    const payload = toPostgresChangesPayload(broadcastPayload({
      id: 'msg-1',
      chat_id: 'chat-1',
      created_at: '2024-01-01T10:00:00Z',
    }));

    expect(payload.eventType).toBe('INSERT');
    expect((payload.new as { id?: string }).id).toBe('msg-1');
    expect(payload.commit_timestamp).toBe('2024-01-01T10:00:00Z');
  });

  it('detects chat payloads that include the complete team presentation', () => {
    expect(hasCompleteRealtimeChatPresentation({
      team_name: 'Financeiro',
      team_color: '#dc143c',
    })).toBe(true);
    expect(hasCompleteRealtimeChatPresentation({
      team_name: 'Financeiro',
    })).toBe(false);
    expect(hasCompleteRealtimeChatPresentation({
      team_name: 'Financeiro',
      team_color: null,
    })).toBe(false);
    expect(hasCompleteRealtimeChatPresentation({
      team_name: null,
      team_color: null,
    })).toBe(true);
  });

  it('filters chat updates by visible chat id when a visible set exists', () => {
    const visible = parseVisibleIdSet('chat-1,chat-2');
    const visiblePayload = toPostgresChangesPayload(broadcastPayload({ id: 'chat-1' }));
    const hiddenPayload = toPostgresChangesPayload(broadcastPayload({ id: 'chat-3' }));

    expect(shouldDeliverChatPayload(visiblePayload, visible)).toBe(true);
    expect(shouldDeliverChatPayload(hiddenPayload, visible)).toBe(false);
  });

  it('filters message updates by chat_id when a visible set exists', () => {
    const visible = parseVisibleIdSet('chat-1,chat-2');
    const visiblePayload = toPostgresChangesPayload(broadcastPayload({ id: 'msg-1', chat_id: 'chat-2' }));
    const hiddenPayload = toPostgresChangesPayload(broadcastPayload({ id: 'msg-2', chat_id: 'chat-3' }));

    expect(shouldDeliverMessagePayload(visiblePayload, visible)).toBe(true);
    expect(shouldDeliverMessagePayload(hiddenPayload, visible)).toBe(false);
  });

  it('reconciles the list when a message belongs to a chat not loaded yet', () => {
    const visible = parseVisibleIdSet('chat-1,chat-2');
    const newCustomerPayload = toPostgresChangesPayload(
      broadcastPayload({ id: 'msg-new', chat_id: 'chat-new' }),
    );

    expect(getWorkspaceMessageDisposition(newCustomerPayload, visible, 'chat-1')).toBe('reconcile-list');
  });

  it('does not duplicate the selected thread through the workspace channel', () => {
    const visible = parseVisibleIdSet('chat-1,chat-2');
    const selectedPayload = toPostgresChangesPayload(
      broadcastPayload({ id: 'msg-selected', chat_id: 'chat-1' }),
    );

    expect(getWorkspaceMessageDisposition(selectedPayload, visible, 'chat-1')).toBe('ignore-selected');
  });

  it('replaces a stale human agent with the hydrated transfer target', () => {
    const existing = {
      agentId: 'agent-old',
      agent: { id: 'agent-old', name: 'Agente Antigo' },
    } as Chat;

    const assignment = reconcileRealtimeChatAssignment(existing, {
      agent_id: 'agent-new',
      agent_name: 'Agente Novo',
      agent_avatar_url: '/novo.png',
      assigned_system_agent_id: null,
    });

    expect(assignment.agent).toMatchObject({ id: 'agent-new', name: 'Agente Novo' });
    expect(assignment.assignedSystemAgent).toBeUndefined();
  });

  it('drops an incompatible cached human agent when a partial AI transfer arrives', () => {
    const existing = {
      agentId: 'agent-old',
      agent: { id: 'agent-old', name: 'Agente Antigo' },
    } as Chat;

    const assignment = reconcileRealtimeChatAssignment(existing, {
      assigned_system_agent_id: 'system-1',
      assigned_system_agent_name: 'Suporte IA',
      assigned_system_agent_type: 'intelligent_attendant',
    });

    expect(assignment.agent).toBeUndefined();
    expect(assignment.assignedSystemAgent).toMatchObject({ id: 'system-1', name: 'Suporte IA' });
  });

  it('enriches a matching cached agent when its avatar arrives later', () => {
    const existing = {
      agentId: 'agent-1',
      agent: { id: 'agent-1', name: 'Agente' },
    } as Chat;

    const assignment = reconcileRealtimeChatAssignment(existing, {
      agent_id: 'agent-1',
      agent_name: 'Agente Completo',
      agent_avatar_url: '/avatar-completo.png',
    });

    expect(assignment.agent).toMatchObject({
      id: 'agent-1',
      name: 'Agente Completo',
      avatar: '/avatar-completo.png',
      avatar_url: '/avatar-completo.png',
    });
  });

  it('clears stale presentation fields when hydration explicitly returns null', () => {
    const existing = {
      teamName: 'Equipe antiga',
      team_id: 'team-old',
      teamColor: '#ff0000',
      tag: 'Tag antiga',
      color: '#00ff00',
    } as Chat;

    const presentation = reconcileRealtimeChatPresentation(existing, {
      team_name: null,
      team_id: null,
      team_color: null,
      tag: null,
      color: null,
    });

    expect(presentation).toMatchObject({
      teamName: undefined,
      team_id: undefined,
      teamColor: undefined,
      tag: undefined,
      color: undefined,
    });
  });
});
