import { createHash } from 'crypto';
import { describe, expect, it } from 'vitest';

import {
  buildConversionActionResourceName,
  buildProductDestinationId,
  buildTransactionId,
  buildDataManagerEventPayload,
  buildClickConversion,
  buildConversionAdjustment,
  buildOrderId,
  formatRfc3339DateTime,
  isPermanentStatus,
  sanitizeClickId,
} from '@/services/google-ads/conversion-upload';
import {
  buildUserData,
  buildUserIdentifiers,
  hashEmailForGoogleAds,
  hashPhoneForGoogleAds,
  normalizeEmailForHashing,
} from '@/services/google-ads/identifiers';
import {
  buildDeterministicTransactionId,
  extractNumericProductDestinationId,
} from '@/services/google-ads/conversion-queue';
import { encryptGoogleAdsSecret, readGoogleAdsSecret } from '@/services/google-ads/credentials';
import { generateAttributionToken, extractAttributionToken } from '@/lib/marketing-attribution';

const CUSTOMER_ID = '1234567890';

function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    export_id: 'exp-1',
    workspace_id: 'ws-1',
    kind: 'conversion',
    event_name: 'sale_won',
    conversion_action_id: '987654321',
    product_destination_id: '987654321',
    conversion_value: 4800,
    currency: 'BRL',
    created_at: '2026-07-20T13:45:09.000Z',
    attempt_count: 0,
    order_id: null,
    transaction_id: null,
    request_id: null,
    processing_status: null,
    adjustment_type: null,
    custom_variables: null,
    google_ads_customer_id: CUSTOMER_ID,
    google_ads_login_customer_id: null,
    ad_click_id: 'click-1',
    message_id: 'msg-1',
    chat_id: 'chat-1',
    gclid: 'GCLID123',
    gbraid: null,
    wbraid: null,
    contact_email: null,
    contact_phone: null,
    gads_config: null,
    ...overrides,
  } as any;
}

describe('Google Data Manager API: productDestinationId e transactionId', () => {
  it('extrai apenas o ID numerico a partir de resource name ou string simples', () => {
    expect(buildProductDestinationId(baseRow({ conversion_action_id: 'customers/123/conversionActions/987654321' }))).toBe(
      '987654321'
    );
    expect(buildProductDestinationId(baseRow({ product_destination_id: '987654321' }))).toBe('987654321');
    expect(extractNumericProductDestinationId('customers/123/conversionActions/555444333')).toBe('555444333');
  });

  it('rejeita acao de conversao ausente ou invalida', () => {
    expect(() => buildProductDestinationId(baseRow({ conversion_action_id: '', product_destination_id: '' }))).toThrow(
      /nao configurada/
    );
    expect(() => buildProductDestinationId(baseRow({ conversion_action_id: 'sem_digitos', product_destination_id: '' }))).toThrow(
      /invalida/
    );
  });

  it('gera transaction_id deterministico padronizado para idempotencia', () => {
    const txId = buildDeterministicTransactionId('velpro', 'sale_won', 'deal-92832');
    expect(txId).toBe('dialogy:velpro:sale_won:deal-92832');

    const rowTxId = buildTransactionId(baseRow({ transaction_id: 'dialogy:ws-1:sale_won:deal-99' }));
    expect(rowTxId).toBe('dialogy:ws-1:sale_won:deal-99');
  });
});

describe('Google Data Manager API: montagem do payload events:ingest', () => {
  it('monta payload no formato correto com destinations (operatingAccount) e events', () => {
    const payload = buildDataManagerEventPayload(baseRow(), CUSTOMER_ID);

    expect(payload.destinations).toEqual([
      {
        operatingAccount: {
          accountId: CUSTOMER_ID,
          accountType: 'GOOGLE_ADS',
        },
        productDestinationId: '987654321',
      },
    ]);

    expect(payload.events).toHaveLength(1);
    const event = payload.events[0];
    expect(event.conversionValue).toBe(4800);
    expect(event.currency).toBe('BRL');
    expect(event.eventTimestamp).toBe('2026-07-20T13:45:09.000Z');
    expect(event.transactionId).toBe('dialogy:ws-1:sale_won:chat-1');
    expect((event as any).adIdentifiers).toEqual({ gclid: 'GCLID123' });
    expect(payload.validateOnly).toBe(false);
  });

  it('inclui userData com hashes SHA-256 de e-mail e telefone quando disponiveis', () => {
    const payload = buildDataManagerEventPayload(
      baseRow({
        contact_email: 'contato.cliente@gmail.com',
        contact_phone: '+5563991234567',
      }),
      CUSTOMER_ID
    );

    const event = payload.events[0] as any;
    expect(event.userData).toBeDefined();
    expect(event.userData.hashedEmail).toBe(hashEmailForGoogleAds('contato.cliente@gmail.com'));
    expect(event.userData.hashedPhoneNumber).toBe(hashPhoneForGoogleAds('+5563991234567'));
  });

  it('suporta identificadores de iOS (gbraid e wbraid)', () => {
    const payloadGbraid = buildDataManagerEventPayload(
      baseRow({ gclid: null, gbraid: 'GBRAID_XYZ' }),
      CUSTOMER_ID
    );
    expect((payloadGbraid.events[0] as any).adIdentifiers).toEqual({ gbraid: 'GBRAID_XYZ' });

    const payloadWbraid = buildDataManagerEventPayload(
      baseRow({ gclid: null, wbraid: 'WBRAID_ABC' }),
      CUSTOMER_ID
    );
    expect((payloadWbraid.events[0] as any).adIdentifiers).toEqual({ wbraid: 'WBRAID_ABC' });
  });

  it('formata data no padrao RFC 3339 / ISO 8601', () => {
    const iso = formatRfc3339DateTime('2026-08-19T09:30:00.000Z');
    expect(iso).toBe('2026-08-19T09:30:00.000Z');
  });

  it('recusa conversao sem gclid/gbraid/wbraid e sem userData', () => {
    expect(() => buildDataManagerEventPayload(baseRow({ gclid: null }), CUSTOMER_ID)).toThrow(
      /sem identificador de usuario/
    );
  });
});

