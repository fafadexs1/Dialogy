import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import { fetchSafeRemote, readResponseBodyLimited } from '@/lib/security/safe-remote-url';
import { rewriteLegacyStorageHost } from '@/lib/storage-url';

const MAX_AUDIO_BYTES = 100 * 1024 * 1024;

function positiveTimeout(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.trunc(parsed), 86_400_000) : fallback;
}

export type WhisperJob = {
  jobId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  transcription?: string;
  error?: string;
};

export class WhisperRequestError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

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
      if (buffer.length > MAX_AUDIO_BYTES) throw new Error('Audio excede o limite de 100 MB.');
      return { buffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), mimeType, fileName };
    }
  }

  // 2. Suporte a Base64 puro (sem header data:)
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://') && !trimmed.startsWith('/') && trimmed.length > 100) {
    try {
      const buffer = Buffer.from(trimmed, 'base64');
      if (buffer.length > 0) {
        if (buffer.length > MAX_AUDIO_BYTES) throw new Error('Audio excede o limite de 100 MB.');
        return {
          buffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
          mimeType: 'audio/ogg',
          fileName: 'audio.ogg',
        };
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('100 MB')) throw error;
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

async function requestWhisperServer(audioData: { buffer: ArrayBuffer; mimeType: string; fileName: string }, signal?: AbortSignal): Promise<string> {
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
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(positiveTimeout(process.env.WHISPER_TIMEOUT_MS, 600_000))]) : AbortSignal.timeout(positiveTimeout(process.env.WHISPER_TIMEOUT_MS, 600_000)),
  });

  if (!whisperResponse.ok) {
    throw new Error(`Falha na API Whisper (${whisperResponse.status}).`);
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

async function requestOpenAiOrGroqWhisper(audioData: { buffer: ArrayBuffer; mimeType: string; fileName: string }, signal?: AbortSignal): Promise<string | null> {
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
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    console.warn(`[WHISPER_FALLBACK] Provedor ${groqKey ? 'Groq' : 'OpenAI'} falhou (${response.status}).`);
    return null;
  }

  const data = await response.json();
  return extractTranscription(data) || null;
}

export async function transcribeAudioUrlWithWhisper(audioUrl: string): Promise<string> {
  const audioData = await loadAudioBuffer(audioUrl);
  return transcribeAudioData(audioData, 'autopilot');
}

/** Input bytes are read from the workspace store, never exposed via a signed URL. */
export async function transcribePrivateAudioWithWhisper(input: { data: Buffer; mimeType: string; name: string; scope: string; signal: AbortSignal }): Promise<string> {
  input.signal.throwIfAborted();
  if (!input.data.length || input.data.length > 10_000_000) throw new Error('Selecione um áudio privado de até 10 MB.');
  const mimeType = input.mimeType.toLowerCase().split(';')[0].trim();
  if (!['audio/mpeg','audio/mp3','audio/ogg','audio/opus','audio/wav','audio/x-wav','audio/webm','audio/mp4','audio/m4a','audio/x-m4a','audio/flac','audio/x-flac'].includes(mimeType)) throw new Error('Formato de áudio não suportado para transcrição.');
  const normalized = deduceAudioMimeAndFilename('', mimeType === 'audio/x-flac' ? 'audio/flac' : mimeType);
  const bytes = Uint8Array.from(input.data);
  try { return await transcribeAudioData({ buffer: bytes.buffer, ...normalized }, input.scope, input.signal); }
  catch { input.signal.throwIfAborted(); throw new Error('Não foi possível transcrever o áudio com o serviço configurado.'); }
}

async function transcribeAudioData(audioData: { buffer: ArrayBuffer; mimeType: string; fileName: string }, scope: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();

  // 1. Tentar servidor primario (ex: faster-whisper klyraai)
  try {
    if (process.env.WHISPER_ASYNC_JOBS_ENABLED !== 'false') {
      let job = await submitWhisperJob(audioData, scope, signal);
      const deadline = Date.now() + positiveTimeout(process.env.WHISPER_JOB_WAIT_TIMEOUT_MS, 10_800_000);
      while (job.status === 'queued' || job.status === 'running') {
        if (Date.now() >= deadline) throw new Error('A transcricao continua em processamento. Tente novamente para recuperar o resultado.');
        await sleep(2_000, undefined, signal ? { signal } : undefined);
        job = await getWhisperJob(job.jobId, signal);
      }
      if (job.status === 'completed' && job.transcription) return job.transcription;
      throw new Error(job.error || 'Nao foi detectada fala no audio.');
    }
    return await requestWhisperServer(audioData, signal);
  } catch (primaryError: any) {
    signal?.throwIfAborted();
    console.warn('[TRANSCRIBE_AUDIO] Servidor Whisper primario falhou, testando fallback.');

    // 2. Fallback para OpenAI / Groq se configurado
    const fallbackText = await requestOpenAiOrGroqWhisper(audioData, signal).catch(() => null);
    signal?.throwIfAborted();
    if (fallbackText) {
      return fallbackText;
    }

    throw primaryError;
  }
}

