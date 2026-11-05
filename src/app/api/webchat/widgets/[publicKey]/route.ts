import { NextRequest, NextResponse } from 'next/server';
import { loadPublicWidget } from '@/services/webchat/public-api';
import { isWebchatOriginAllowed } from '@/services/webchat/origin';

export async function GET(request: NextRequest, { params }: { params: Promise<{ publicKey: string }> }) {
  const { publicKey } = await params;
  const widget = await loadPublicWidget(publicKey);
  if (!widget) return NextResponse.json({ error: 'widget_not_found' }, { status: 404 });
  const origin = request.nextUrl.searchParams.get('origin');
  if (!isWebchatOriginAllowed(origin, widget.allowedDomains)) return NextResponse.json({ error: 'origin_not_allowed' }, { status: 403 });
  return NextResponse.json({
    publicKey: widget.publicKey, name: widget.name, title: widget.title, welcomeMessage: widget.welcomeMessage,
    primaryColor: widget.primaryColor, position: widget.position, requireName: widget.requireName, requireEmail: widget.requireEmail,
  }, {
    headers: {
      'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
    },
  });
}

