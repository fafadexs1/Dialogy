import { NextRequest, NextResponse } from 'next/server';

import { consumeRateLimit } from '@/lib/ratelimit';
import { requireWorkspacePermission } from '@/lib/security/access';
import { convertAudioFile } from '@/services/audio/conversion-service';

const activeConversions = new Set<string>();

export async function POST(request: NextRequest) {
  let workspaceId = '';
  try {
    const body = await request.json();
    const audioUrl = typeof body.audioUrl === 'string' ? body.audioUrl : '';
    workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
    if (!audioUrl || !workspaceId) {
      return NextResponse.json({ error: 'audioUrl and workspaceId are required.' }, { status: 400 });
    }

    const user = await requireWorkspacePermission(workspaceId, 'inbox:access');
    const rate = consumeRateLimit(`audio-convert:${workspaceId}:${user.id}`, 10, 60_000);
    if (!rate.ok) {
      return NextResponse.json({ code: 'rate_limited', error: 'Too many conversions.' }, { status: 429 });
    }
    if (activeConversions.has(workspaceId)) {
      return NextResponse.json({ code: 'rate_limited', error: 'A conversion is already running.' }, { status: 429 });
    }

    const allowedHosts = (process.env.AUDIO_SOURCE_ALLOWED_HOSTS || '')
      .split(',').map((host) => host.trim()).filter(Boolean);
    if (!allowedHosts.length) {
      return NextResponse.json(
        { code: 'dependency_unavailable', error: 'Audio source allowlist is not configured.' },
        { status: 503 },
      );
    }

    activeConversions.add(workspaceId);
    const result = await convertAudioFile(audioUrl, workspaceId, allowedHosts);
    return NextResponse.json(result, { status: result.success ? 200 : 422 });
  } catch (error) {
    const status = typeof error === 'object' && error && 'status' in error ? Number(error.status) : 500;
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Conversion failed' },
      { status },
    );
  } finally {
    if (workspaceId) activeConversions.delete(workspaceId);
  }
}
