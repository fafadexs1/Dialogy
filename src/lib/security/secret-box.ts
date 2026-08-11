import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * AES-256-GCM para segredos de integracao guardados no banco.
 * Formato de saida: iv:ciphertext:tag, tudo em hex.
 */

const ENCRYPTED_PATTERN = /^[0-9a-f]{24}:[0-9a-f]*:[0-9a-f]{32}$/i;

function deriveKey(secret: string | undefined, envName: string): Buffer {
  if (!secret || secret.length < 32) {
    throw new Error(`${envName} must contain at least 32 characters.`);
  }
  return createHash('sha256').update(secret).digest();
}

export function encryptWithKey(plaintext: string, secret: string | undefined, envName: string): string {
  const key = deriveKey(secret, envName);
  const iv = randomBytes(12); // 96-bit IV is standard for GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  return `${iv.toString('hex')}:${encrypted}:${cipher.getAuthTag().toString('hex')}`;
}

export function decryptWithKey(encryptedText: string, secret: string | undefined, envName: string): string {
  const key = deriveKey(secret, envName);
  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted payload format. Expected iv:ciphertext:tag.');
  }

  const [ivHex, ciphertextHex, tagHex] = parts;
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));

  let decrypted = decipher.update(Buffer.from(ciphertextHex, 'hex') as any, undefined, 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Distingue um segredo ja cifrado de um valor legado em texto puro, para que a
 * leitura funcione durante a transicao sem exigir backfill.
 */
export function looksEncrypted(value: string | null | undefined): boolean {
  return ENCRYPTED_PATTERN.test(String(value ?? '').trim());
}
