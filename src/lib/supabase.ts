import { createClient } from '@supabase/supabase-js';

// DEPRECATED: This admin client is no longer used.
// The app now uses @supabase/ssr helpers for client, server, and middleware.
// See /lib/supabase for the new implementation.

function getServiceRoleKey(): string {
  const candidates = [
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.SUPABASE_SECRET_KEY,
    process.env.SUPABASE_SECRET,
  ].filter(Boolean) as string[];

  for (const key of candidates) {
    try {
      const parts = key.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
        if (payload.role === 'service_role') {
          return key;
        }
      }
    } catch {}
  }

  return candidates[0] || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
}

export const getSupabaseAdmin = () => {
  const key = getServiceRoleKey();
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!,
    key,
  );

  // realtime-js only attaches `Authorization: Bearer <token>` to REST broadcasts when
  // an access token was set. A server-side client never opens the socket, so without
  // this the request carries only `apikey` — and Realtime answers 500 (MatchError in
  // AuthTenant.access_token/1) instead of a useful error, silently killing every
  // server-originated event. Setting an explicit token assigns it synchronously.
  if (key) {
    void client.realtime.setAuth(key);
  }

  return client;
};
