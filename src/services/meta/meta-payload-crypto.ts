import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * Gets a stable 32-byte key derived from environment variables.
 * The encryption key is intentionally independent from database and Meta
 * credentials so those secrets can be rotated separately.
 */
function getEncryptionKey(): Buffer {
  const secret = process.env.META_PAYLOAD_ENCRYPTION_KEY;
  if (!secret || secret.length < 32) {
    throw new Error('META_PAYLOAD_ENCRYPTION_KEY must contain at least 32 characters.');
  }
  // Stable key derivation using SHA-256 (32 bytes / 256 bits)
  return createHash('sha256').update(secret).digest();
}

/**
 * Encrypts a plaintext payload using AES-256-GCM.
 * The output format is: iv:ciphertext:tag in hex representation.
 */
export function encryptPayload(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12); // 96-bit IV is standard for GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const tag = cipher.getAuthTag().toString('hex');
  const ivHex = iv.toString('hex');

  return `${ivHex}:${encrypted}:${tag}`;
}

/**
 * Decrypts a payload encrypted with encryptPayload using AES-256-GCM.
 */
export function decryptPayload(encryptedText: string): string {
  const key = getEncryptionKey();
  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted payload format. Expected iv:ciphertext:tag.');
  }

  const [ivHex, ciphertextHex, tagHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(ciphertext as any, undefined, 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
