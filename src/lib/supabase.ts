import { createClient } from '@supabase/supabase-js';

// DEPRECATED: This admin client is no longer used.
// The app now uses @supabase/ssr helpers for client, server, and middleware.
// See /lib/supabase for the new implementation.

// Separate admin client for server-side operations that require elevated privileges
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
