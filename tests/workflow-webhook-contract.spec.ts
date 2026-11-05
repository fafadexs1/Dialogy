import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseWebhookBody, readWebhookBody, verifyWebhookSignature, webhookPublicHeaders } from '@/services/workflow-runtime/webhook-contract';
describe('webhook ingress contracts', () => {
  it('verifies exact original bytes rather than normalized JSON', () => {
    const raw = Buffer.from('{ "x": 1 }'), signature = createHmac('sha256', 'secret').update(raw).digest('hex');
    expect(verifyWebhookSignature({ raw, signature: `sha256=${signature}`, secret: 'secret' })).toBe(true);
    expect(verifyWebhookSignature({ raw: Buffer.from('{"x":1}'), signature, secret: 'secret' })).toBe(false);
    expect(verifyWebhookSignature({ raw, signature: 'bad', secret: 'secret' })).toBe(false);
  });
  it('rejects stale signed timestamps', () => {
    const now = Date.now(), timestamp = String(Math.floor(now / 1000)), raw = Buffer.from('body');
    const signature = createHmac('sha256', 'secret').update(`${timestamp}.body`).digest('hex');
    expect(verifyWebhookSignature({ raw, signature, secret: 'secret', timestamp, now })).toBe(true);
    expect(verifyWebhookSignature({ raw, signature, secret: 'secret', timestamp, now: now + 301000 })).toBe(false);
  });
  it('limits streaming bodies without trusting content-length', async () => {
    const request = new Request('https://example.com', { method: 'POST', body: '123456789' });
    await expect(readWebhookBody(request, 5)).rejects.toThrow('PAYLOAD_TOO_LARGE');
  });
  it('parses supported payloads and excludes authentication headers', () => {
    expect(parseWebhookBody(Buffer.from('[1,2]'), 'application/json')).toEqual({ value: [1, 2] });
    expect(parseWebhookBody(Buffer.from('a=1&b=2'), 'application/x-www-form-urlencoded')).toEqual({ a: '1', b: '2' });
    expect(webhookPublicHeaders(new Headers({ Authorization: 'secret', Cookie: 'secret', 'X-Nexus-Key': 'secret', 'X-Signature': 'digest', 'X-Event': 'id' }), 'x-signature')).toEqual({ 'x-event': 'id' });
  });
});