describe('Classificacao de erros da API', () => {
  it('identifica erros permanentes (4xx) vs transitorios (429, 5xx)', () => {
    expect(isPermanentStatus(400)).toBe(true);
    expect(isPermanentStatus(404)).toBe(true);
    expect(isPermanentStatus(422)).toBe(true);

    // Erros transitorios (que devem ter retry)
    expect(isPermanentStatus(401)).toBe(false);
    expect(isPermanentStatus(408)).toBe(false);
    expect(isPermanentStatus(429)).toBe(false);
    expect(isPermanentStatus(500)).toBe(false);
    expect(isPermanentStatus(503)).toBe(false);
  });
});

describe('resource name da acao de conversao (legado)', () => {
  it('aceita o ID numerico que o cliente copia da interface do Google Ads', () => {
    expect(buildConversionActionResourceName(CUSTOMER_ID, '987654321')).toBe(
      'customers/1234567890/conversionActions/987654321'
    );
  });

  it('preserva um resource name ja completo', () => {
    const resourceName = 'customers/999/conversionActions/111';
    expect(buildConversionActionResourceName(CUSTOMER_ID, resourceName)).toBe(resourceName);
  });

  it('rejeita acao de conversao ausente', () => {
    expect(() => buildConversionActionResourceName(CUSTOMER_ID, '')).toThrow(/nao configurada/);
  });
});

describe('montagem da conversao de clique', () => {
  it('usa o valor real do negocio e formata a data em UTC', () => {
    const conversion = buildClickConversion(baseRow(), CUSTOMER_ID) as any;

    expect(conversion.conversionValue).toBe(4800);
    expect(conversion.currencyCode).toBe('BRL');
    expect(conversion.gclid).toBe('GCLID123');
    expect(conversion.conversionDateTime).toBe('2026-07-20 13:45:09+00:00');
    expect(conversion.orderId).toBe('sale_won:chat-1:msg-1');
  });

  it('anexa identificadores com hash quando o contato tem telefone', () => {
    const conversion = buildClickConversion(
      baseRow({ contact_phone: '556391234567@s.whatsapp.net' }),
      CUSTOMER_ID
    ) as any;

    expect(conversion.userIdentifiers).toHaveLength(1);
    expect(conversion.userIdentifiers[0].hashedPhoneNumber).toBe(
      createHash('sha256').update('+556391234567').digest('hex')
    );
  });

  it('sobrevive a perda do gclid quando ha identificador de usuario', () => {
    const conversion = buildClickConversion(
      baseRow({ gclid: null, contact_phone: '63991234567' }),
      CUSTOMER_ID
    ) as any;

    expect(conversion.gclid).toBeUndefined();
    expect(conversion.userIdentifiers).toHaveLength(1);
  });

  it('recusa conversao sem click id e sem identificador', () => {
    expect(() => buildClickConversion(baseRow({ gclid: null }), CUSTOMER_ID)).toThrow(
      /sem identificador de usuario/
    );
  });

  it('ignora placeholder de ValueTrack nao substituido', () => {
    expect(sanitizeClickId('{gclid}')).toBeNull();
    expect(sanitizeClickId('{gbraid}')).toBeNull();
    expect(sanitizeClickId('  ')).toBeNull();
    expect(sanitizeClickId('Cj0KCQjw-real-gclid')).toBe('Cj0KCQjw-real-gclid');

    // URL aberta fora de um anuncio: o Google nunca substituiu o placeholder.
    const conversion = buildClickConversion(
      baseRow({ gclid: '{gclid}', gbraid: '{gbraid}', contact_phone: '63991234567' }),
      CUSTOMER_ID
    ) as any;

    expect(conversion.gclid).toBeUndefined();
    expect(conversion.gbraid).toBeUndefined();
    expect(conversion.userIdentifiers).toHaveLength(1);
  });

  it('recusa conversao quando o unico click id e um placeholder', () => {
    expect(() => buildClickConversion(baseRow({ gclid: '{gclid}' }), CUSTOMER_ID)).toThrow(
      /sem identificador de usuario/
    );
  });

  it('so envia consentimento quando o workspace declara', () => {
    const semDeclaracao = buildClickConversion(baseRow(), CUSTOMER_ID) as any;
    expect(semDeclaracao.consent).toBeUndefined();

    const declarado = buildClickConversion(
      baseRow({ gads_config: { consentAdUserData: 'GRANTED', consentAdPersonalization: 'DENIED' } }),
      CUSTOMER_ID
    ) as any;
    expect(declarado.consent).toEqual({ adUserData: 'GRANTED', adPersonalization: 'DENIED' });
  });

  it('trata valor invalido como 1 em vez de enviar NaN', () => {
    const conversion = buildClickConversion(baseRow({ conversion_value: 'abc' }), CUSTOMER_ID) as any;
    expect(conversion.conversionValue).toBe(1);
  });

  it('usa o order_id explicito quando existe, para o ajuste conseguir referenciar', () => {
    expect(buildOrderId(baseRow({ order_id: 'sale_won:deal-77' }))).toBe('sale_won:deal-77');
  });
});

