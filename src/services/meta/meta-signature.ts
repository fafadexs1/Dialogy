import { createHmac, timingSafeEqual } from 'crypto';

export function verifyMetaSignature(appSecret: string, rawBody: string, signatureHeader?: string | null): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }

  const received = signatureHeader.replace('sha256=', '');
  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');

  try {
    return timingSafeEqual(Buffer.from(received), Buffer.from(expected));
  } catch {
    return false;
  }
}
