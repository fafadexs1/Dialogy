import { describe, expect, it } from 'vitest';

import {
  parseVisibleIdSet,
  shouldDeliverChatPayload,
  shouldDeliverMessagePayload,
  toPostgresChangesPayload,
  type RealtimeBroadcastChangesPayload,
} from '@/lib/realtime/realtime-reconciler';

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
});
