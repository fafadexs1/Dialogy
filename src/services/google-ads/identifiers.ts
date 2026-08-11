import { createHash } from 'crypto';

import { normalizeGoogleAdsEmail, normalizeGoogleAdsPhone } from '@/lib/google-ads-customer-match';

/**
 * Enhanced Conversions for Leads: o Google casa a conversao com o clique pelos
 * dados do proprio usuario, o que recupera a atribuicao quando o token some da
 * mensagem do WhatsApp. Os identificadores nunca saem daqui em texto puro.
 */
export type GoogleAdsUserIdentifier =
  | { userIdentifierSource: 'FIRST_PARTY'; hashedEmail: string }
  | { userIdentifierSource: 'FIRST_PARTY'; hashedPhoneNumber: string };

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * O Google exige minusculas e sem espacos. Para Gmail os pontos do usuario sao
 * ignorados pelo provedor, entao normalizamos antes do hash para nao perder match.
 */
export function normalizeEmailForHashing(value?: string | null): string {
  const email = normalizeGoogleAdsEmail(value);
  if (!email) return '';

  const [localPart, domain] = email.split('@');
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    return `${localPart.replace(/\./g, '')}@${domain}`;
  }
  return email;
}

export function hashEmailForGoogleAds(value?: string | null): string {
  const normalized = normalizeEmailForHashing(value);
  return normalized ? sha256Hex(normalized) : '';
}

/** Telefone precisa estar em E.164 (+5563...) antes do hash. */
export function hashPhoneForGoogleAds(value?: string | null): string {
  const normalized = normalizeGoogleAdsPhone(value);
  return normalized ? sha256Hex(normalized) : '';
}

export function buildUserIdentifiers(input: {
  email?: string | null;
  phone?: string | null;
}): GoogleAdsUserIdentifier[] {
  const identifiers: GoogleAdsUserIdentifier[] = [];

  const hashedEmail = hashEmailForGoogleAds(input.email);
  if (hashedEmail) identifiers.push({ userIdentifierSource: 'FIRST_PARTY', hashedEmail });

  const hashedPhoneNumber = hashPhoneForGoogleAds(input.phone);
  if (hashedPhoneNumber) identifiers.push({ userIdentifierSource: 'FIRST_PARTY', hashedPhoneNumber });

  return identifiers;
}
