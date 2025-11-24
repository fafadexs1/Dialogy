import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@/lib/database.types';
import { baseCookieOptions, buildSessionCookieOptions } from '@/lib/supabase/cookie-options';

export const createClient = async () => {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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
          } catch (error) {
            // The `set` method was called from a Server Component without
            // a mutable cookie store. Middleware will refresh the session.
          }
        },
      },
    }
  );
};
