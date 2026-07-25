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

export const getSupabaseAdmin = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!,
  getServiceRoleKey(),
);
