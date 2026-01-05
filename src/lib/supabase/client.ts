

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

// Declare a global variable to hold the client.
let client: SupabaseClient | undefined;

/**
 * Creates a singleton Supabase client instance.
 * This ensures that only one WebSocket connection is established for real-time functionality.
 * @returns The Supabase client.
 */
export function createClient(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

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
    if (typeof window !== 'undefined') {
      (window as unknown as { __SUPABASE_CLIENT__?: SupabaseClient }).__SUPABASE_CLIENT__ = client;
      console.info('[SUPABASE] Realtime client initialized.');
    }
  }
  return client;
}

