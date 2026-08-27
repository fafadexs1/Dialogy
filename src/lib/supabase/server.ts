import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { baseCookieOptions, buildSessionCookieOptions } from '@/lib/supabase/cookie-options';
import { decodeSupabaseJwt, getSupabaseAccessTokenFromCookies, mapPayloadToSupabaseUser } from '@/lib/auth/token';
import { resolveSupabasePublicKey } from '@/lib/supabase/public-key';

export const createClient = async () => {
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    resolveSupabasePublicKey({
      anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY,
    })!,
    {
      cookieOptions: baseCookieOptions,
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(setCookies) {
          try {
            setCookies.forEach(({ name, value, options }) => {
              const mergedOptions = buildSessionCookieOptions(options);
              cookieStore.set({ name, value, ...mergedOptions });
            });
          } catch {
            // The `set` method was called from a Server Component without
            // a mutable cookie store. Middleware will refresh the session.
          }
        },
      },
    }
  );

  // Override getUser to avoid repeated calls to /auth/v1/user on every action.
  const accessToken = getSupabaseAccessTokenFromCookies(cookieStore);
  const decoded = await decodeSupabaseJwt(accessToken);

  if (decoded) {
    const cachedUser = mapPayloadToSupabaseUser(decoded);
    const patchedGetUser = async () => ({
      data: { user: cachedUser },
      error: null,
    });

    supabase.auth.getUser = patchedGetUser;
  }

  return supabase;
};
