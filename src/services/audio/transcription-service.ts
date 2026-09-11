import 'server-only';

import { fetchSafeRemote, readResponseBodyLimited } from '@/lib/security/safe-remote-url';
import { rewriteLegacyStorageHost } from '@/lib/storage-url';

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

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
  let target = audioUrl;
  try {
    const parsed = new URL(audioUrl);
    if (parsed.pathname === '/api/media') {
      target = parsed.searchParams.get('url') || audioUrl;
    }
  } catch {
    target = audioUrl;
  }

  return rewriteLegacyStorageHost(target) || target;
}

function deduceAudioMimeAndFilename(urlOrHint: string, rawMime?: string | null): { mimeType: string; fileName: string } {
  const lowerHint = (urlOrHint || '').toLowerCase();
  const normalizedRaw = (rawMime || '').split(';')[0].trim().toLowerCase();

  let mimeType = 'audio/ogg';
  let fileName = 'audio.ogg';

  if (lowerHint.includes('.mp3') || normalizedRaw === 'audio/mpeg' || normalizedRaw === 'audio/mp3') {
    mimeType = 'audio/mpeg';
    fileName = 'audio.mp3';
  } else if (lowerHint.includes('.wav') || normalizedRaw === 'audio/wav' || normalizedRaw === 'audio/x-wav') {
    mimeType = 'audio/wav';
    fileName = 'audio.wav';
  } else if (lowerHint.includes('.m4a') || normalizedRaw === 'audio/m4a' || normalizedRaw === 'audio/x-m4a') {
    mimeType = 'audio/m4a';
    fileName = 'audio.m4a';
  } else if (lowerHint.includes('.mp4') || normalizedRaw === 'audio/mp4') {
    mimeType = 'audio/mp4';
    fileName = 'audio.mp4';
  } else if (lowerHint.includes('.webm') || normalizedRaw === 'audio/webm') {
    mimeType = 'audio/webm';
    fileName = 'audio.webm';
  } else if (lowerHint.includes('.flac') || normalizedRaw === 'audio/flac') {
    mimeType = 'audio/flac';
    fileName = 'audio.flac';
  } else if (normalizedRaw.startsWith('audio/')) {
    mimeType = normalizedRaw;
    fileName = `audio.${normalizedRaw.split('/')[1] || 'ogg'}`;
  }

  return { mimeType, fileName };
}

