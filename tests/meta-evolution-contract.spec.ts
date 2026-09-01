import { afterEach, describe, expect, it, vi } from 'vitest';

import { verifyDialogyRequest } from '@/services/meta/dialogy-hmac';
import { buildEvolutionRelayRequest } from '@/services/meta/evolution-relay-contract';
import { resolveEvolutionRelayInstanceId } from '@/services/meta/evolution-relay-instance';
import { atomizeMetaWhatsappPayload } from '@/services/meta/whatsapp-router';

describe('Dialogy to Evolution Meta contract', () => {
  it('sends an intact atomic Meta envelope inside the authenticated delivery', () => {
    const [atom] = atomizeMetaWhatsappPayload(
      {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba-1',
            time: 123,
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '5511000000000',
                    phone_number_id: 'phone-1',
                  },
                  contacts: [
                    { wa_id: '5511999999999', profile: { name: 'Customer' } },
                  ],
                  messages: [
                    {
                      id: 'message-1',
                      from: '5511999999999',
                      type: 'text',
                      text: { body: 'hello' },
                    },
                  ],
                  future_meta_field: { preserved: true },
                },
              },
            ],
          },
        ],
      },
      'app-1',
    );
    const secret = 'a-contract-secret-with-at-least-32-characters';
    const timestamp = new Date().toISOString();
    process.env.DIALOGY_INTERNAL_HMAC_KEYS = JSON.stringify({
      current: secret,
    });
    const request = buildEvolutionRelayRequest({
      delivery: {
        id: 'delivery-1',
        event_key: atom.eventKey,
        route_version: 1,
        cluster_id: 'cluster-1',
        instance_id: 'instance-1',
        workspace_id: 'workspace-1',
        phone_number_id: atom.phoneNumberId,
        waba_id: atom.wabaId,
      },
      instanceName: 'zap3',
      providerInstanceId: 'evolution-instance-uuid',
      payload: atom.payload,
      timestamp,
      keyId: 'current',
      secret,
    });

    const body = JSON.parse(request.rawBody);
    expect(body.target.instanceId).toBe('evolution-instance-uuid');
    expect(body.payload).toEqual(atom.payload);
    expect(body.payload.entry[0].changes[0].value.future_meta_field).toEqual({
      preserved: true,
    });
    expect(body.payload.entry[0].changes[0].value.messages).toHaveLength(1);
    expect(
      verifyDialogyRequest({
        keyId: 'current',
        timestamp,
        deliveryId: 'delivery-1',
        rawBody: request.rawBody,
        signature: request.headers['X-Dialogy-Signature'],
      }),
    ).toEqual({ ok: true });
  });

  it('does not fall back to the Dialogy UUID when the provider identity is missing', () => {
    expect(() => buildEvolutionRelayRequest({
      delivery: { instance_id: 'dialogy-uuid', phone_number_id: 'phone-1' },
      instanceName: 'zap3',
      providerInstanceId: null,
      payload: {
        object: 'whatsapp_business_account',
        entry: [{ id: 'waba-1', changes: [{ field: 'messages', value: {
          metadata: { phone_number_id: 'phone-1' }, messages: [{ id: 'message-1' }],
        } }] }],
      },
      timestamp: new Date().toISOString(), keyId: 'current', secret: 'test-secret',
    })).toThrow('missing_provider_instance_identity');
  });

  it('preserves account-level events without a phone instance', () => {
    const request = buildEvolutionRelayRequest({
      delivery: { id: 'account-delivery', event_key: 'account-event', route_version: 1,
        cluster_id: 'cluster-1', waba_id: 'waba-1' },
      instanceName: null,
      providerInstanceId: null,
      payload: { object: 'whatsapp_business_account', entry: [{ id: 'waba-1', changes: [
        { field: 'account_update', value: { event: 'ACCOUNT_UPDATE' } },
      ] }] },
      timestamp: new Date().toISOString(), keyId: 'current', secret: 'test-secret',
    });
    expect(JSON.parse(request.rawBody).target).toMatchObject({
      instanceId: null, instanceName: null, phoneNumberId: null, wabaId: 'waba-1',
    });
  });
});

describe('Evolution relay provider identity', () => {
  const input = {
    apiUrl: 'https://evolution.example.test', apiKey: 'test-api-key',
    instanceName: 'zap3', phoneNumberId: 'phone-1', wabaId: 'waba-1',
  };
  const instance = {
    id: 'evolution-instance-uuid', name: 'zap3', integration: 'WHATSAPP-BUSINESS',
    number: 'phone-1', businessId: 'waba-1',
  };
  afterEach(() => vi.unstubAllGlobals());

  it('looks up the provider UUID using authenticated, scoped instance lookup', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json([instance]));
    vi.stubGlobal('fetch', fetchMock);
    await expect(resolveEvolutionRelayInstanceId(input)).resolves.toBe(instance.id);
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://evolution.example.test/instance/fetchInstances?instanceName=zap3');
    expect(options.headers).toEqual({ apikey: 'test-api-key' });
  });

  it.each([
    { number: 'another-phone' }, { businessId: 'another-waba' }, { integration: 'WHATSAPP-BAILEYS' },
  ])('rejects a provider instance belonging to a different route: %j', async (override) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json([{ ...instance, ...override }])));
    await expect(resolveEvolutionRelayInstanceId(input)).rejects.toThrow('evolution_instance_ownership_mismatch');
  });

  it.each([[], [instance, instance], [{ ...instance, name: 'other-instance' }]])(
    'rejects missing or ambiguous provider instances: %j', async (...values) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(values)));
      await expect(resolveEvolutionRelayInstanceId(input)).rejects.toThrow('ambiguous_or_missing_evolution_instance');
    },
  );

  it('propagates lookup failure instead of sending an unverified identifier', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    await expect(resolveEvolutionRelayInstanceId(input)).rejects.toThrow('evolution_instance_lookup_http_503');
  });
});
