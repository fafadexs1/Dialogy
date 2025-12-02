import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';
import { baseCookieOptions, buildSessionCookieOptions } from '@/lib/supabase/cookie-options';
import { decodeSupabaseJwt, getSupabaseAccessTokenFromCookies } from '@/lib/auth/token';

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: new Headers(request.headers),
    },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: baseCookieOptions,
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookies) {
          const mergedCookies = cookies.map(({ name, value, options }) => {
            const mergedOptions = buildSessionCookieOptions(options);
            request.cookies.set({ name, value, ...mergedOptions });
            return { name, value, options: mergedOptions };
          });

          response = NextResponse.next({
            request: {
              headers: new Headers(request.headers),
            },
          });

          mergedCookies.forEach(({ name, value, options }) => {
            response.cookies.set({ name, value, ...options });
          });
        },
      },
    }
  );

  // Refresh only when the token is close to expiring to avoid hammering /auth/v1/user.
  const accessToken = getSupabaseAccessTokenFromCookies(request.cookies);
  const decoded = decodeSupabaseJwt(accessToken);
  const now = Date.now();
  const refreshBufferMs = 5 * 60 * 1000; // 5 minutes
  const expMs = decoded?.exp ? decoded.exp * 1000 : null;
  const shouldRefresh = !decoded || !expMs || expMs - now < refreshBufferMs;

  if (shouldRefresh && supabase?.auth) {
    await supabase.auth.getUser();
  }

  return response;
}

