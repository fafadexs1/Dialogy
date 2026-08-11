import { randomBytes } from 'crypto';

export const ATTRIBUTION_TOKEN_PREFIX = 'DGY';
export const WHATSAPP_MESSAGE_EVENT = 'whatsapp_message_received';
export const LEAD_QUALIFIED_EVENT = 'lead_qualified';
export const SALE_WON_EVENT = 'sale_won';

const TOKEN_PATTERN = /\bDGY-[A-Z0-9_-]{5,16}\b/i;

export type AdClickParams = {
  source: string;
  medium?: string;
  campaign?: string;
  campaignId?: string;
  adGroupId?: string;
  creativeId?: string;
  keyword?: string;
  device?: string;
  matchType?: string;
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  rawParams: Record<string, string>;
};

function firstNonEmptyParam(params: URLSearchParams, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = params.get(key);
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (/^\{[a-z0-9_]+\}$/i.test(trimmed)) continue;
    if (trimmed) return trimmed.slice(0, 500);
  }
  return undefined;
}

export function collectAdClickParams(searchParams: URLSearchParams): AdClickParams {
  const rawParams: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    if (!key) return;
    rawParams[key] = value;
  });

  return {
    source: firstNonEmptyParam(searchParams, 'utm_source', 'source') || 'google',
    medium: firstNonEmptyParam(searchParams, 'utm_medium', 'medium'),
    campaign: firstNonEmptyParam(searchParams, 'utm_campaign', 'campaign'),
    campaignId: firstNonEmptyParam(searchParams, 'campaignid', 'campaign_id', 'utm_id'),
    adGroupId: firstNonEmptyParam(searchParams, 'adgroupid', 'ad_group_id'),
    creativeId: firstNonEmptyParam(searchParams, 'creative', 'creative_id'),
    keyword: firstNonEmptyParam(searchParams, 'keyword', 'utm_term'),
    device: firstNonEmptyParam(searchParams, 'device'),
    matchType: firstNonEmptyParam(searchParams, 'matchtype', 'match_type'),
    gclid: firstNonEmptyParam(searchParams, 'gclid'),
    gbraid: firstNonEmptyParam(searchParams, 'gbraid'),
    wbraid: firstNonEmptyParam(searchParams, 'wbraid'),
    rawParams,
  };
}

/**
 * Alfabeto de 32 simbolos sem I/L/O/U: o token e lido e digitado por pessoas, e
 * precisa sobreviver ao toUpperCase() da extracao. Base64 nao servia — letras
 * maiusculas e minusculas colapsavam no mesmo token e podiam colidir no indice
 * unico, derrubando o redirect do anuncio.
 */
const TOKEN_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ0123456789';
const TOKEN_LENGTH = 8;

export function generateAttributionToken(): string {
  const bytes = randomBytes(TOKEN_LENGTH);
  let token = '';
  for (let index = 0; index < TOKEN_LENGTH; index += 1) {
    // 256 e multiplo de 32, entao o modulo continua uniforme.
    token += TOKEN_ALPHABET[bytes[index] % TOKEN_ALPHABET.length];
  }
  return `${ATTRIBUTION_TOKEN_PREFIX}-${token}`;
}

export function extractAttributionToken(content: string | null | undefined): string | null {
  if (!content) return null;
  const match = content.match(TOKEN_PATTERN);
  return match?.[0]?.toUpperCase() ?? null;
}

export function normalizeWhatsappDestinationPhone(value: string | null | undefined): string | null {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  return digits;
}

export function buildWhatsappRedirectUrl(params: {
  phone: string;
  token: string;
  message?: string | null;
}): string {
  const message = params.message?.trim() || `Ola, quero atendimento. Codigo: ${params.token}`;
  const url = new URL(`https://wa.me/${params.phone}`);
  url.searchParams.set('text', message.includes(params.token) ? message : `${message} Codigo: ${params.token}`);
  return url.toString();
}

export function buildAttributionMetadata(row: {
  ad_click_id: string;
  attribution_id?: string;
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  campaign_id?: string | null;
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  token?: string | null;
  match_type: string;
  confidence: string;
}) {
  return {
    attribution: {
      adClickId: row.ad_click_id,
      attributionId: row.attribution_id,
      source: row.source || 'google',
      medium: row.medium || undefined,
      campaign: row.campaign || undefined,
      campaignId: row.campaign_id || undefined,
      gclid: row.gclid || undefined,
      gbraid: row.gbraid || undefined,
      wbraid: row.wbraid || undefined,
      token: row.token || undefined,
      matchType: row.match_type,
      confidence: row.confidence,
    },
  };
}
