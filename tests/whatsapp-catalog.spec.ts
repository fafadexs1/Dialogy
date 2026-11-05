import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchApi } = vi.hoisted(() => ({ fetchApi: vi.fn() }));
vi.mock('@/lib/whatsapp/evolution-api-client', () => ({ fetchEvolutionAPI: fetchApi }));

import { whatsappCatalogSchema, supportsWhatsappCatalog } from '@/lib/whatsapp/catalog';
import { sendCatalogMessage } from '@/services/whatsapp/send-catalog-message';
import { resolveEvolutionInteractiveSelectionFromQuotedMessage } from '@/lib/whatsapp/evolution-inbound-message';

export const catalog = {
  body: 'Confira nossos produtos!',
  cards: [{ title: 'Suéter', body: 'Tricô macio. R$ 129,90', imageUrl: 'https://cdn.example.com/sueter.jpg', buttons: [
    { type: 'url' as const, displayText: 'Compre agora', url: 'https://loja.example.com/sueter' },
    { type: 'reply' as const, displayText: 'Tenho interesse', id: 'product-sueter' },
  ] }],
};

describe('WhatsApp catalog contract and transport', () => {
  beforeEach(() => { fetchApi.mockReset().mockResolvedValue({ key: { id: 'provider-1' } }); });
  it('accepts 1 to 10 cards and rejects an empty or oversized catalog', () => {
    expect(whatsappCatalogSchema.safeParse(catalog).success).toBe(true);
    expect(whatsappCatalogSchema.safeParse({ ...catalog, cards: [] }).success).toBe(false);
    expect(whatsappCatalogSchema.safeParse({ ...catalog, cards: Array(10).fill(catalog.cards[0]) }).success).toBe(true);
    expect(whatsappCatalogSchema.safeParse({ ...catalog, cards: Array(11).fill(catalog.cards[0]) }).success).toBe(false);
  });
  it.each(['not a URL', 'javascript:alert(1)', 'http://cdn.example.com/a.jpg', 'https://user:pass@example.com/a.jpg'])('rejects invalid photo URL %s without throwing', (imageUrl) => {
    expect(whatsappCatalogSchema.safeParse({ ...catalog, cards: [{ ...catalog.cards[0], imageUrl }] }).success).toBe(false);
  });
  it('requires a photo, description and at least one button per card', () => {
    for (const patch of [{ imageUrl: '' }, { body: ' ' }, { title: '' }, { buttons: [] }]) {
      expect(whatsappCatalogSchema.safeParse({ ...catalog, cards: [{ ...catalog.cards[0], ...patch }] }).success).toBe(false);
    }
  });
  it('sends the native Evolution carousel and preserves the product title in the rendered body', async () => {
    const config = { api_url: 'https://evolution.example.com', api_key: 'test-key' };
    expect(await sendCatalogMessage(config, 'zap 1', '5511999999999@s.whatsapp.net', catalog)).toBe('provider-1');
    const [endpoint, , request] = fetchApi.mock.calls[0];
    expect(endpoint).toBe('/message/sendCarousel/zap%201');
    expect(JSON.parse(request.body)).toMatchObject({ body: catalog.body, number: '5511999999999', cards: [{ body: '*Suéter*\n\nTricô macio. R$ 129,90', buttons: catalog.cards[0].buttons }] });
  });
  it('requires provider acceptance instead of treating any response as sent', async () => {
    fetchApi.mockResolvedValue({ error: 'Unsupported' });
    await expect(sendCatalogMessage({ api_url: 'https://example.com', api_key: 'key' }, 'zap1', '5511999999999', catalog)).rejects.toThrow();
  });
  it('does not advertise Baileys carousel support for a Cloud API connection', () => {
    expect(supportsWhatsappCatalog('baileys')).toBe(true);
    expect(supportsWhatsappCatalog('wa_cloud')).toBe(false);
    expect(supportsWhatsappCatalog(undefined)).toBe(false);
  });
  it('resolves a catalog reply to its product identifier and rejects ambiguous labels', () => {
    const metadata = { interactivePayload: { kind: 'carousel', ...catalog } };
    expect(resolveEvolutionInteractiveSelectionFromQuotedMessage('Tenho interesse', metadata)).toBe('product-sueter');
    expect(resolveEvolutionInteractiveSelectionFromQuotedMessage('Tenho interesse', { interactivePayload: { ...metadata.interactivePayload, cards: [...catalog.cards, { ...catalog.cards[0], buttons: [{ type: 'reply', displayText: 'Tenho interesse', id: 'other' }] }] } })).toBeUndefined();
  });
});
