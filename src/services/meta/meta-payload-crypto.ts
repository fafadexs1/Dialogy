import { decryptWithKey, encryptWithKey } from '@/lib/security/secret-box';

/**
 * The encryption key is intentionally independent from database and Meta
 * credentials so those secrets can be rotated separately.
 */
const ENV_NAME = 'META_PAYLOAD_ENCRYPTION_KEY';

/**
 * Encrypts a plaintext payload using AES-256-GCM.
 * The output format is: iv:ciphertext:tag in hex representation.
 */
export function encryptPayload(plaintext: string): string {
  return encryptWithKey(plaintext, process.env[ENV_NAME], ENV_NAME);
}

/**
 * Decrypts a payload encrypted with encryptPayload using AES-256-GCM.
 */
export function decryptPayload(encryptedText: string): string {
  return decryptWithKey(encryptedText, process.env[ENV_NAME], ENV_NAME);
}
