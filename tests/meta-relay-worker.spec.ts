import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { POST } from '@/app/api/internal/webhooks/meta/evolution-result/route';
import { db } from '@/lib/db';
import { signDialogyRequest } from '@/services/meta/dialogy-hmac';

vi.mock('@/lib/db', () => ({ db: { query: vi.fn() } }));

const keyId = 'current';
const secret = 'a-secure-test-secret-with-more-than-32-characters';

function request(body: Record<string, unknown>, overrides: Record<string, string> = {}) {
  const rawBody = JSON.stringify(body);
  const timestamp = new Date().toISOString();
  const deliveryId = String(body.deliveryId || 'delivery-1');
  return new NextRequest('http://localhost/api/internal/webhooks/meta/evolution-result', {
    method: 'POST',
    body: rawBody,
    headers: {
      'x-dialogy-key-id': keyId,
      'x-dialogy-timestamp': timestamp,
      'x-dialogy-delivery-id': deliveryId,
      'x-dialogy-signature': signDialogyRequest(secret, timestamp, deliveryId, rawBody),
      ...overrides,
    },
  });
}

describe('Evolution result callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DIALOGY_INTERNAL_HMAC_KEYS = JSON.stringify({ [keyId]: secret });
  });

  it('rejects expired timestamps', async () => {
    const response = await POST(request(
      { deliveryId: 'delivery-1', status: 'processed' },
      { 'x-dialogy-timestamp': new Date(Date.now() - 10 * 60_000).toISOString() },
    ));
    expect(response.status).toBe(401);
  });

  it('rejects unknown key ids', async () => {
    const response = await POST(request(
      { deliveryId: 'delivery-1', status: 'processed' },
      { 'x-dialogy-key-id': 'unknown' },
    ));
    expect(response.status).toBe(403);
  });

  it('updates a processed delivery idempotently', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'delivery-1' }] } as any);
    const response = await POST(request({ deliveryId: 'delivery-1', status: 'processed' }));
    expect(response.status).toBe(200);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("status = CASE"), ['delivery-1', 'processed', null]);
  });

  it('returns a duplicate success for an already processed delivery', async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rowCount: 0, rows: [] } as any)
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ status: 'processed' }] } as any);
    const response = await POST(request({ deliveryId: 'delivery-1', status: 'processed' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ duplicate: true });
  });
});