describe('ajustes de conversao', () => {
  it('monta RESTATEMENT com o novo valor', () => {
    const adjustment = buildConversionAdjustment(
      baseRow({ kind: 'adjustment', adjustment_type: 'RESTATEMENT', conversion_value: 7200, order_id: 'sale_won:deal-77' }),
      CUSTOMER_ID
    ) as any;

    expect(adjustment.adjustmentType).toBe('RESTATEMENT');
    expect(adjustment.orderId).toBe('sale_won:deal-77');
    expect(adjustment.restatementValue).toEqual({ adjustedValue: 7200, currencyCode: 'BRL' });
  });

  it('monta RETRACTION sem valor', () => {
    const adjustment = buildConversionAdjustment(
      baseRow({ kind: 'adjustment', adjustment_type: 'RETRACTION', order_id: 'sale_won:deal-77' }),
      CUSTOMER_ID
    ) as any;

    expect(adjustment.adjustmentType).toBe('RETRACTION');
    expect(adjustment.restatementValue).toBeUndefined();
  });

  it('rejeita tipo de ajuste desconhecido', () => {
    expect(() =>
      buildConversionAdjustment(baseRow({ kind: 'adjustment', adjustment_type: 'ALGO' }), CUSTOMER_ID)
    ).toThrow(/Tipo de ajuste invalido/);
  });
});

describe('identificadores para Enhanced Conversions e Data Manager API', () => {
  it('normaliza e-mail e ignora pontos do Gmail', () => {
    expect(normalizeEmailForHashing('  Fabricio.Soares@Gmail.com ')).toBe('fabriciosoares@gmail.com');
    expect(normalizeEmailForHashing('Contato.Vendas@Empresa.com')).toBe('contato.vendas@empresa.com');
  });

  it('nao gera hash para valores invalidos', () => {
    expect(hashEmailForGoogleAds('nao-e-email')).toBe('');
    expect(hashPhoneForGoogleAds('123')).toBe('');
  });

  it('devolve e-mail e telefone quando ambos existem em buildUserIdentifiers e buildUserData', () => {
    const identifiers = buildUserIdentifiers({ email: 'a@b.com', phone: '63991234567' });
    expect(identifiers).toHaveLength(2);
    expect(identifiers.every((identifier) => identifier.userIdentifierSource === 'FIRST_PARTY')).toBe(true);

    const userData = buildUserData({ email: 'a@b.com', phone: '63991234567' });
    expect(userData?.hashedEmail).toBe(hashEmailForGoogleAds('a@b.com'));
    expect(userData?.hashedPhoneNumber).toBe(hashPhoneForGoogleAds('63991234567'));
  });
});

describe('criptografia do refresh token', () => {
  const originalKey = process.env.GOOGLE_ADS_SECRET_ENCRYPTION_KEY;

  it('faz round-trip e nao guarda o valor em texto puro', () => {
    process.env.GOOGLE_ADS_SECRET_ENCRYPTION_KEY = 'chave-de-teste-com-mais-de-32-caracteres';
    const plaintext = '1//0abcDEFghiJKL-token-do-google';

    const encrypted = encryptGoogleAdsSecret(plaintext);
    expect(encrypted).not.toContain(plaintext);
    expect(readGoogleAdsSecret(encrypted)).toBe(plaintext);

    process.env.GOOGLE_ADS_SECRET_ENCRYPTION_KEY = originalKey;
  });

  it('continua lendo tokens legados gravados antes da criptografia', () => {
    expect(readGoogleAdsSecret('1//0token-legado-em-texto-puro')).toBe('1//0token-legado-em-texto-puro');
  });
});

describe('token de atribuicao', () => {
  it('sobrevive ao toUpperCase da extracao', () => {
    for (let index = 0; index < 200; index += 1) {
      const token = generateAttributionToken();
      expect(token).toBe(token.toUpperCase());
      expect(extractAttributionToken(`Ola, quero atendimento. Codigo: ${token}`)).toBe(token);
    }
  });

  it('nao repete tokens em um lote grande', () => {
    const tokens = new Set(Array.from({ length: 5000 }, () => generateAttributionToken()));
    expect(tokens.size).toBe(5000);
  });
});
