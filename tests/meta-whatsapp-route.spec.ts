import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { GET, POST } from '@/app/api/webhooks/meta/whatsapp/route';
import { recordMetaIngressLog } from '@/services/meta/meta-ingress-log';
import { matchMetaSignature } from '@/services/meta/meta-signature';
import {
  atomizeMetaWhatsappPayload,
  persistMetaWhatsappEnvelope,
} from '@/services/meta/whatsapp-router';

vi.mock('@/services/meta/meta-signature', () => ({
  matchMetaSignature: vi.fn(),
}));
vi.mock('@/services/meta/meta-ingress-log', () => ({
  recordMetaIngressLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/services/meta/whatsapp-router', async (original) => {
  const actual =
    await original<typeof import('@/services/meta/whatsapp-router')>();
  return { ...actual, persistMetaWhatsappEnvelope: vi.fn() };
});
vi.mock('@/lib/observability/logger', () => ({ logAction: vi.fn() }));
vi.mock('@/lib/observability/metrics', () => ({
  recordWebhookMetrics: vi.fn(),
}));

describe('Meta WhatsApp ingress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.META_WHATSAPP_VERIFY_TOKEN = 'verify-token';
    delete process.env.META_VERIFY_TOKEN;
    process.env.META_APP_SECRET = 'app-secret';
    vi.mocked(matchMetaSignature).mockReturnValue({
      configured: true,
      appId: 'app-1',
    });
    vi.mocked(persistMetaWhatsappEnvelope).mockResolvedValue({
      duplicate: false,
      atoms: 1,
      quarantined: 0,
    });
  });

  it('validates the Meta challenge', async () => {
    const response = await GET(
      new NextRequest(
        'http://localhost/api/webhooks/meta/whatsapp?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=42',
      ),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('42');
  });

  it('fails closed when the verification token is not configured', async () => {
    delete process.env.META_WHATSAPP_VERIFY_TOKEN;
    delete process.env.META_VERIFY_TOKEN;
    const response = await GET(
      new NextRequest(
        'http://localhost/api/webhooks/meta/whatsapp?hub.mode=subscribe&hub.verify_token=x&hub.challenge=42',
      ),
    );
    expect(response.status).toBe(503);
  });

  it('accepts the existing META_VERIFY_TOKEN during migration', async () => {
    delete process.env.META_WHATSAPP_VERIFY_TOKEN;
    process.env.META_VERIFY_TOKEN = 'legacy-verify-token';
    const response = await GET(
      new NextRequest(
        'http://localhost/api/webhooks/meta/whatsapp?hub.mode=subscribe&hub.verify_token=legacy-verify-token&hub.challenge=84',
      ),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('84');
  });

  it('never persists an invalidly signed body', async () => {
    vi.mocked(matchMetaSignature).mockReturnValue({
      configured: true,
      appId: null,
    });
    const response = await POST(
      new NextRequest('http://localhost/api/webhooks/meta/whatsapp', {
        method: 'POST',
        body: JSON.stringify({
          object: 'whatsapp_business_account',
          entry: [],
        }),
      }),
    );
    expect(response.status).toBe(401);
    expect(persistMetaWhatsappEnvelope).not.toHaveBeenCalled();
    expect(recordMetaIngressLog).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'invalid_signature', statusCode: 401 }),
    );
  });

  it('fails closed when the App Secret is absent', async () => {
    vi.mocked(matchMetaSignature).mockReturnValue({
      configured: false,
      appId: null,
    });
    const response = await POST(
      new NextRequest('http://localhost/api/webhooks/meta/whatsapp', {
        method: 'POST',
        body: JSON.stringify({
          object: 'whatsapp_business_account',
          entry: [],
        }),
      }),
    );
    expect(response.status).toBe(503);
    expect(persistMetaWhatsappEnvelope).not.toHaveBeenCalled();
  });

  it('acknowledges only after the durable persistence service succeeds', async () => {
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [],
    });
    const response = await POST(
      new NextRequest('http://localhost/api/webhooks/meta/whatsapp', {
        method: 'POST',
        body,
        headers: { 'x-hub-signature-256': 'sha256=valid' },
      }),
    );
    expect(response.status).toBe(200);
    expect(persistMetaWhatsappEnvelope).toHaveBeenCalledWith(
      body,
      JSON.parse(body),
      {
        appId: 'app-1',
        shadow: false,
        sourceClusterId: null,
      },
    );
    expect(recordMetaIngressLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'accepted',
        statusCode: 200,
        appId: 'app-1',
        atoms: 1,
      }),
    );
  });

  it('returns 503 so Meta retries when the transaction fails', async () => {
    vi.mocked(persistMetaWhatsappEnvelope).mockRejectedValue(
      new Error('database down'),
    );
    const response = await POST(
      new NextRequest('http://localhost/api/webhooks/meta/whatsapp', {
        method: 'POST',
        body: JSON.stringify({
          object: 'whatsapp_business_account',
          entry: [],
        }),
      }),
    );
    expect(response.status).toBe(503);
  });
});

