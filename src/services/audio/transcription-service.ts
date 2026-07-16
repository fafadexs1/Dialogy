import 'server-only';

import { fetchSafeRemote, readResponseBodyLimited } from '@/lib/security/safe-remote-url';

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

function resolveWhisperBaseUrl(): string {
  return (process.env.WHISPER_BASE_URL || process.env.BASE_URL || '').trim().replace(/\/+$/, '');
}

function resolveWhisperTranscribeUrl(): string {
  const baseUrl = resolveWhisperBaseUrl();
  const path = (process.env.WHISPER_TRANSCRIBE_PATH || '/v1/transcribe').trim();
  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

function extractTranscription(payload: unknown): string {
  if (typeof payload === 'string') return payload.trim();
  if (!payload || typeof payload !== 'object') return '';

  const data = payload as Record<string, unknown>;
  const candidates = [data.text, data.transcription, data.transcript, data.result];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return data.data && typeof data.data === 'object' ? extractTranscription(data.data) : '';
}

function unwrapMediaProxyUrl(audioUrl: string): string {
  try {
    const parsed = new URL(audioUrl);
    if (parsed.pathname === '/api/media') {
      return parsed.searchParams.get('url') || audioUrl;
    }
  } catch {
    return audioUrl;
  }

  return audioUrl;
}

export async function transcribeAudioUrlWithWhisper(audioUrl: string): Promise<string> {
  const baseUrl = resolveWhisperBaseUrl();
  const apiKey = process.env.WHISPER_API_KEY?.trim();

  if (!baseUrl) {
    throw new Error('API Whisper nao configurada. Defina WHISPER_BASE_URL ou BASE_URL no .env.');
  }

  if (!apiKey) {
    throw new Error('Chave da API Whisper nao configurada. Defina WHISPER_API_KEY no .env.');
  }

  const sourceUrl = unwrapMediaProxyUrl(audioUrl);
  const allowedHosts = (process.env.AUDIO_SOURCE_ALLOWED_HOSTS || '')
    .split(',').map((host) => host.trim()).filter(Boolean);
  if (!allowedHosts.length) throw new Error('Allowlist de origem de audio nao configurada.');

  const response = await fetchSafeRemote(sourceUrl, { cache: 'no-store' }, {
    allowedHosts,
    timeoutMs: 10_000,
    maxRedirects: 2,
  });
  if (!response.ok) {
    throw new Error(`Falha ao baixar audio: ${response.statusText}`);
  }

  const mimeType = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
  if (!mimeType.startsWith('audio/')) throw new Error('Tipo de midia invalido para transcricao.');
  const audioBytes = await readResponseBodyLimited(response, MAX_AUDIO_BYTES);
  const arrayBuffer = new Uint8Array(audioBytes.byteLength);
  arrayBuffer.set(audioBytes);
  const fileName = sourceUrl.split('/').pop()?.split('?')[0] || 'audio.mp3';
  const formData = new FormData();

  formData.append('file', new Blob([arrayBuffer.buffer], { type: mimeType }), fileName);
  formData.append('language', process.env.WHISPER_LANGUAGE?.trim() || 'pt');
  formData.append('task', process.env.WHISPER_TASK?.trim() || 'transcribe');

  const whisperResponse = await fetch(resolveWhisperTranscribeUrl(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!whisperResponse.ok) {
    const errorText = await whisperResponse.text().catch(() => '');
    throw new Error(`Falha na API Whisper: ${whisperResponse.status} ${errorText || whisperResponse.statusText}`);
  }

  const contentType = whisperResponse.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await whisperResponse.json()
    : await whisperResponse.text();
  const transcription = extractTranscription(payload);

  if (!transcription) {
    throw new Error('A API Whisper nao retornou texto de transcricao.');
  }

  return transcription;
}