async function loadAudioBuffer(audioInput: string): Promise<{ buffer: ArrayBuffer; mimeType: string; fileName: string }> {
  const trimmed = audioInput.trim();

  // 1. Suporte direto a Data URI
  if (trimmed.startsWith('data:')) {
    const commaIndex = trimmed.indexOf(',');
    if (commaIndex !== -1) {
      const header = trimmed.slice(0, commaIndex);
      const base64Data = trimmed.slice(commaIndex + 1);
      const mimeMatch = header.match(/^data:([^;]+)/);
      const rawMime = mimeMatch ? mimeMatch[1] : 'audio/ogg';
      const { mimeType, fileName } = deduceAudioMimeAndFilename('', rawMime);
      const buffer = Buffer.from(base64Data, 'base64');
      return { buffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), mimeType, fileName };
    }
  }

  // 2. Suporte a Base64 puro (sem header data:)
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://') && !trimmed.startsWith('/') && trimmed.length > 100) {
    try {
      const buffer = Buffer.from(trimmed, 'base64');
      if (buffer.length > 0) {
        return {
          buffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
          mimeType: 'audio/ogg',
          fileName: 'audio.ogg',
        };
      }
    } catch {
      // Nao era base64, continuar como URL
    }
  }

  // 3. Download da URL remota
  const sourceUrl = unwrapMediaProxyUrl(trimmed);
  const allowedHosts = (process.env.AUDIO_SOURCE_ALLOWED_HOSTS || '*')
    .split(',').map((host) => host.trim()).filter(Boolean);

  let response: Response;
  try {
    response = await fetchSafeRemote(sourceUrl, { cache: 'no-store' }, {
      allowedHosts: allowedHosts.length ? allowedHosts : ['*'],
      timeoutMs: 15_000,
      maxRedirects: 3,
    });
  } catch (safeRemoteError) {
    console.warn('[AUDIO_TRANSCRIBE] fetchSafeRemote falhou, tentando fetch direto:', safeRemoteError);
    response = await fetch(sourceUrl, {
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
  }

  if (!response.ok) {
    throw new Error(`Falha ao baixar audio (${response.status}): ${response.statusText}`);
  }

  const rawContentType = response.headers.get('content-type') || '';
  const { mimeType, fileName } = deduceAudioMimeAndFilename(sourceUrl, rawContentType);
  const audioBytes = await readResponseBodyLimited(response, MAX_AUDIO_BYTES);
  const arrayBuffer = new Uint8Array(audioBytes.byteLength);
  arrayBuffer.set(audioBytes);

  return { buffer: arrayBuffer.buffer, mimeType, fileName };
}

async function requestWhisperServer(audioData: { buffer: ArrayBuffer; mimeType: string; fileName: string }): Promise<string> {
  const baseUrl = resolveWhisperBaseUrl();
  const apiKey = process.env.WHISPER_API_KEY?.trim();

  if (!baseUrl || !apiKey) {
    throw new Error('Servidor Whisper primario nao configurado.');
  }

  const formData = new FormData();
  formData.append('file', new Blob([audioData.buffer], { type: audioData.mimeType }), audioData.fileName);
  formData.append('language', process.env.WHISPER_LANGUAGE?.trim() || 'pt');
  formData.append('task', process.env.WHISPER_TASK?.trim() || 'transcribe');
  formData.append('vad_filter', 'true');

  const whisperResponse = await fetch(resolveWhisperTranscribeUrl(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
    signal: AbortSignal.timeout(30_000),
  });

  if (!whisperResponse.ok) {
    const errorText = await whisperResponse.text().catch(() => '');
    throw new Error(`Falha na API Whisper (${whisperResponse.status}): ${errorText || whisperResponse.statusText}`);
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

async function requestOpenAiOrGroqWhisper(audioData: { buffer: ArrayBuffer; mimeType: string; fileName: string }): Promise<string | null> {
  const openAiKey = process.env.OPENAI_API_KEY?.trim();
  const groqKey = process.env.GROQ_API_KEY?.trim();

  if (!openAiKey && !groqKey) return null;

  const endpoint = groqKey
    ? 'https://api.groq.com/openai/v1/audio/transcriptions'
    : 'https://api.openai.com/v1/audio/transcriptions';
  const apiKey = groqKey || openAiKey;
  const model = groqKey ? 'whisper-large-v3-turbo' : 'whisper-1';

  const formData = new FormData();
  formData.append('file', new Blob([audioData.buffer], { type: audioData.mimeType }), audioData.fileName);
  formData.append('model', model);
  formData.append('language', 'pt');
  formData.append('response_format', 'json');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    console.warn(`[WHISPER_FALLBACK] Provedor ${groqKey ? 'Groq' : 'OpenAI'} falhou:`, errorText);
    return null;
  }

  const data = await response.json();
  return extractTranscription(data) || null;
}

export async function transcribeAudioUrlWithWhisper(audioUrl: string): Promise<string> {
  const audioData = await loadAudioBuffer(audioUrl);

  // 1. Tentar servidor primario (ex: faster-whisper klyraai)
  try {
    return await requestWhisperServer(audioData);
  } catch (primaryError: any) {
    console.warn('[TRANSCRIBE_AUDIO] Servidor Whisper primario falhou, testando fallback:', primaryError.message);

    // 2. Fallback para OpenAI / Groq se configurado
    const fallbackText = await requestOpenAiOrGroqWhisper(audioData).catch(() => null);
    if (fallbackText) {
      return fallbackText;
    }

    throw primaryError;
  }
}
