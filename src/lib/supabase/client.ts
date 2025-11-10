
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
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
    // If the client doesn't exist, create it.
    client = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return client;
}
