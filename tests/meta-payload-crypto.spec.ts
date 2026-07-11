import { beforeEach, describe, expect, it } from 'vitest';
import { encryptPayload, decryptPayload } from '@/services/meta/meta-payload-crypto';

describe('Meta Payload Crypto Helper', () => {
  beforeEach(() => {
    process.env.META_PAYLOAD_ENCRYPTION_KEY = 'test-only-encryption-key-with-at-least-32-characters';
  });
  it('correctly encrypts and decrypts a plain text payload', () => {
    const originalText = 'Hello World! This is a secret message.';
    const encrypted = encryptPayload(originalText);
    expect(encrypted).toContain(':');
    
    const parts = encrypted.split(':');
    expect(parts.length).toBe(3); // iv, ciphertext, tag
    
    const decrypted = decryptPayload(encrypted);
    expect(decrypted).toBe(originalText);
  });

  it('correctly encrypts and decrypts a JSON object payload', () => {
    const originalPayload = {
      id: '123',
      message: 'Hello!',
      nested: {
        value: true
      }
    };
    const jsonStr = JSON.stringify(originalPayload);
    const encrypted = encryptPayload(jsonStr);
    const decrypted = decryptPayload(encrypted);
    expect(JSON.parse(decrypted)).toEqual(originalPayload);
  });

  it('throws an error for invalid encrypted payloads', () => {
    expect(() => decryptPayload('invalid-format')).toThrow();
    expect(() => decryptPayload('a:b')).toThrow();
  });
});
