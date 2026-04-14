import { normalizeWhatsappJid } from '@/lib/whatsapp/contact-identity';

export function shouldKeepCurrentWhatsappJidOnUpdate(
  currentJid?: string | null,
  nextJid?: string | null
): boolean {
  const normalizedCurrent = normalizeWhatsappJid(currentJid);
  const normalizedNext = normalizeWhatsappJid(nextJid);

  if (!normalizedCurrent || !normalizedNext) {
    return false;
  }

  return normalizedCurrent === normalizedNext;
}

export function resolveWhatsappJidForContactSave(params: {
  currentJid?: string | null;
  nextJid?: string | null;
  hasEquivalentConflict?: boolean;
}): string | null {
  const { currentJid, nextJid, hasEquivalentConflict = false } = params;
  const normalizedNext = normalizeWhatsappJid(nextJid);

  if (!normalizedNext) {
    return null;
  }

  const persistedCurrentJid = String(currentJid ?? '').trim();
  if (
    hasEquivalentConflict &&
    persistedCurrentJid &&
    shouldKeepCurrentWhatsappJidOnUpdate(persistedCurrentJid, normalizedNext)
  ) {
    return persistedCurrentJid;
  }

  return normalizedNext;
}
