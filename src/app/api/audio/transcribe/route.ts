import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { createClient } from '@/lib/supabase/server';
import { requireWorkspaceAccess } from '@/server/inbox/access';
import { consumeRateLimit } from '@/lib/ratelimit';
import { transcribeAudioUrlWithWhisper } from '@/services/audio/transcription-service';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const audioUrl = typeof body.audioUrl === 'string' ? body.audioUrl.trim() : '';
    const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId.trim() : '';
    const messageId = typeof body.messageId === 'string' ? body.messageId.trim() : '';
    const chatId = typeof body.chatId === 'string' ? body.chatId.trim() : '';

    if (!audioUrl || !workspaceId) {
      return NextResponse.json({ error: 'audioUrl e workspaceId sao obrigatorios.' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const access = await requireWorkspaceAccess(user?.id, workspaceId);

    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: user ? 403 : 401 });
    }
    const rate = consumeRateLimit(`audio-transcribe:${workspaceId}:${user!.id}`, 20, 60_000);
    if (!rate.ok) {
      return NextResponse.json({ code: 'rate_limited', error: 'Muitas transcricoes.' }, { status: 429 });
    }

    if (messageId) {
      const messageRes = await db.query(
        `SELECT id
         FROM messages
         WHERE id = $1
           AND workspace_id = $2
           AND ($3::uuid IS NULL OR chat_id = $3::uuid)
         LIMIT 1`,
        [messageId, workspaceId, chatId || null]
      );

      if ((messageRes.rowCount ?? 0) === 0) {
        return NextResponse.json({ error: 'Mensagem nao encontrada neste workspace.' }, { status: 404 });
      }
    }

    const transcription = await transcribeAudioUrlWithWhisper(audioUrl);

    if (messageId) {
      await db.query(
        'UPDATE messages SET transcription = $1 WHERE id = $2 AND workspace_id = $3',
        [transcription, messageId, workspaceId]
      );
    }

    return NextResponse.json({
      success: true,
      transcription,
      saved: Boolean(messageId),
    });
  } catch (error: any) {
    console.error('[AUDIO_TRANSCRIBE_API] Error:', error);
    return NextResponse.json(
      { error: error?.message || 'Falha ao transcrever audio.' },
      { status: 500 }
    );
  }
}
