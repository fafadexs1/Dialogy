import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasPendingAudioTranscription, transcribeAudioInBackground } from '@/services/audio/transcription-client';

const input = { audioUrl: 'https://cdn.example/audio.ogg', workspaceId: 'workspace', messageId: 'message' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let storage: Map<string, string>;

describe('Inbox audio job recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    storage = new Map();
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => storage.get(key),
      setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('deduplicates clicks and polls using the signed token', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ jobToken: 'signed-token' }, 202))
      .mockResolvedValue(json({ transcription: ' Audio completo ' }));
    vi.stubGlobal('fetch', fetchMock);
    const first = transcribeAudioInBackground(input);
    expect(transcribeAudioInBackground(input)).toBe(first);
    await vi.advanceTimersByTimeAsync(1);
    expect(hasPendingAudioTranscription(input)).toBe(true);
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(first).resolves.toBe('Audio completo');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ workspaceId: 'workspace', jobToken: 'signed-token' });
    expect(hasPendingAudioTranscription(input)).toBe(false);
  });

  it('resumes a persisted job after reload without uploading audio', async () => {
    storage.set('dialogy-audio-job:workspace:message', 'saved-token');
    const fetchMock = vi.fn().mockResolvedValue(json({ transcription: 'Retomado' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(transcribeAudioInBackground(input)).resolves.toBe('Retomado');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('audioUrl');
  });

  it('keeps the token across network failures and retries polling', async () => {
    storage.set('dialogy-audio-job:workspace:message', 'saved-token');
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(json({ transcription: 'Recuperado' }));
    vi.stubGlobal('fetch', fetchMock);
    const result = transcribeAudioInBackground(input);
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(result).resolves.toBe('Recuperado');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('resubmits an expired job and clears a terminal audio error', async () => {
    storage.set('dialogy-audio-job:workspace:message', 'expired-token');
    const fetchMock = vi.fn().mockResolvedValueOnce(json({}, 400))
      .mockResolvedValue(json({ error: 'Audio sem fala' }, 422));
    vi.stubGlobal('fetch', fetchMock);
    await expect(transcribeAudioInBackground(input)).rejects.toThrow('Audio sem fala');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ async: true, audioUrl: input.audioUrl });
    expect(hasPendingAudioTranscription(input)).toBe(false);
  });
});
