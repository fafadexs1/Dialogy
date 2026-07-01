import { NextRequest, NextResponse } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

function safeNextPath(value: string | null): string {
  return value?.startsWith('/') && !value.startsWith('//') ? value : '/inbox';
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const next = safeNextPath(url.searchParams.get('next'));
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  const supabase = await createClient();

  const result = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && type
      ? await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
      : { error: new Error('Link de ativação incompleto.') };

  if (!result.error) {
    return NextResponse.redirect(new URL(next, url.origin));
  }

  const loginUrl = new URL('/login', url.origin);
  loginUrl.searchParams.set('activation_error', 'invalid_or_expired');
  return NextResponse.redirect(loginUrl);
}
