import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/meta/meta-channel.service', () => ({
  resolveMetaContext: vi.fn(),
  persistNormalizedMessage: vi.fn(),
  logWebhookEvent: vi.fn(),
}));
vi.mock('@/services/meta/archive-inbound-media', () => ({ archiveInboundMetaMedia: vi.fn() }));

import {
  fetchInstagramLocationDetails,
  normalizeInstagramMessage,
} from '@/services/meta/instagram-webhook-service';

describe('Instagram message normalization', () => {
  it('extracts coordinates from location attachments', () => {
    const normalized = normalizeInstagramMessage({
      message: {
        attachments: [{
          type: 'location',
          payload: {
            title: 'Loja',
            coordinates: { lat: '-16.6864', long: '-49.2643' },
          },
        }],
      },
    });

    expect(normalized).toMatchObject({
      type: 'location',
      content: 'Loja',
      mediaUrl: null,
      metadata: {
        latitude: -16.6864,
        longitude: -49.2643,
        metaLocationUnavailable: false,
      },
    });
  });

  it('marks empty generic templates as unavailable locations', () => {
    const normalized = normalizeInstagramMessage({
      message: {
        attachments: [{ type: 'template', payload: { generic: { elements: [] } } }],
      },
    });

    expect(normalized).toMatchObject({
      type: 'location',
      content: 'Localização compartilhada (dados não fornecidos pela Meta)',
      mediaUrl: null,
      metadata: {
        metaAttachmentType: 'template',
        metaLocationUnavailable: true,
      },
    });
  });

  it('recovers omitted location details through the message attachments edge', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      attachments: {
        data: [{
          generic_template: {
            title: 'Localização atual',
            subtitle: 'Contato está compartilhando',
            media_url: 'https://external.example.fbcdn.net/static_map.php?markers=-16.11032889%2C-47.92492144',
          },
        }],
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })));

    const details = await fetchInstagramLocationDetails('token', 'message-id');

    expect(details).toEqual({
      title: 'Localização atual',
      subtitle: 'Contato está compartilhando',
      thumbnail: 'https://external.example.fbcdn.net/static_map.php?markers=-16.11032889%2C-47.92492144',
      latitude: -16.11032889,
      longitude: -47.92492144,
    });
  });
});
