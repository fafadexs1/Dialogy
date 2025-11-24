import { type CookieOptions } from '@supabase/ssr';

export const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

export const baseCookieOptions: CookieOptions = {
  maxAge: SESSION_MAX_AGE,
  path: '/',
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
};

export const buildSessionCookieOptions = (options?: CookieOptions): CookieOptions => ({
  ...baseCookieOptions,
  ...options,
  maxAge: options?.maxAge === 0 ? 0 : baseCookieOptions.maxAge,
});
