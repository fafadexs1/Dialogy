'use client';

type TranscriptionInput = { audioUrl: string; workspaceId: string; messageId?: string; chatId?: string };
const pending = new Map<string, Promise<string>>();
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function storageKey(input: TranscriptionInput): string {
  return `dialogy-audio-job:${input.workspaceId}:${input.messageId || input.audioUrl}`;
}

function readToken(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function saveToken(key: string, token: string | null) {
  try {
    if (token) window.localStorage.setItem(key, token);
    else window.localStorage.removeItem(key);
  } catch { /* Private browsing can disable storage; the server job remains durable. */ }
}

export function hasPendingAudioTranscription(input: TranscriptionInput): boolean {
  return Boolean(readToken(storageKey(input)));
}

export function transcribeAudioInBackground(input: TranscriptionInput): Promise<string> {
  const key = storageKey(input);
  const existing = pending.get(key);
  if (existing) return existing;
  const request = run(input, key).finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}

async function run(input: TranscriptionInput, key: string): Promise<string> {
  let jobToken = readToken(key);
  let failures = 0;
  const deadline = Date.now() + 10_800_000;
  while (Date.now() < deadline) {
    let response: Response;
    try {
      response = await fetch('/api/audio/transcribe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jobToken ? { workspaceId: input.workspaceId, jobToken } : { ...input, async: true }),
        signal: AbortSignal.timeout(90_000),
      });
    } catch {
      if (++failures >= 8) throw new Error('Conexao interrompida. A transcricao fica salva; tente novamente para acompanhar.');
      await wait(Math.min(30_000, 1_000 * 2 ** failures));
      continue;
    }
    if (jobToken && [400, 404].includes(response.status)) {
      // Expired token/result: submit again. Content hashes prevent duplicate inference.
      saveToken(key, null);
      jobToken = null;
      continue;
    }
    if ([429, 500, 502, 503, 504].includes(response.status)) {
      if (++failures >= 8) throw new Error('Servico temporariamente indisponivel. Tente novamente para retomar a transcricao.');
      await wait(Math.min(30_000, 1_000 * 2 ** failures));
      continue;
    }
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 422) saveToken(key, null);
      throw new Error(typeof result?.error === 'string' ? result.error : 'Nao foi possivel transcrever o audio.');
    }
    if (response.status === 202 && typeof result?.jobToken === 'string') {
      failures = 0;
      jobToken = result.jobToken;
      saveToken(key, jobToken);
      await wait(2_000);
      continue;
    }
    if (typeof result?.transcription === 'string' && result.transcription.trim()) {
      saveToken(key, null);
      return result.transcription.trim();
    }
    // A proxy can return a temporary HTML page with HTTP 200.
    if (++failures >= 8) throw new Error('Resposta de transcricao indisponivel. Tente novamente para retomar.');
    await wait(2_000);
  }
  throw new Error('A transcricao continua em processamento. Tente novamente para recuperar o resultado.');
}
