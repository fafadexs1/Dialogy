import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  broadcastRealtimeEvent,
  isPrivateBroadcastTopic,
  resetRealtimeBroadcastState,
} from '@/lib/realtime/broadcast';

const httpSend = vi.fn();
const socketSend = vi.fn();
const unsubscribe = vi.fn(async () => {});
let subscribeStatus: string = 'SUBSCRIBED';

const channel = vi.fn((_topic: string, _opts?: any) => ({
  httpSend,
  send: socketSend,
  unsubscribe,
  subscribe: (callback: (status: string) => void) => {
    callback(subscribeStatus);
    return { httpSend, send: socketSend, unsubscribe };
  },
}));

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({ channel }),
}));

describe('realtime broadcast transport fallback', () => {
  beforeEach(() => {
    resetRealtimeBroadcastState();
    httpSend.mockReset();
    socketSend.mockReset();
    unsubscribe.mockReset();
    channel.mockClear();
    subscribeStatus = 'SUBSCRIBED';
    socketSend.mockResolvedValue('ok');
  });

  it('uses the REST endpoint while it works', async () => {
    httpSend.mockResolvedValue({ success: true });

    const transport = await broadcastRealtimeEvent('chat:1', 'ai_suggestion', { chatId: '1' });

    expect(transport).toBe('http');
    expect(socketSend).not.toHaveBeenCalled();
  });

  it('falls back to the WebSocket when the REST endpoint fails', async () => {
    // What a reverse proxy in front of Supabase returns: a 500 with no JSON body.
    httpSend.mockRejectedValue(new Error('Internal Server Error'));

    const transport = await broadcastRealtimeEvent('chat:1', 'ai_suggestion', { chatId: '1' });

    expect(transport).toBe('websocket');
    expect(socketSend).toHaveBeenCalledWith({
      type: 'broadcast',
      event: 'ai_suggestion',
      payload: { chatId: '1' },
    });
  });

  it('stops retrying the broken REST endpoint on every event', async () => {
    httpSend.mockRejectedValue(new Error('Internal Server Error'));

    await broadcastRealtimeEvent('chat:1', 'ai_processing_start', { chatId: '1' });
    await broadcastRealtimeEvent('chat:1', 'ai_suggestion', { chatId: '1' });
    await broadcastRealtimeEvent('chat:1', 'ai_processing_stop', { chatId: '1' });

    expect(httpSend).toHaveBeenCalledTimes(1);
    expect(socketSend).toHaveBeenCalledTimes(3);
  });

  it('reuses a joined channel instead of rejoining per event', async () => {
    httpSend.mockRejectedValue(new Error('Internal Server Error'));

    await broadcastRealtimeEvent('chat:1', 'ai_processing_start', { chatId: '1' });
    await broadcastRealtimeEvent('chat:1', 'ai_suggestion', { chatId: '1' });

    // One channel for the failed REST attempt, one joined socket channel.
    expect(channel).toHaveBeenCalledTimes(2);
  });

  it('reports failure when neither transport delivers', async () => {
    httpSend.mockRejectedValue(new Error('Internal Server Error'));
    subscribeStatus = 'CHANNEL_ERROR';

    const transport = await broadcastRealtimeEvent('chat:1', 'ai_suggestion', { chatId: '1' });

    expect(transport).toBe('failed');
  });

  it('drops a dead channel so the next event rejoins', async () => {
    httpSend.mockRejectedValue(new Error('Internal Server Error'));
    socketSend.mockResolvedValueOnce('timed out').mockResolvedValue('ok');

    const first = await broadcastRealtimeEvent('chat:1', 'ai_suggestion', { chatId: '1' });
    const second = await broadcastRealtimeEvent('chat:1', 'ai_suggestion', { chatId: '1' });

    expect(first).toBe('failed');
    expect(second).toBe('websocket');
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('identifies private broadcast topics correctly', () => {
    expect(isPrivateBroadcastTopic('workspace:ws-1:chats')).toBe(true);
    expect(isPrivateBroadcastTopic('workspace:ws-1:messages')).toBe(true);
    expect(isPrivateBroadcastTopic('workspace:ws-1:contacts')).toBe(true);
    expect(isPrivateBroadcastTopic('room:chat-1:messages')).toBe(true);
    expect(isPrivateBroadcastTopic('private:custom')).toBe(true);
    expect(isPrivateBroadcastTopic('chat:1')).toBe(false);

    expect(isPrivateBroadcastTopic('chat:1', { isPrivate: true })).toBe(true);
    expect(isPrivateBroadcastTopic('workspace:ws-1:chats', { isPrivate: false })).toBe(false);
  });

  it('configures channel with private: true for workspace topic in REST path', async () => {
    httpSend.mockResolvedValue({ success: true });

    await broadcastRealtimeEvent('workspace:ws-1:chats', 'UPDATE', { id: 'chat-1' });

    expect(channel).toHaveBeenCalledWith('workspace:ws-1:chats', {
      config: { private: true },
    });
  });

  it('configures channel with private: true for room topic in REST path', async () => {
    httpSend.mockResolvedValue({ success: true });

    await broadcastRealtimeEvent('room:chat-1:messages', 'INSERT', { id: 'msg-1' });

    expect(channel).toHaveBeenCalledWith('room:chat-1:messages', {
      config: { private: true },
    });
  });

  it('configures channel with private: true in WebSocket fallback for private topics', async () => {
    httpSend.mockRejectedValue(new Error('Internal Server Error'));

    await broadcastRealtimeEvent('workspace:ws-1:chats', 'UPDATE', { id: 'chat-1' });

    // REST failed attempt called channel, and WebSocket fallback called channel:
    expect(channel).toHaveBeenCalledWith('workspace:ws-1:chats', {
      config: { private: true },
    });
  });

  it('respects explicit isPrivate option override', async () => {
    httpSend.mockResolvedValue({ success: true });

    await broadcastRealtimeEvent('custom:topic', 'ping', {}, { isPrivate: true });

    expect(channel).toHaveBeenCalledWith('custom:topic', {
      config: { private: true },
    });
  });
});
