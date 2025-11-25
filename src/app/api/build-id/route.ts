'use server';

import { NextResponse } from 'next/server';

const buildId =
  process.env.NEXT_BUILD_ID ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.BUILD_ID ||
  'dev';

export async function GET() {
  return NextResponse.json({
    buildId,
    generatedAt: new Date().toISOString(),
  });
}
