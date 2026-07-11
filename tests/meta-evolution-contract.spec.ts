import { describe, expect, it } from 'vitest';

import { verifyDialogyRequest } from '@/services/meta/dialogy-hmac';
import { buildEvolutionRelayRequest } from '@/services/meta/evolution-relay-contract';
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
      payload: atom.payload,
      timestamp,
      keyId: 'current',
      secret,
    });

    const body = JSON.parse(request.rawBody);
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
});
