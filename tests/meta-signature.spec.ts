import { createHmac } from 'crypto';
import { afterEach, describe, expect, it } from 'vitest';

import { matchMetaSignature } from '@/services/meta/meta-signature';

const originalKeyRing = process.env.META_APP_SECRETS;
const originalSecret = process.env.META_APP_SECRET;
const originalAppId = process.env.META_APP_ID;

afterEach(() => {
  if (originalKeyRing === undefined) delete process.env.META_APP_SECRETS;
  else process.env.META_APP_SECRETS = originalKeyRing;
  if (originalSecret === undefined) delete process.env.META_APP_SECRET;
  else process.env.META_APP_SECRET = originalSecret;
  if (originalAppId === undefined) delete process.env.META_APP_ID;
  else process.env.META_APP_ID = originalAppId;
});

function signature(secret: string, body: string) {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

describe('Meta App Secret selection', () => {
  it('identifies which Meta app signed the body', () => {
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [],
    });
    process.env.META_APP_SECRETS = JSON.stringify({
      'app-old': 'old-secret',
      'app-new': 'new-secret',
    });
    delete process.env.META_APP_SECRET;

    expect(matchMetaSignature(body, signature('new-secret', body))).toEqual({
      configured: true,
      appId: 'app-new',
    });
  });

  it('fails closed when no configured secret matches', () => {
    const body = '{}';
    process.env.META_APP_SECRETS = JSON.stringify({ app: 'correct-secret' });
    expect(matchMetaSignature(body, signature('wrong-secret', body))).toEqual({
      configured: true,
      appId: null,
    });
  });
});
