import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ putObject: vi.fn() }));
vi.mock('@/lib/storage/private-s3', () => ({ putPrivateObject: mocks.putObject }));

import { archiveInboundMetaMedia } from '@/services/meta/archive-inbound-media';

describe('Meta inbound media archive', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.putObject.mockReset().mockResolvedValue(undefined);
  });

  it('copies a direct Meta attachment to private storage', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'content-type': 'image/jpeg', 'content-length': '3' },
    })));

    const result = await archiveInboundMetaMedia({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      sourceUrl: 'https://scontent.example.fbcdn.net/photo.jpg',
      attachmentType: 'image',
    });

    expect(result).toMatchObject({ contentType: 'image/jpeg', size: 3, kind: 'attachment' });
    expect(result.key).toMatch(/^workspaces\/11111111-1111-4111-8111-111111111111\/message-media\/[0-9a-f-]{36}\.jpg$/);
    expect(mocks.putObject).toHaveBeenCalledWith(expect.objectContaining({
      key: result.key,
      contentType: 'image/jpeg',
    }));
  });

  it('archives the Open Graph preview for a shared Instagram Reel', async () => {
    const html = '<meta property="og:image" content="https://scontent.cdninstagram.com/preview.jpg?x=1&amp;y=2">';
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([4, 5]), {
        status: 200,
        headers: { 'content-type': 'image/webp' },
      })));

    const result = await archiveInboundMetaMedia({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      sourceUrl: 'https://www.instagram.com/reel/example/',
      attachmentType: 'ig_reel',
    });

    expect(result.kind).toBe('reel_preview');
    expect(result.key).toMatch(/\.webp$/);
    expect(fetch).toHaveBeenNthCalledWith(2, new URL('https://scontent.cdninstagram.com/preview.jpg?x=1&y=2'), expect.any(Object));
  });

  it('normalizes Meta voice notes mislabeled as video/mp4', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array([0, 1, 2]), {
      status: 200,
      headers: { 'content-type': 'video/mp4' },
    })));

    const result = await archiveInboundMetaMedia({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      sourceUrl: 'https://lookaside.fbsbx.com/voice-note',
      attachmentType: 'audio',
    });

    expect(result.contentType).toBe('audio/mp4');
    expect(result.key).toMatch(/\.m4a$/);
    expect(mocks.putObject).toHaveBeenCalledWith(expect.objectContaining({ contentType: 'audio/mp4' }));
  });

  it('rejects non-Meta hosts before downloading', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await expect(archiveInboundMetaMedia({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      sourceUrl: 'https://example.com/file.jpg',
      attachmentType: 'image',
    })).rejects.toThrow('Unsupported Meta media URL');
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.putObject).not.toHaveBeenCalled();
  });

  it('does not store oversized attachments', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('x', {
      status: 200,
      headers: { 'content-type': 'image/jpeg', 'content-length': String(26 * 1024 * 1024) },
    })));

    await expect(archiveInboundMetaMedia({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      sourceUrl: 'https://lookaside.fbsbx.com/file.jpg',
      attachmentType: 'image',
    })).rejects.toThrow('size limit');
    expect(mocks.putObject).not.toHaveBeenCalled();
  });
});
