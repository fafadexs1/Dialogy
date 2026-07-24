import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function createWebchatSessionToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashWebchatSessionToken(token) };
}

export function hashWebchatSessionToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function safeTokenHashEqual(token: string, expectedHash: string) {
  const actual = Buffer.from(hashWebchatSessionToken(token), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

