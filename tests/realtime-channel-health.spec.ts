import { describe, expect, it } from 'vitest';
import {
  applyRealtimeChannelStatus,
  hasHealthyMessageCoverage,
  INITIAL_REALTIME_CHANNEL_HEALTH,
} from '@/lib/realtime/channel-health';

describe('realtime channel health', () => {
  it('only marks a channel healthy after SUBSCRIBED and clears it on failures', () => {
    const subscribed = applyRealtimeChannelStatus(INITIAL_REALTIME_CHANNEL_HEALTH, 'chats', 'SUBSCRIBED');
    expect(subscribed.chats).toBe(true);
    expect(applyRealtimeChannelStatus(subscribed, 'chats', 'CHANNEL_ERROR').chats).toBe(false);
    expect(applyRealtimeChannelStatus(subscribed, 'chats', 'TIMED_OUT').chats).toBe(false);
    expect(applyRealtimeChannelStatus(subscribed, 'chats', 'CLOSED').chats).toBe(false);
  });

  it('requires list coverage and the selected thread channel when a chat is open', () => {
    const listOnly = { chats: true, messages: false, messagesList: true };
    expect(hasHealthyMessageCoverage(listOnly, false)).toBe(true);
    expect(hasHealthyMessageCoverage(listOnly, true)).toBe(false);
    expect(hasHealthyMessageCoverage({ ...listOnly, messages: true }, true)).toBe(true);
  });
});