function whisperHeaders(): Record<string, string> {
  const apiKey = process.env.WHISPER_API_KEY?.trim();
  if (!resolveWhisperBaseUrl() || !apiKey) throw new Error('Servidor Whisper primario nao configurado.');
  return { Authorization: `Bearer ${apiKey}` };
}

async function requestJob(path: string, body?: FormData, signal?: AbortSignal): Promise<WhisperJob> {
  const headers = whisperHeaders();
  for (let attempt = 0; attempt < 4; attempt++) {
    signal?.throwIfAborted();
    try {
      const response = await fetch(`${resolveWhisperBaseUrl()}${path}`, {
        method: body ? 'POST' : 'GET', headers, body, cache: 'no-store',
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(positiveTimeout(process.env.WHISPER_REQUEST_TIMEOUT_MS, 60_000))]) : AbortSignal.timeout(positiveTimeout(process.env.WHISPER_REQUEST_TIMEOUT_MS, 60_000)),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message = typeof payload?.detail === 'string' ? payload.detail : `Falha na API Whisper (${response.status}).`;
        throw new WhisperRequestError(response.status === 404 && body
          ? 'Atualize o servico Whisper para a API de jobs 1.2.1 antes de ativar esta integracao.' : message, response.status);
      }
      if (!payload || !/^[a-f0-9]{64}$/.test(payload.job_id || '')
        || !['queued', 'running', 'completed', 'failed'].includes(payload.status)) {
        throw new WhisperRequestError('Resposta invalida do servidor Whisper.', 502);
      }
      return { jobId: payload.job_id, status: payload.status,
        transcription: extractTranscription(payload.result) || undefined,
        error: typeof payload.error === 'string' ? payload.error : undefined };
    } catch (error) {
      signal?.throwIfAborted();
      const retryable = !(error instanceof WhisperRequestError) || [429, 502, 503, 504].includes(error.status);
      if (!retryable || attempt === 3) throw error;
      await sleep(500 * 2 ** attempt, undefined, signal ? { signal } : undefined);
    }
  }
  throw new Error('Nao foi possivel acessar o servidor Whisper.');
}

async function submitWhisperJob(audioData: { buffer: ArrayBuffer; mimeType: string; fileName: string }, scope: string, signal?: AbortSignal): Promise<WhisperJob> {
  const body = new FormData();
  body.append('file', new Blob([audioData.buffer], { type: audioData.mimeType }), audioData.fileName);
  body.append('language', process.env.WHISPER_LANGUAGE?.trim() || 'pt');
  body.append('task', process.env.WHISPER_TASK?.trim() || 'transcribe');
  body.append('vad_filter', 'true');
  body.append('scope', scope);
  body.append('retry_failed', 'true');
  return requestJob('/v1/jobs', body, signal);
}

export async function startWhisperJob(audioUrl: string, scope: string): Promise<WhisperJob> {
  return submitWhisperJob(await loadAudioBuffer(audioUrl), scope);
}

export async function getWhisperJob(jobId: string, signal?: AbortSignal): Promise<WhisperJob> {
  if (!/^[a-f0-9]{64}$/.test(jobId)) throw new Error('Identificador de transcricao invalido.');
  return requestJob(`/v1/jobs/${jobId}`, undefined, signal);
}

type AudioJobClaims = { jobId: string; workspaceId: string; messageId: string; chatId: string; expiresAt: number };

function tokenSignature(payload: string): Buffer {
  const key = process.env.WHISPER_API_KEY?.trim();
  if (!key) throw new Error('Servidor Whisper primario nao configurado.');
  return createHmac('sha256', key).update(`dialogy-audio-job:${payload}`).digest();
}

export function signAudioJobToken(claims: Omit<AudioJobClaims, 'expiresAt'>): string {
  const payload = Buffer.from(JSON.stringify({ ...claims, expiresAt: Date.now() + 7 * 86_400_000 })).toString('base64url');
  return `${payload}.${tokenSignature(payload).toString('base64url')}`;
}

export function verifyAudioJobToken(token: string, workspaceId: string): AudioJobClaims {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) throw new Error();
    const [payload, encoded] = parts;
    const actual = Buffer.from(encoded, 'base64url');
    const expected = tokenSignature(payload);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error();
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as AudioJobClaims;
    if (claims.workspaceId !== workspaceId || !/^[a-f0-9]{64}$/.test(claims.jobId)
      || typeof claims.messageId !== 'string' || typeof claims.chatId !== 'string'
      || !Number.isFinite(claims.expiresAt) || claims.expiresAt < Date.now()) throw new Error();
    return claims;
  } catch {
    throw new WhisperRequestError('Solicitacao de transcricao invalida ou expirada.', 400);
  }
}
