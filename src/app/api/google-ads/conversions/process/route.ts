import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';

import { processPendingGoogleAdsConversionExports } from '@/services/google-ads/conversion-upload';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const expectedSecret = process.env.GOOGLE_ADS_EXPORT_SECRET?.trim();
  if (!expectedSecret) {
    console.error('[GOOGLE_ADS_CONVERSIONS_PROCESS] GOOGLE_ADS_EXPORT_SECRET is not configured.');
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
  }

  const providedSecret = request.headers.get('x-dialogy-secret')?.trim() || '';
  const expectedBuffer = Buffer.from(expectedSecret);
  const providedBuffer = Buffer.from(providedSecret);
  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await processPendingGoogleAdsConversionExports();
    return NextResponse.json(result);
  } catch (error) {
    console.error('[GOOGLE_ADS_CONVERSIONS_PROCESS] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Falha ao processar conversoes Google Ads.' },
      { status: 500 }
    );
  }
}
