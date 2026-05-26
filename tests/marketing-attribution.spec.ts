import { describe, expect, it } from 'vitest';

import {
  buildWhatsappRedirectUrl,
  collectAdClickParams,
  extractAttributionToken,
  normalizeWhatsappDestinationPhone,
} from '@/lib/marketing-attribution';

describe('marketing attribution helpers', () => {
  it('collects Google Ads click identifiers and URL params', () => {
    const params = new URLSearchParams({
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'pmax',
      campaignid: '123',
      adgroupid: '456',
      creative: '789',
      keyword: 'fibra',
      device: 'm',
      matchtype: 'b',
      gclid: 'GCLID123',
      gbraid: '{gbraid}',
    });

    expect(collectAdClickParams(params)).toMatchObject({
      source: 'google',
      medium: 'cpc',
      campaign: 'pmax',
      campaignId: '123',
      adGroupId: '456',
      creativeId: '789',
      keyword: 'fibra',
      device: 'm',
      matchType: 'b',
      gclid: 'GCLID123',
      gbraid: undefined,
      rawParams: {
        campaignid: '123',
        gclid: 'GCLID123',
      },
    });
  });

  it('extracts attribution tokens from inbound WhatsApp text', () => {
    expect(extractAttributionToken('Ola, quero atendimento. Codigo: dgy-a8k92')).toBe('DGY-A8K92');
    expect(extractAttributionToken('Codigo: dgy-qghi-ho')).toBe('DGY-QGHI-HO');
    expect(extractAttributionToken('Codigo: dgy-zk_0xm8')).toBe('DGY-ZK_0XM8');
    expect(extractAttributionToken('Sem codigo')).toBeNull();
  });

  it('normalizes phone numbers and builds wa.me redirect URLs', () => {
    const phone = normalizeWhatsappDestinationPhone('+55 (63) 3810-4040');
    expect(phone).toBe('556338104040');

    const redirect = buildWhatsappRedirectUrl({
      phone: phone!,
      token: 'DGY-A8K92',
      message: 'Ola, quero atendimento.',
    });

    const url = new URL(redirect);
    expect(url.origin + url.pathname).toBe('https://wa.me/556338104040');
    expect(url.searchParams.get('text')).toContain('DGY-A8K92');
  });
});
