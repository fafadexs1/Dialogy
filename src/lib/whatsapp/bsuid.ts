/** Meta BSUIDs are case-sensitive opaque identifiers, never telephone numbers. */
export function isWhatsappBsuid(value: unknown): boolean {
  return typeof value === 'string' && /^[A-Z]{2}\.(?:ENT\.)?[A-Za-z0-9]{1,128}$/.test(value);
}

export function parseScopedWhatsappBsuid(value: unknown): { instanceName: string; userId: string } | null {
  if (typeof value !== 'string') return null;
  const match = /^bsuid:([^:]+):(.+)$/.exec(value);
  if (!match || !isWhatsappBsuid(match[2])) return null;
  try {
    const instanceName = decodeURIComponent(match[1]);
    if (!instanceName || encodeURIComponent(instanceName) !== match[1]) return null;
    return { instanceName, userId: match[2] };
  } catch { return null; }
}

export function isWhatsappBsuidIdentity(value: unknown): boolean {
  return isWhatsappBsuid(value) || parseScopedWhatsappBsuid(value) !== null;
}

/** A raw provider BSUID is scoped using the authenticated webhook's instance. */
export function scopeWhatsappBsuid(value: string, instanceName: string): string {
  const scoped = parseScopedWhatsappBsuid(value);
  if (scoped) {
    if (scoped.instanceName !== instanceName) throw new Error('BSUID pertence a outra instancia de WhatsApp.');
    return value;
  }
  if (!isWhatsappBsuid(value)) {
    if (value.startsWith('bsuid:') || /^[A-Za-z]{2}\./.test(value)) throw new Error('Identidade BSUID invalida.');
    return value;
  }
  if (!instanceName) throw new Error('Instancia obrigatoria para identificar o BSUID.');
  return `bsuid:${encodeURIComponent(instanceName)}:${value}`;
}

/** Unwrap only at the provider boundary, after verifying the selected instance. */
export function unwrapWhatsappBsuid(value: string, instanceName: string): string {
  const scoped = parseScopedWhatsappBsuid(value);
  if (scoped) {
    if (scoped.instanceName !== instanceName) throw new Error('BSUID pertence a outra instancia de WhatsApp.');
    return scoped.userId;
  }
  if (value.startsWith('bsuid:')) throw new Error('Identidade BSUID invalida.');
  return value;
}

export function preserveWhatsappRecipient(value: string): string {
  if (isWhatsappBsuidIdentity(value)) return value;
  if (value.startsWith('bsuid:') || /^[A-Za-z]{2}\./.test(value)) throw new Error('Identidade BSUID invalida.');
  return value.replace(/@.*$/, '').replace(/\D/g, '');
}
