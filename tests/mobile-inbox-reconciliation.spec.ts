import { describe, expect, it } from 'vitest';
import type { Message } from '../mobile/src/types';
import {
  mergeInitialMessagePage,
  parseMobileRealtimeEnvelope,
  reconcileMobileRealtimeMessages,
  upsertMobileMessage,
} from '../mobile/src/state/inbox-reconciliation';

const message = (id: string, overrides: Partial<Message> = {}): Message => ({
  id,
  chatId: 'chat-1',
  content: id,
  createdAt: `2026-01-01T00:00:0${id.replace(/\D/g, '') || '0'}.000Z`,
  fromMe: false,
  channel: 'whatsapp',
  status: 'sent',
  ...overrides,
});

describe('mobile inbox reconciliation', () => {
  it('preserves a realtime message that arrives while the initial page is loading', () => {
    const existingAtStart = message('1');
    const realtime = message('3');
    const merged = mergeInitialMessagePage(
      [message('1'), message('2')],
      [existingAtStart, realtime],
      new Set([existingAtStart.id]),
    );
    expect(merged.map((item) => item.id)).toEqual(['1', '2', '3']);
  });

  it('reconciles the realtime INSERT into the optimistic item with the same id', () => {
    const optimistic = message('mobile-1', { fromMe: true, status: 'pending' });
    const envelope = parseMobileRealtimeEnvelope({
      payload: { payload: { operation: 'INSERT', record: {
        id: optimistic.id,
        chat_id: 'chat-1',
        content: 'enviada',
        from_me: true,
        created_at: optimistic.createdAt,
      } } },
    });
    const reconciled = reconcileMobileRealtimeMessages([optimistic], envelope, 'chat-1', 'whatsapp');
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]).toMatchObject({ id: optimistic.id, content: 'enviada', status: 'sent' });
  });

  it('applies UPDATE and DELETE operations instead of treating them as inserts', () => {
    const current = [message('1', { content: 'antiga', status: 'sent' })];
    const updated = reconcileMobileRealtimeMessages(current, {
      operation: 'UPDATE',
      record: { id: '1', chat_id: 'chat-1', content: 'nova', api_message_status: 'READ' },
      oldRecord: { id: '1', chat_id: 'chat-1' },
    }, 'chat-1', 'whatsapp');
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ content: 'nova', status: 'read' });

    const deleted = reconcileMobileRealtimeMessages(updated, {
      operation: 'DELETE',
      record: null,
      oldRecord: { id: '1', chat_id: 'chat-1' },
    }, 'chat-1', 'whatsapp');
    expect(deleted).toEqual([]);
  });

  it('upserts an HTTP acknowledgement without creating a duplicate', () => {
    const optimistic = message('mobile-1', { status: 'pending' });
    const acknowledged = message('mobile-1', { status: 'sent', content: 'ok' });
    expect(upsertMobileMessage([optimistic], acknowledged)).toEqual([acknowledged]);
  });
});
