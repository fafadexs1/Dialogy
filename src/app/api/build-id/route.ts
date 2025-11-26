'use server';

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const buildId =
  process.env.NEXT_BUILD_ID ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.BUILD_ID ||
  'dev';

export async function GET() {
  const headers = new Headers();
  headers.set('Cache-Control', 'no-store, must-revalidate');
  headers.set('Pragma', 'no-cache');
  headers.set('X-Build-Id', buildId);

  return NextResponse.json(
    {
      buildId,
      generatedAt: new Date().toISOString(),
    },
    { headers }
  );
}
