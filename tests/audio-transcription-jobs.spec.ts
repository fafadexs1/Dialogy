import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getWhisperJob, signAudioJobToken, startWhisperJob, transcribeAudioUrlWithWhisper, verifyAudioJobToken,
} from '@/services/audio/transcription-service';

const jobId = 'a'.repeat(64);
const claims = { jobId, workspaceId: 'workspace-a', messageId: 'message-a', chatId: 'chat-a' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('Whisper durable job integration', () => {
  beforeEach(() => {
    vi.stubEnv('WHISPER_BASE_URL', 'https://whisper.example');
    vi.stubEnv('WHISPER_API_KEY', 'test-key');
    vi.stubEnv('WHISPER_ASYNC_JOBS_ENABLED', 'true');
    vi.stubEnv('GROQ_API_KEY', '');
    vi.stubEnv('OPENAI_API_KEY', '');
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

  it('uploads audio once using the durable job endpoint and workspace scope', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ job_id: jobId, status: 'queued' }, 202));
    vi.stubGlobal('fetch', fetchMock);
    expect(await startWhisperJob('data:audio/ogg;base64,YXVkaW8=', 'workspace-a:message-a')).toMatchObject({ jobId, status: 'queued' });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://whisper.example/v1/jobs');
    expect(options.body.get('scope')).toBe('workspace-a:message-a');
    expect(options.body.get('file').size).toBe(5);
  });

  it('waits for processing across the old 30-second limit using short polls', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ job_id: jobId, status: 'queued' }, 202));
    for (let i = 0; i < 17; i++) fetchMock.mockResolvedValueOnce(json({ job_id: jobId, status: 'running' }));
    fetchMock.mockResolvedValue(json({ job_id: jobId, status: 'completed', result: { text: 'Audio de tres minutos completo' } }));
    vi.stubGlobal('fetch', fetchMock);
    const promise = transcribeAudioUrlWithWhisper('data:audio/ogg;base64,YXVkaW8=');
    await vi.advanceTimersByTimeAsync(36_000);
    await expect(promise).resolves.toBe('Audio de tres minutos completo');
    expect(fetchMock).toHaveBeenCalledTimes(19);
  });

  it('retries a transient service outage without creating a different job', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValueOnce(json({}, 503))
      .mockResolvedValue(json({ job_id: jobId, status: 'queued' }, 202));
    vi.stubGlobal('fetch', fetchMock);
    const promise = startWhisperJob('data:audio/ogg;base64,YXVkaW8=', 'scope');
    await vi.advanceTimersByTimeAsync(500);
    await expect(promise).resolves.toMatchObject({ jobId });
    expect(fetchMock.mock.calls[0][1].body).toBe(fetchMock.mock.calls[1][1].body);
  });

  it('does not retry unsupported job endpoints or invalid audio', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ detail: 'Not Found' }, 404));
    vi.stubGlobal('fetch', fetchMock);
    await expect(startWhisperJob('data:audio/ogg;base64,YXVkaW8=', 'scope')).rejects.toThrow('Atualize o servico Whisper');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed job IDs before contacting the service', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    await expect(getWhisperJob('../health')).rejects.toThrow('invalido');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('binds result tokens to their original workspace and message', () => {
    const token = signAudioJobToken(claims);
    expect(verifyAudioJobToken(token, 'workspace-a')).toMatchObject(claims);
    expect(() => verifyAudioJobToken(token, 'workspace-b')).toThrow('invalida');
    const [payload, signature] = token.split('.');
    const changed = Buffer.from(JSON.stringify({ ...claims, messageId: 'another-message' })).toString('base64url');
    expect(() => verifyAudioJobToken(`${changed}.${signature}`, 'workspace-a')).toThrow('invalida');
    expect(() => verifyAudioJobToken(`${payload}.AA`, 'workspace-a')).toThrow('invalida');
  });

  it('expires job tokens', () => {
    vi.useFakeTimers();
    const token = signAudioJobToken(claims);
    vi.setSystemTime(Date.now() + 8 * 86_400_000);
    expect(() => verifyAudioJobToken(token, 'workspace-a')).toThrow('expirada');
  });
});
