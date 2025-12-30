import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getFeatureFlags } from '@/lib/feature-flags';

export const dynamic = 'force-dynamic';

const MAX_FLAGS = 50;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawFlags = url.searchParams.get('flags') || '';
  const flagNames = rawFlags
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, MAX_FLAGS);

  if (flagNames.length === 0) {
    return NextResponse.json({ flags: {} });
  }

  const workspaceId = url.searchParams.get('workspaceId') || undefined;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const flags = await getFeatureFlags(flagNames, {
    userId: user?.id,
    workspaceId,
  });

  return NextResponse.json({ flags });
}
