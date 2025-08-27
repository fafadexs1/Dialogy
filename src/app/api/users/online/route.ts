
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type { OnlineAgent } from '@/lib/types';

// This endpoint is no longer used and will be replaced by the dynamic route.
// Keeping it temporarily to avoid breaking changes if anything still points here.
export async function GET() {
  return NextResponse.json(
    { error: 'This endpoint is deprecated. Use /api/users/online/[workspaceId]' },
    { status: 404 }
  );
}
