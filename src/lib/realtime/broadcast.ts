import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-side realtime broadcast with a transport fallback.
 *
 * The fast path is the REST endpoint (`/realtime/v1/api/broadcast`): stateless, no
 * socket to keep alive. But a reverse proxy sitting in front of Supabase can break
 * that single path while the WebSocket endpoint the browsers already use keeps
 * working. When that happens every AI event silently disappears from the inbox.
 *
 * So on an HTTP failure we fall back to the same WebSocket transport the clients
 * use, and remember the failure for a while to stop paying a doomed round-trip on
 * every event.
 */

export type RealtimeBroadcastTransport = 'http' | 'websocket' | 'failed';

const HTTP_COOLDOWN_MS = Number.parseInt(process.env.REALTIME_HTTP_COOLDOWN_MS || '', 10) || 300_000;
const SUBSCRIBE_TIMEOUT_MS = Number.parseInt(process.env.REALTIME_SUBSCRIBE_TIMEOUT_MS || '', 10) || 8_000;
const MAX_CACHED_CHANNELS = 64;

let httpUnavailableUntil = 0;
let socketClient: SupabaseClient | null = null;
const joinedChannels = new Map<string, Promise<RealtimeChannel | null>>();

function httpIsInCooldown(): boolean {
  return Date.now() < httpUnavailableUntil;
}

function markHttpUnavailable(): void {
  httpUnavailableUntil = Date.now() + HTTP_COOLDOWN_MS;
}

async function getSocketClient(): Promise<SupabaseClient | null> {
  if (socketClient) return socketClient;

  const { getSupabaseAdmin } = await import('@/lib/supabase');
  try {
    socketClient = getSupabaseAdmin();
    return socketClient;
  } catch (error) {
    console.error('[REALTIME_BROADCAST] Failed to create realtime client:', error);
    return null;
  }
}

/**
 * Channels are cached because joining costs a round-trip. A worker handling many
 * chats would otherwise open one socket channel per event.
 */
async function getJoinedChannel(topic: string): Promise<RealtimeChannel | null> {
  const cached = joinedChannels.get(topic);
  if (cached) return cached;

  const pending = (async (): Promise<RealtimeChannel | null> => {
    const client = await getSocketClient();
    if (!client) return null;

    const channel = client.channel(topic);
    const joined = await new Promise<boolean>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(false);
      }, SUBSCRIBE_TIMEOUT_MS);

      channel.subscribe((status) => {
        if (settled) return;
        if (status === 'SUBSCRIBED') {
          settled = true;
          clearTimeout(timer);
          resolve(true);
          return;
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          settled = true;
          clearTimeout(timer);
          resolve(false);
        }
      });
    });

    if (!joined) {
      await channel.unsubscribe().catch(() => undefined);
      return null;
    }
    return channel;
  })();

  joinedChannels.set(topic, pending);

  const channel = await pending;
  if (!channel) {
    joinedChannels.delete(topic);
    return null;
  }

  if (joinedChannels.size > MAX_CACHED_CHANNELS) {
    const oldestTopic = joinedChannels.keys().next().value;
    if (oldestTopic && oldestTopic !== topic) {
      const evicted = await joinedChannels.get(oldestTopic);
      joinedChannels.delete(oldestTopic);
      await evicted?.unsubscribe().catch(() => undefined);
    }
  }

  return channel;
}

async function broadcastOverWebsocket(
  topic: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  try {
    const channel = await getJoinedChannel(topic);
    if (!channel) return false;

    const result = await channel.send({ type: 'broadcast', event, payload });
    if (result === 'ok') return true;

    // A dead channel must not stay cached, or every later event reuses it.
    joinedChannels.delete(topic);
    await channel.unsubscribe().catch(() => undefined);
    return false;
  } catch (error) {
    joinedChannels.delete(topic);
    console.error(`[REALTIME_BROADCAST] WebSocket delivery failed for ${topic}/${event}:`, error);
    return false;
  }
}

export async function broadcastRealtimeEvent(
  topic: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<RealtimeBroadcastTransport> {
  if (!httpIsInCooldown()) {
    try {
      const { getSupabaseAdmin } = await import('@/lib/supabase');
      await getSupabaseAdmin().channel(topic).httpSend(event, payload);
      return 'http';
    } catch (error) {
      markHttpUnavailable();
      console.warn(
        `[REALTIME_BROADCAST] REST broadcast failed for ${topic}/${event}, falling back to WebSocket:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  const delivered = await broadcastOverWebsocket(topic, event, payload);
  if (delivered) return 'websocket';

  console.error(`[REALTIME_BROADCAST] Could not deliver ${topic}/${event} over any transport.`);
  return 'failed';
}

/** Test seam: clears cached transport state between cases. */
export function resetRealtimeBroadcastState(): void {
  httpUnavailableUntil = 0;
  socketClient = null;
  joinedChannels.clear();
}