describe('Meta atomization', () => {
  it('creates one message atom and one status atom and keeps only the matching contact', () => {
    const atoms = atomizeMetaWhatsappPayload(
      {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba-1',
            time: 123,
            changes: [
              {
                field: 'messages',
                transport_hint: 'preserve-me',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { phone_number_id: 'phone-1' },
                  extra_meta_field: { future: true },
                  contacts: [{ wa_id: 'customer-a' }, { wa_id: 'customer-b' }],
                  messages: [
                    {
                      id: 'message-1',
                      from: 'customer-b',
                      text: { body: 'hello' },
                    },
                  ],
                  statuses: [
                    { id: 'message-2', status: 'delivered', timestamp: '100' },
                  ],
                },
              },
            ],
          },
        ],
      },
      'app-1',
    );

    expect(atoms).toHaveLength(2);
    expect(atoms[0].eventKey).toBe('app-1:phone-1:message-1');
    const atomicEntry = (
      atoms[0].payload.entry as Array<Record<string, any>>
    )[0];
    const atomicChange = (atomicEntry.changes as Array<Record<string, any>>)[0];
    const value = atomicChange.value;
    expect(atomicEntry.time).toBe(123);
    expect(atomicChange.transport_hint).toBe('preserve-me');
    expect(value.messaging_product).toBe('whatsapp');
    expect(value.extra_meta_field).toEqual({ future: true });
    expect(value.contacts).toEqual([{ wa_id: 'customer-b' }]);
    expect(value.statuses).toBeUndefined();
    expect(atoms[1].eventKey).toBe('app-1:phone-1:message-2:delivered:100');
    const statusValue = (
      (atoms[1].payload.entry as Array<Record<string, unknown>>)[0]
        .changes as Array<Record<string, any>>
    )[0].value;
    expect(statusValue.extra_meta_field).toEqual({ future: true });
    expect(statusValue.messages).toBeUndefined();
    expect(statusValue.contacts).toBeUndefined();
  });

  it('splits entries from different clusters into independent atoms', () => {
    const atoms = atomizeMetaWhatsappPayload(
      {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba-a',
            changes: [
              {
                field: 'messages',
                value: {
                  metadata: { phone_number_id: 'phone-a' },
                  messages: [{ id: 'a', from: '1' }],
                },
              },
            ],
          },
          {
            id: 'waba-b',
            changes: [
              {
                field: 'messages',
                value: {
                  metadata: { phone_number_id: 'phone-b' },
                  messages: [{ id: 'b', from: '2' }],
                },
              },
            ],
          },
        ],
      },
      'app',
    );
    expect(atoms.map((atom) => atom.phoneNumberId)).toEqual([
      'phone-a',
      'phone-b',
    ]);
  });
});
