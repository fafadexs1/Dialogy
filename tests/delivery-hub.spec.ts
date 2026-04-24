import { describe, expect, it } from 'vitest';

import {
  buildDeliveryHubPublicPath,
  buildDeliveryHubShareUrl,
  createEmptyDeliveryHubConfig,
  normalizeDeliveryHubConfig,
  normalizeDeliveryHubSlug,
} from '@/lib/delivery-hub';

describe('delivery hub helpers', () => {
  it('normalizes public slug removing accents and unsupported characters', () => {
    expect(normalizeDeliveryHubSlug('  Sabor & Acaí Premium 2026  ')).toBe('sabor-acai-premium-2026');
  });

  it('creates a share url without duplicate slashes', () => {
    expect(buildDeliveryHubShareUrl('https://dialogy.com.br/', 'acai-center')).toBe(
      'https://dialogy.com.br/delivery/acai-center'
    );
  });

  it('normalizes delivery hub config filtering empty nested entries', () => {
    const config = normalizeDeliveryHubConfig({
      title: 'Shopping Food Hall',
      subtitle: 'Escolha seu pedido',
      slug: ' food hall ',
      isPublished: true,
      businesses: [
        {
          name: 'Burger Club',
          menuSections: [
            {
              title: 'Combos',
              items: [
                { name: 'Combo Smash', description: 'Batata e refri', price: '34,90' },
                { name: '   ', description: '   ', price: '' },
              ],
            },
            {
              title: '   ',
              items: [],
            },
          ],
        },
        {
          name: '   ',
          menuSections: [],
        },
      ],
    });

    expect(config).toEqual({
      title: 'Shopping Food Hall',
      subtitle: 'Escolha seu pedido',
      slug: 'food-hall',
      isPublished: true,
      businesses: [
        {
          id: 'business-1',
          name: 'Burger Club',
          category: '',
          description: '',
          coverUrl: '',
          deliveryTime: '',
          deliveryFee: '',
          minimumOrder: '',
          orderUrl: '',
          menuSections: [
            {
              id: 'section-1-1',
              title: 'Combos',
              description: '',
              items: [
                {
                  id: 'item-1-1-1',
                  name: 'Combo Smash',
                  description: 'Batata e refri',
                  price: '34,90',
                  imageUrl: '',
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it('exposes a stable default config and public path', () => {
    expect(createEmptyDeliveryHubConfig().title).toBe('Vitrine Delivery');
    expect(buildDeliveryHubPublicPath('abc-123')).toBe('/delivery/abc-123');
  });
});
