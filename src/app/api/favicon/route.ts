import { NextResponse, type NextRequest } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
import { globalSeoStore } from '@/services/global-seo-store';

export const dynamic = 'force-dynamic';

const ICON_PATH = path.join(process.cwd(), 'public', 'favicon.ico');
const FALLBACK_ICON_PATH = path.join(process.cwd(), 'public', 'favicon-default.ico');

const getContentType = (buffer: Buffer) => {
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png';
  }

  if (buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x01 && buffer[3] === 0x00) {
    return 'image/x-icon';
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  return 'image/x-icon';
};

const withVersion = (url: string, version: number) => {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}v=${version}`;
};

export async function GET(request: NextRequest) {
  const { settings, updatedAt } = await globalSeoStore.getWithMeta();

  if (settings.faviconUrl) {
    const version = updatedAt ? new Date(updatedAt).getTime() : Date.now();
    const target = withVersion(settings.faviconUrl, version);
    const absoluteTarget = new URL(target, request.url);
    const response = NextResponse.redirect(absoluteTarget, 307);
    response.headers.set('Cache-Control', 'no-store, must-revalidate');
    response.headers.set('Pragma', 'no-cache');
    return response;
  }

  try {
    const icon = await readFile(ICON_PATH).catch(() => readFile(FALLBACK_ICON_PATH));
    return new NextResponse(icon, {
      status: 200,
      headers: {
        'Content-Type': getContentType(icon),
        'Cache-Control': 'no-store, must-revalidate',
        'Pragma': 'no-cache',
      },
    });
  } catch (error) {
    console.error('[FAVICON] Failed to load fallback icon:', error);
    return new NextResponse(null, { status: 204 });
  }
}
