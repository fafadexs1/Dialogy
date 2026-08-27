

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveSupabasePublicKey } from '@/lib/supabase/public-key';

// Declare a global variable to hold the client.
let client: SupabaseClient | undefined;
let realtimeAuthSyncPromise: Promise<void> | null = null;

async function syncRealtimeAuth(supabase: SupabaseClient): Promise<void> {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.warn('[SUPABASE] Failed to fetch session for Realtime auth sync:', error.message);
    return;
  }

  const accessToken = data.session?.access_token;
  if (!accessToken) {
    console.warn('[SUPABASE] No access token available for Realtime private channels.');
    return;
  }

  supabase.realtime.setAuth(accessToken);
  console.info('[SUPABASE] Realtime auth token synced.');
}

/**
 * Creates a singleton Supabase client instance.
 * This ensures that only one WebSocket connection is established for real-time functionality.
 * @returns The Supabase client.
 */
export function createClient(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    // Keep server-side/secret variables out of the browser bundle. The anon
    // key is the legacy client-safe key and may also hold a safe publishable
    // key value during a gradual key migration.
    const key = resolveSupabasePublicKey({
      anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    });

    // [DEBUG] Log environment variable status (safely)
    if (typeof window !== 'undefined') {
      console.log('[SUPABASE-DEBUG] Initializing client...');
      console.log(`[SUPABASE-DEBUG] URL available: ${!!url}`);
      console.log(`[SUPABASE-DEBUG] Key available: ${!!key}`);
      if (!url || !key) {
        console.error('[SUPABASE-DEBUG] CRITICAL: Supabase URL or Key is MISSING in environment variables!');
      }
    }

    // If the client doesn't exist, create it.
    // Note: Keep realtime config minimal to avoid connection issues
    client = createBrowserClient(
      url!,
      key!,
      {
        realtime: {
          params: {
            eventsPerSecond: 20, // Slightly increased from default 10
          },
        },
      }
    );
    realtimeAuthSyncPromise = syncRealtimeAuth(client).catch((error) => {
      console.error('[SUPABASE] Unexpected error syncing Realtime auth:', error);
    });

    client.auth.onAuthStateChange((_event, session) => {
      const accessToken = session?.access_token;
      if (!accessToken) return;
      client?.realtime.setAuth(accessToken);
      console.info('[SUPABASE] Realtime auth token refreshed.');
    });

    if (typeof window !== 'undefined') {
      (window as unknown as { __SUPABASE_CLIENT__?: SupabaseClient }).__SUPABASE_CLIENT__ = client;
      console.info('[SUPABASE] Realtime client initialized.');
    }
  }
  return client;
}

export async function ensureRealtimeAuth(): Promise<SupabaseClient> {
  const supabase = createClient();
  if (realtimeAuthSyncPromise) {
    await realtimeAuthSyncPromise;
  } else {
    realtimeAuthSyncPromise = syncRealtimeAuth(supabase).catch((error) => {
      console.error('[SUPABASE] Unexpected error syncing Realtime auth:', error);
    });
    await realtimeAuthSyncPromise;
  }

  return supabase;
}

