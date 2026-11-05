import { createHmac, timingSafeEqual } from 'node:crypto';

export async function readWebhookBody(request: Request, maxBytes = 1_000_000): Promise<Buffer> {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > maxBytes) throw new Error('PAYLOAD_TOO_LARGE');
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > maxBytes) { await reader.cancel(); throw new Error('PAYLOAD_TOO_LARGE'); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
export function verifyWebhookSignature(input: { raw: Buffer; secret: string; signature: string; timestamp?: string; now?: number }): boolean {
  if (input.timestamp !== undefined) {
    const seconds = Number(input.timestamp);
    if (!Number.isFinite(seconds) || Math.abs((input.now ?? Date.now()) / 1000 - seconds) > 300) return false;
  }
  const value = input.signature.replace(/^sha256=/, '');
  if (!/^[a-f\d]{64}$/i.test(value)) return false;
  const expected = createHmac('sha256', input.secret).update(input.timestamp === undefined ? input.raw : Buffer.concat([Buffer.from(`${input.timestamp}.`), input.raw])).digest();
  return timingSafeEqual(expected, Buffer.from(value, 'hex'));
}
export function webhookPublicHeaders(headers: Headers, signatureHeader?: string): Record<string, string> {
  return Object.fromEntries([...headers.entries()].filter(([name]) => !['authorization', 'cookie', 'set-cookie', 'x-nexus-key', signatureHeader?.toLowerCase()].includes(name.toLowerCase())));
}
export function parseWebhookBody(raw: Buffer, contentType: string): Record<string, unknown> {
  const text = raw.toString('utf8');
  if (!text) return {};
  if (contentType.includes('json')) { const parsed: unknown = JSON.parse(text); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : { value: parsed }; }
  if (contentType.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(text));
  return { text };
}
