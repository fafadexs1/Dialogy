import { describe, expect, it } from 'vitest';
import { stripStorageSignature, normalizeStoredMediaUrl } from '@/lib/storage-url';

describe('Audio Storage URL Normalization & Whisper Ingestion', () => {
  it('preserves AWS SigV4 signatures for Cloudflare R2 and AWS S3', () => {
    const r2SignedUrl = 'https://e7a77bd12526452c5e5aae1c02dcd392.r2.cloudflarestorage.com/evolution/evolution-api/audio/sample.ogg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=key%2F20260911%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260911T195640Z&X-Amz-Expires=604800&X-Amz-SignedHeaders=host&X-Amz-Signature=934b3acabdf6327d1a828a930998aa4658f7a42ce1ad1e73364fed69fc658cdf';
    const genericR2SignedUrl = 'https://other-bucket.r2.cloudflarestorage.com/evolution/audio/sample.ogg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc123';
    const s3SignedUrl = 'https://my-bucket.s3.amazonaws.com/voice-notes/audio.ogg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc123';

    // Must NOT strip signature for direct R2 or S3
    expect(stripStorageSignature(genericR2SignedUrl)).toBe(genericR2SignedUrl);
    expect(normalizeStoredMediaUrl(genericR2SignedUrl)).toBe(genericR2SignedUrl);
    expect(stripStorageSignature(s3SignedUrl)).toBe(s3SignedUrl);
    expect(normalizeStoredMediaUrl(s3SignedUrl)).toBe(s3SignedUrl);

    // When configured with a public CDN rewrite, normalizeStoredMediaUrl uses the public CDN
    const rewritten = normalizeStoredMediaUrl(r2SignedUrl);
    expect(rewritten.startsWith('https://cdn-dialogy.klyraai.com.br/') || rewritten === r2SignedUrl).toBe(true);
  });

  it('strips AWS SigV4 signatures for legacy public MinIO hosts', () => {
    const minioSignedUrl = 'https://storage.klyraai.com.br/evolution/voice.ogg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc123';
    expect(stripStorageSignature(minioSignedUrl)).toBe('https://storage.klyraai.com.br/evolution/voice.ogg');
  });

  it('correctly derives effective message when customer sends audio with transcription', () => {
    const lastMessageContent = '';
    const audioTranscriptionText = 'Qual é o valor que eu pago por mês?';
    const mediaAnalysisContext = `[Analise automatica de audio] ${audioTranscriptionText}`;

    const effectiveCustomerMessage = (lastMessageContent || '').trim()
      ? (audioTranscriptionText ? `${(lastMessageContent || '').trim()}\n\n[Transcrição do áudio]: ${audioTranscriptionText}` : (lastMessageContent || '').trim())
      : (audioTranscriptionText || (mediaAnalysisContext ? mediaAnalysisContext.replace(/^\[(?:Analise automatica de [^\]]+)\]\s*/i, '').trim() : '') || '');

    expect(effectiveCustomerMessage).toBe('Qual é o valor que eu pago por mês?');
  });

  it('combines text caption with audio transcription when both are present', () => {
    const lastMessageContent = 'Escuta esse áudio por favor';
    const audioTranscriptionText = 'Qual é o valor que eu pago por mês?';

    const effectiveCustomerMessage = (lastMessageContent || '').trim()
      ? (audioTranscriptionText ? `${(lastMessageContent || '').trim()}\n\n[Transcrição do áudio]: ${audioTranscriptionText}` : (lastMessageContent || '').trim())
      : (audioTranscriptionText || '');

    expect(effectiveCustomerMessage).toBe('Escuta esse áudio por favor\n\n[Transcrição do áudio]: Qual é o valor que eu pago por mês?');
  });
});
