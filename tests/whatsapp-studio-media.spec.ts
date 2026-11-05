import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  read: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock('@/lib/whatsapp/evolution-api-client', () => ({
  fetchEvolutionAPI: mocks.api,
}));
vi.mock('@/lib/storage/private-s3', () => ({ readPrivateObject: mocks.read }));
import {
  getStudioCloudToken,
  listStudioMetaTemplates,
  uploadStudioImageToMeta,
} from '@/services/whatsapp/studio-media';

const config = {
  api_url: 'https://evolution.example',
  api_key: 'private-cluster-key',
};
const workspace = '10000000-0000-4000-8000-000000000001';
const key =
  'workspaces/' +
  workspace +
  '/whatsapp-studio/20000000-0000-4000-8000-000000000001.jpg';
const template = (index: number) => ({
  id: String(index),
  name: 'template_' + index,
  language: 'pt_BR',
  status: 'APPROVED',
  category: 'UTILITY',
  components: [{ type: 'BODY', text: 'Uma mensagem com cuidado.' }],
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.api.mockResolvedValue([
    {
      name: 'cloud',
      integration: 'WHATSAPP-BUSINESS',
      businessId: '123456789',
      token: 'private-meta-token',
    },
    {
      name: 'another-account',
      integration: 'WHATSAPP-BUSINESS',
      businessId: '999999999',
      token: 'another-secret',
    },
  ]);
  mocks.read.mockResolvedValue(Buffer.from([255, 216, 255, 219]));
});
afterEach(() => vi.unstubAllGlobals());

describe('Meta template pagination and resumable image upload', () => {
  it('loads templates beyond the first 25, uses the selected account and keeps credentials out of pagination URLs', async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        Response.json({
          data: Array.from({ length: 25 }, (_, index) => template(index)),
          paging: {
            next: 'https://graph.facebook.com/ignored?access_token=do-not-follow',
            cursors: { after: 'next-page-cursor' },
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          data: [
            template(24),
            template(25),
            template(26),
            template(27),
            template(28),
          ],
        }),
      );
    const result = await listStudioMetaTemplates(config, 'cloud');
    expect(result).toHaveLength(29);
    expect(result.at(-1)?.name).toBe('template_28');
    expect(mocks.api).toHaveBeenCalledWith(
      '/instance/fetchInstances?instanceName=cloud',
      config,
      expect.objectContaining({ method: 'GET' }),
    );
    const secondUrl = new URL(String(mocks.fetch.mock.calls[1][0]));
    expect(secondUrl.pathname).toBe('/v25.0/123456789/message_templates');
    expect(secondUrl.searchParams.get('after')).toBe('next-page-cursor');
    expect(secondUrl.searchParams.has('access_token')).toBe(false);
    expect(mocks.fetch.mock.calls[1][1].headers.Authorization).toBe(
      'Bearer private-meta-token',
    );
    expect(JSON.stringify(result)).not.toContain('private-meta-token');
  });
  it('does not expose raw Meta errors or silently return an empty list on authorization failure', async () => {
    mocks.fetch.mockResolvedValue(
      Response.json(
        { error: { message: 'private-meta-token', code: 190 } },
        { status: 403 },
      ),
    );
    let message = '';
    try {
      await listStudioMetaTemplates(config, 'cloud');
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('permissão');
    expect(message).not.toContain('private-meta-token');
  });
  it('stops a repeated pagination cursor instead of polling forever', async () => {
    mocks.fetch.mockImplementation(async () =>
      Response.json({
        data: [template(0)],
        paging: { next: 'present', cursors: { after: 'same-cursor' } },
      }),
    );
    await expect(listStudioMetaTemplates(config, 'cloud')).rejects.toThrow(
      'repetiu uma página',
    );
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
  it('never substitutes another account token if the selected Cloud instance is missing', async () => {
    await expect(getStudioCloudToken(config, 'missing')).rejects.toThrow(
      'credenciais',
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('uploads private JPEG bytes through the two Meta stages and returns only the sample handle', async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        Response.json({ id: 'upload:session-id?sig=signature' }),
      )
      .mockResolvedValueOnce(Response.json({ h: 'sample-handle' }));
    expect(
      await uploadStudioImageToMeta(key, workspace, 'private-meta-token'),
    ).toBe('sample-handle');
    expect(mocks.read).toHaveBeenCalledWith(key, 5 * 1024 * 1024);
    const sessionUrl = new URL(String(mocks.fetch.mock.calls[0][0]));
    expect(sessionUrl.pathname).toBe('/v25.0/app/uploads');
    expect(sessionUrl.searchParams.get('file_type')).toBe('image/jpeg');
    expect(sessionUrl.searchParams.has('access_token')).toBe(false);
    const upload = mocks.fetch.mock.calls[1];
    expect(upload[0]).toBe(
      'https://graph.facebook.com/v25.0/upload:session-id?sig=signature',
    );
    expect(upload[1].headers).toMatchObject({
      Authorization: 'OAuth private-meta-token',
      file_offset: '0',
      'Content-Type': 'image/jpeg',
    });
    expect(upload[1].body).toBeInstanceOf(Uint8Array);
  });
  it('rejects foreign image paths before reading storage or contacting Meta', async () => {
    await expect(
      uploadStudioImageToMeta(
        key,
        '90000000-0000-4000-8000-000000000001',
        'private-meta-token',
      ),
    ).rejects.toThrow('workspace');
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
