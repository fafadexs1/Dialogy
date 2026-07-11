import { createHmac, timingSafeEqual } from 'crypto';

export interface MetaSignatureMatch {
  configured: boolean;
  appId: string | null;
}

export function verifyMetaSignature(
  appSecret: string,
  rawBody: string,
  signatureHeader?: string | null,
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }

  const received = signatureHeader.replace('sha256=', '');
  const expected = createHmac('sha256', appSecret)
    .update(rawBody, 'utf8')
    .digest('hex');

  try {
    return timingSafeEqual(Buffer.from(received), Buffer.from(expected));
  } catch {
    return false;
  }
}

function configuredAppSecrets(): Array<{ appId: string; appSecret: string }> {
  const configured: Array<{ appId: string; appSecret: string }> = [];
  const keyRing = process.env.META_APP_SECRETS;
  if (keyRing) {
    try {
      const parsed = JSON.parse(keyRing) as Record<string, unknown>;
      for (const [appId, appSecret] of Object.entries(parsed)) {
        if (appId && typeof appSecret === 'string' && appSecret)
          configured.push({ appId, appSecret });
      }
    } catch {
      return [];
    }
  }

  if (configured.length === 0 && process.env.META_APP_SECRET) {
    configured.push({
      appId:
        process.env.META_APP_ID ||
        process.env.NEXT_PUBLIC_META_APP_ID ||
        process.env.NEXT_PUBLIC_FACEBOOK_APP_ID ||
        'meta',
      appSecret: process.env.META_APP_SECRET,
    });
  }
  return configured;
}

export function matchMetaSignature(
  rawBody: string,
  signatureHeader?: string | null,
): MetaSignatureMatch {
  const candidates = configuredAppSecrets();
  if (candidates.length === 0) return { configured: false, appId: null };
  for (const candidate of candidates) {
    if (verifyMetaSignature(candidate.appSecret, rawBody, signatureHeader)) {
      return { configured: true, appId: candidate.appId };
    }
  }
  return { configured: true, appId: null };
}
