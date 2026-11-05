import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { createClient } from '@/lib/supabase/server';
import { requireWorkspaceAccess } from '@/server/inbox/access';
import { consumeRateLimit } from '@/lib/ratelimit';
import {
  getWhisperJob, signAudioJobToken, startWhisperJob, transcribeAudioUrlWithWhisper,
  verifyAudioJobToken, WhisperRequestError,
} from '@/services/audio/transcription-service';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const audioUrl = typeof body.audioUrl === 'string' ? body.audioUrl.trim() : '';
    const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId.trim() : '';
    let messageId = typeof body.messageId === 'string' ? body.messageId.trim() : '';
    let chatId = typeof body.chatId === 'string' ? body.chatId.trim() : '';
    const jobToken = typeof body.jobToken === 'string' ? body.jobToken : '';

    if ((!audioUrl && !jobToken) || !workspaceId) {
      return NextResponse.json({ error: 'audioUrl e workspaceId sao obrigatorios.' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const access = await requireWorkspaceAccess(user?.id, workspaceId);

    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: user ? 403 : 401 });
    }
    const claims = jobToken ? verifyAudioJobToken(jobToken, workspaceId) : null;
    if (claims) { messageId = claims.messageId; chatId = claims.chatId; }
    const rate = consumeRateLimit(`audio-transcribe:${claims ? 'poll' : 'start'}:${workspaceId}:${user!.id}`, claims ? 600 : 20, 60_000);
    if (!rate.ok) {
      return NextResponse.json({ code: 'rate_limited', error: 'Muitas transcricoes.' }, { status: 429 });
    }

    if (messageId) {
      const messageRes = await db.query(
        `SELECT id, transcription
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
      const cached = messageRes.rows[0]?.transcription;
      if (typeof cached === 'string' && cached.trim()) {
        return NextResponse.json({ success: true, status: 'completed', transcription: cached.trim(), saved: true });
      }
    }

    // Older clients can still request the synchronous contract. The inbox uses jobs.
    const job = claims ? await getWhisperJob(claims.jobId)
      : body.async === true ? await startWhisperJob(audioUrl, `${workspaceId}:${messageId || user!.id}`) : null;
    if (job && (job.status === 'queued' || job.status === 'running')) {
      return NextResponse.json({ success: true, status: job.status, retryAfterMs: 2_000,
        jobToken: jobToken || signAudioJobToken({ jobId: job.jobId, workspaceId, messageId, chatId }) }, { status: 202 });
    }
    if (job?.status === 'failed') {
      return NextResponse.json({ error: job.error || 'Falha ao processar o audio.' }, { status: 422 });
    }
    const transcription = job ? job.transcription : await transcribeAudioUrlWithWhisper(audioUrl);
    if (!transcription) throw new Error('Nao foi detectada fala no audio.');

    if (messageId) {
      await db.query(
        'UPDATE messages SET transcription = $1 WHERE id = $2 AND workspace_id = $3',
        [transcription, messageId, workspaceId]
      );
    }

    return NextResponse.json({
      success: true,
      status: 'completed',
      transcription,
      saved: Boolean(messageId),
    });
  } catch (error: any) {
    console.error('[AUDIO_TRANSCRIBE_API] Error:', error);
    return NextResponse.json(
      { error: error?.message || 'Falha ao transcrever audio.' },
      { status: error instanceof WhisperRequestError ? error.status : 500 }
    );
  }
}
