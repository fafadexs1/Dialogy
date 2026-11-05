import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ query: vi.fn(), getUser: vi.fn(), access: vi.fn(),
  start: vi.fn(), status: vi.fn(), sync: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { query: mocks.query } }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock('@/server/inbox/access', () => ({ requireWorkspaceAccess: mocks.access }));
vi.mock('@/lib/ratelimit', () => ({ consumeRateLimit: () => ({ ok: true }) }));
vi.mock('@/services/audio/transcription-service', async (original) => ({
  ...await original<typeof import('@/services/audio/transcription-service')>(),
  startWhisperJob: mocks.start, getWhisperJob: mocks.status, transcribeAudioUrlWithWhisper: mocks.sync,
}));

import { POST } from '@/app/api/audio/transcribe/route';
import { signAudioJobToken } from '@/services/audio/transcription-service';

const input = { audioUrl: 'https://cdn.example/audio.ogg', workspaceId: 'workspace-a', messageId: 'message-a', chatId: 'chat-a', async: true };
const jobId = 'a'.repeat(64);
const request = (body: unknown) => new NextRequest('https://dialogy.example/api/audio/transcribe', {
  method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
});

describe('Authenticated audio job API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('WHISPER_API_KEY', 'test-key');
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user' } } });
    mocks.access.mockResolvedValue({ ok: true });
    mocks.query.mockResolvedValue({ rowCount: 1, rows: [{ id: 'message-a', transcription: null }] });
    mocks.start.mockResolvedValue({ jobId, status: 'queued' });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('returns 202 without waiting for inference and signs the message binding', async () => {
    const response = await POST(request(input));
    expect(response.status).toBe(202);
    expect((await response.json()).jobToken).toEqual(expect.any(String));
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.start).toHaveBeenCalledWith(input.audioUrl, 'workspace-a:message-a');
  });

  it('saves completed results only on the message encoded in the signed token', async () => {
    const jobToken = signAudioJobToken({ jobId, workspaceId: 'workspace-a', messageId: 'message-a', chatId: 'chat-a' });
    mocks.status.mockResolvedValue({ jobId, status: 'completed', transcription: 'Resultado completo' });
    const response = await POST(request({ workspaceId: 'workspace-a', jobToken, messageId: 'another-message' }));
    expect(response.status).toBe(200);
    expect(mocks.query).toHaveBeenLastCalledWith(expect.stringContaining('UPDATE messages'), ['Resultado completo', 'message-a', 'workspace-a']);
  });

  it('rejects a token from a different workspace before reading or writing messages', async () => {
    const jobToken = signAudioJobToken({ jobId, workspaceId: 'workspace-a', messageId: 'message-a', chatId: 'chat-a' });
    const response = await POST(request({ workspaceId: 'workspace-b', jobToken }));
    expect(response.status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.status).not.toHaveBeenCalled();
  });

  it('checks authentication and workspace permission on every poll', async () => {
    mocks.access.mockResolvedValue({ ok: false, error: 'Sem permissao' });
    const response = await POST(request(input));
    expect(response.status).toBe(403);
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('reuses an already saved transcription without resubmitting audio', async () => {
    mocks.query.mockResolvedValue({ rowCount: 1, rows: [{ id: 'message-a', transcription: 'Ja transcrito' }] });
    const response = await POST(request(input));
    expect((await response.json()).transcription).toBe('Ja transcrito');
    expect(mocks.start).not.toHaveBeenCalled();
  });
});
