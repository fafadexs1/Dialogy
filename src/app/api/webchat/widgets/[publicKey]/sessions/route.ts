import { NextRequest, NextResponse } from 'next/server';
import { createPublicSession, loadPublicWidget } from '@/services/webchat/public-api';

export async function POST(request: NextRequest, { params }: { params: Promise<{ publicKey: string }> }) {
  try {
    const { publicKey } = await params;
    const widget = await loadPublicWidget(publicKey);
    if (!widget) return NextResponse.json({ error: 'widget_not_found' }, { status: 404 });
    const body = await request.json();
    if (widget.requireName && !String(body.name || '').trim()) return NextResponse.json({ error: 'name_required' }, { status: 400 });
    if (widget.requireEmail && !/^\S+@\S+\.\S+$/.test(String(body.email || ''))) return NextResponse.json({ error: 'email_required' }, { status: 400 });
    const session = await createPublicSession({
      widget, visitorId: body.visitorId, origin: body.origin, currentUrl: body.currentUrl, referrer: body.referrer,
      name: String(body.name || '').trim().slice(0, 120), email: String(body.email || '').trim().slice(0, 200),
      phone: String(body.phone || '').trim().slice(0, 40), utm: body.utm && typeof body.utm === 'object' ? body.utm : {},
    });
    return NextResponse.json(session, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'session_failed';
    return NextResponse.json({ error: code }, { status: code === 'origin_not_allowed' ? 403 : 500 });
  }
}

