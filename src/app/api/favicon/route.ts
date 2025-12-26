import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
import { globalSeoStore } from '@/services/global-seo-store';

export const dynamic = 'force-dynamic';

const FALLBACK_ICON_PATH = path.join(process.cwd(), 'public', 'favicon-default.ico');

const withVersion = (url: string, version: number) => {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}v=${version}`;
};

export async function GET() {
  const { settings, updatedAt } = await globalSeoStore.getWithMeta();

  if (settings.faviconUrl) {
    const version = updatedAt ? new Date(updatedAt).getTime() : Date.now();
    const target = withVersion(settings.faviconUrl, version);
    const response = NextResponse.redirect(target, 307);
    response.headers.set('Cache-Control', 'no-store, must-revalidate');
    response.headers.set('Pragma', 'no-cache');
    return response;
  }

  try {
    const icon = await readFile(FALLBACK_ICON_PATH);
    return new NextResponse(icon, {
      status: 200,
      headers: {
        'Content-Type': 'image/x-icon',
        'Cache-Control': 'no-store, must-revalidate',
        'Pragma': 'no-cache',
      },
    });
  } catch (error) {
    console.error('[FAVICON] Failed to load fallback icon:', error);
    return new NextResponse(null, { status: 204 });
  }
}
