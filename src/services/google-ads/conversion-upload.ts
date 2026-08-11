import { db } from '@/lib/db';
import { ensureWorkspaceIntegrationsTable } from '@/lib/workspace-integrations';

import {
  getGoogleAccessToken,
  normalizeGoogleAdsCustomerId,
  resolveGoogleAdsCredentials,
  type GoogleAdsCredentials,
} from './credentials';
import { buildUserIdentifiers } from './identifiers';

export const MAX_EXPORT_ATTEMPTS = 6;
const BASE_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;
const DEFAULT_LEASE_MS = 120_000;

type ExportRow = {
  export_id: string;
  workspace_id: string;
  kind: string;
  event_name: string;
  conversion_action_id: string | null;
  conversion_value: string | number | null;
  currency: string | null;
  created_at: string | Date;
  attempt_count: number;
  order_id: string | null;
  adjustment_type: string | null;
  custom_variables: Record<string, unknown> | null;
  google_ads_customer_id: string | null;
  google_ads_login_customer_id: string | null;
  ad_click_id: string;
  message_id: string;
  chat_id: string;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  gads_config: Record<string, unknown> | null;
};

export type ProcessResult = {
  processed: number;
  sent: number;
  failed: number;
  dead: number;
};

/**
 * Erro que nao melhora com nova tentativa (config invalida, dado faltando,
 * rejeicao de schema pelo Google). Vai direto para dead-letter.
 */
class PermanentExportError extends Error {}

function readConfigString(config: Record<string, unknown> | null | undefined, key: string): string {
  return String(config?.[key] ?? '').trim();
}

function backoffMs(attemptCount: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** Math.max(0, attemptCount), MAX_BACKOFF_MS);
}

function formatGoogleAdsDateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new PermanentExportError('Data de conversao invalida para Google Ads.');
  }

  const pad = (input: number) => String(input).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}+00:00`
  );
}

/**
 * A API exige o resource name completo. Aceitamos tambem o ID numerico puro,
 * que e o que aparece na interface do Google Ads e o que o cliente costuma colar.
 */
export function buildConversionActionResourceName(
  customerId: string,
  rawConversionAction: string | null | undefined
): string {
  const raw = String(rawConversionAction ?? '').trim();
  if (!raw) {
    throw new PermanentExportError('Acao de conversao Google Ads nao configurada para este evento.');
  }
  if (raw.startsWith('customers/')) return raw;

  const digits = raw.replace(/\D/g, '');
  if (!digits) {
    throw new PermanentExportError(`Acao de conversao Google Ads invalida: ${raw}`);
  }
  return `customers/${customerId}/conversionActions/${digits}`;
}

export function buildOrderId(row: Pick<ExportRow, 'order_id' | 'event_name' | 'chat_id' | 'message_id'>): string {
  return row.order_id || `${row.event_name}:${row.chat_id}:${row.message_id}`;
}

function buildCustomVariables(customerId: string, raw: Record<string, unknown> | null | undefined) {
  const entries = Object.entries(raw || {});
  if (entries.length === 0) return undefined;

  return entries.map(([key, value]) => {
    const trimmed = String(key).trim();
    const resourceName = trimmed.startsWith('customers/')
      ? trimmed
      : `customers/${customerId}/conversionCustomVariables/${trimmed.replace(/\D/g, '')}`;
    return { conversionCustomVariable: resourceName, value: String(value ?? '') };
  });
}

/**
 * Consent Mode. Só enviamos quando o workspace declara explicitamente o estado
 * do consentimento — inferir "GRANTED" por conta propria seria decidir uma
 * questao de compliance que nao e nossa.
 */
function buildConsent(config: Record<string, unknown> | null | undefined) {
  const adUserData = readConfigString(config, 'consentAdUserData').toUpperCase();
  const adPersonalization = readConfigString(config, 'consentAdPersonalization').toUpperCase();
  const allowed = new Set(['GRANTED', 'DENIED']);

  const consent: Record<string, string> = {};
  if (allowed.has(adUserData)) consent.adUserData = adUserData;
  if (allowed.has(adPersonalization)) consent.adPersonalization = adPersonalization;

  return Object.keys(consent).length > 0 ? consent : undefined;
}

/**
 * Placeholder de ValueTrack que o Google nao substituiu ("{gclid}") nao e um
 * identificador de clique: acontece quando a URL de rastreio e aberta fora de
 * um anuncio. Enviar isso ao Google garante rejeicao, entao tratamos como
 * ausente e deixamos a conversao cair para os identificadores do usuario.
 */
export function sanitizeClickId(value: string | null | undefined): string | null {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;
  if (/^\{[a-z0-9_]+\}$/i.test(trimmed)) return null;
  return trimmed;
}

export function buildClickConversion(row: ExportRow, customerId: string) {
  const gclid = sanitizeClickId(row.gclid);
  const gbraid = sanitizeClickId(row.gbraid);
  const wbraid = sanitizeClickId(row.wbraid);

  const clickId = gclid
    ? { gclid }
    : gbraid
      ? { gbraid }
      : wbraid
        ? { wbraid }
        : null;

  const userIdentifiers = buildUserIdentifiers({
    email: row.contact_email,
    phone: row.contact_phone,
  });

  // Sem click id e sem identificador o Google nao tem como casar a conversao.
  if (!clickId && userIdentifiers.length === 0) {
    throw new PermanentExportError('Conversao sem gclid/gbraid/wbraid e sem identificador de usuario.');
  }

  const rawValue = Number(row.conversion_value ?? 1);
  const conversionValue = Number.isFinite(rawValue) && rawValue >= 0 ? rawValue : 1;
  const customVariables = buildCustomVariables(customerId, row.custom_variables);
  const consent = buildConsent(row.gads_config);

  return {
    conversionAction: buildConversionActionResourceName(customerId, row.conversion_action_id),
    conversionDateTime: formatGoogleAdsDateTime(row.created_at),
    conversionValue,
    currencyCode: row.currency || 'BRL',
    orderId: buildOrderId(row),
    ...(clickId || {}),
    // Enhanced Conversions for Leads: rede de seguranca quando o token se perde.
    ...(userIdentifiers.length > 0 ? { userIdentifiers } : {}),
    ...(customVariables ? { customVariables } : {}),
    ...(consent ? { consent } : {}),
  };
}

export function buildConversionAdjustment(row: ExportRow, customerId: string) {
  const adjustmentType = String(row.adjustment_type || '').toUpperCase();
  if (adjustmentType !== 'RESTATEMENT' && adjustmentType !== 'RETRACTION') {
    throw new PermanentExportError(`Tipo de ajuste invalido: ${row.adjustment_type}`);
  }

  const adjustment: Record<string, unknown> = {
    conversionAction: buildConversionActionResourceName(customerId, row.conversion_action_id),
    orderId: buildOrderId(row),
    adjustmentType,
    adjustmentDateTime: formatGoogleAdsDateTime(row.created_at),
  };

  if (adjustmentType === 'RESTATEMENT') {
    const rawValue = Number(row.conversion_value ?? 0);
    if (!Number.isFinite(rawValue) || rawValue < 0) {
      throw new PermanentExportError('Valor invalido para RESTATEMENT.');
    }
    adjustment.restatementValue = {
      adjustedValue: rawValue,
      currencyCode: row.currency || 'BRL',
    };
  }

  return adjustment;
}

function buildRequestHeaders(
  credentials: GoogleAdsCredentials,
  accessToken: string,
  loginCustomerId: string | null
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': credentials.developerToken,
    'Content-Type': 'application/json',
  };
  if (loginCustomerId) headers['login-customer-id'] = loginCustomerId;
  return headers;
}

/** 4xx (exceto 401/408/429) é erro de dado nosso: nova tentativa nao resolve. */
function isPermanentStatus(status: number): boolean {
  if (status === 401 || status === 408 || status === 429) return false;
  return status >= 400 && status < 500;
}

async function postToGoogleAds(
  endpoint: string,
  headers: Record<string, string>,
  requestPayload: unknown
) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestPayload),
  });

  const responsePayload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail = JSON.stringify(responsePayload).slice(0, 2000);
    const message = `Google Ads respondeu ${response.status}: ${detail}`;
    throw isPermanentStatus(response.status) ? new PermanentExportError(message) : new Error(message);
  }

  // partialFailure sempre indica dado rejeitado, nunca instabilidade.
  if (responsePayload.partialFailureError) {
    throw new PermanentExportError(
      `Google Ads rejeitou a conversao: ${JSON.stringify(responsePayload.partialFailureError).slice(0, 2000)}`
    );
  }

  return { requestPayload, responsePayload };
}

async function uploadExport(row: ExportRow, accessToken: string, credentials: GoogleAdsCredentials) {
  const customerId = normalizeGoogleAdsCustomerId(row.google_ads_customer_id);
  if (!customerId) {
    throw new PermanentExportError('Workspace sem google_ads_customer_id configurado.');
  }

  const loginCustomerId = normalizeGoogleAdsCustomerId(
    row.google_ads_login_customer_id || readConfigString(row.gads_config, 'loginCustomerId')
  );
  const headers = buildRequestHeaders(credentials, accessToken, loginCustomerId);
  const base = `https://googleads.googleapis.com/${credentials.apiVersion}/customers/${customerId}`;

  if (row.kind === 'adjustment') {
    return postToGoogleAds(`${base}:uploadConversionAdjustments`, headers, {
      conversionAdjustments: [buildConversionAdjustment(row, customerId)],
      partialFailure: true,
      validateOnly: false,
    });
  }

  return postToGoogleAds(`${base}:uploadClickConversions`, headers, {
    conversions: [buildClickConversion(row, customerId)],
    partialFailure: true,
    validateOnly: false,
  });
}

async function claimExports(limit: number, leaseMs: number, workerId: string): Promise<string[]> {
  const claimed = await db.query(
    `
    UPDATE conversion_exports
    SET status = 'processing',
        locked_by = $1,
        lease_expires_at = clock_timestamp() + ($2 * interval '1 millisecond'),
        updated_at = timezone('utc', now())
    WHERE id IN (
      SELECT id
      FROM conversion_exports
      WHERE (
          status IN ('pending', 'failed')
          AND next_attempt_at <= clock_timestamp()
          AND attempt_count < $4
        ) OR (
          status = 'processing'
          AND lease_expires_at <= clock_timestamp()
        )
      ORDER BY next_attempt_at
      LIMIT $3
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
    `,
    [workerId, leaseMs, limit, MAX_EXPORT_ATTEMPTS]
  );

  return claimed.rows.map((row) => row.id as string);
}

async function loadClaimedExports(exportIds: string[]): Promise<ExportRow[]> {
  const result = await db.query(
    `
    SELECT
      ce.id AS export_id,
      ce.workspace_id,
      ce.kind,
      ce.event_name,
      ce.conversion_action_id,
      ce.conversion_value,
      ce.currency,
      ce.created_at,
      ce.attempt_count,
      ce.order_id,
      ce.adjustment_type,
      ce.custom_variables,
      w.google_ads_customer_id,
      w.google_ads_login_customer_id,
      ac.id AS ad_click_id,
      aa.message_id,
      aa.chat_id,
      ac.gclid,
      ac.gbraid,
      ac.wbraid,
      ct.email AS contact_email,
      COALESCE(ct.phone, ct.phone_number_jid) AS contact_phone,
      wi.config AS gads_config
    FROM conversion_exports ce
    JOIN ad_attributions aa ON aa.id = ce.ad_attribution_id
    JOIN ad_clicks ac ON ac.id = aa.ad_click_id
    JOIN workspaces w ON w.id = ce.workspace_id::uuid
    LEFT JOIN contacts ct ON ct.id = aa.contact_id::uuid
    LEFT JOIN workspace_integrations wi
      ON wi.workspace_id = ce.workspace_id::uuid
      AND wi.provider = 'gads'
      AND wi.is_active = true
    WHERE ce.id = ANY($1::text[])
    `,
    [exportIds]
  );

  return result.rows as ExportRow[];
}

async function markSent(row: ExportRow, result: { requestPayload: unknown; responsePayload: unknown }) {
  await db.query(
    `
    UPDATE conversion_exports
    SET status = 'sent',
        sent_at = timezone('utc', now()),
        updated_at = timezone('utc', now()),
        locked_by = NULL,
        lease_expires_at = NULL,
        payload = $2::jsonb,
        response = $3::jsonb,
        error_message = NULL
    WHERE id = $1
    `,
    [row.export_id, JSON.stringify(result.requestPayload), JSON.stringify(result.responsePayload)]
  );
}

async function markFailed(row: ExportRow, error: unknown) {
  const permanent = error instanceof PermanentExportError;
  const attemptCount = Number(row.attempt_count || 0) + 1;
  const exhausted = attemptCount >= MAX_EXPORT_ATTEMPTS;
  const dead = permanent || exhausted;
  const message = error instanceof Error ? error.message : String(error);

  await db.query(
    `
    UPDATE conversion_exports
    SET status = $3,
        attempt_count = $4,
        next_attempt_at = timezone('utc', now()) + ($5 * interval '1 millisecond'),
        updated_at = timezone('utc', now()),
        locked_by = NULL,
        lease_expires_at = NULL,
        error_message = $2
    WHERE id = $1
    `,
    [
      row.export_id,
      message.slice(0, 4000),
      dead ? 'dead' : 'failed',
      attemptCount,
      dead ? 0 : backoffMs(attemptCount),
    ]
  );

  return dead;
}

export async function processPendingGoogleAdsConversionExports(
  limit = 25,
  options: { workerId?: string; leaseMs?: number } = {}
): Promise<ProcessResult> {
  await ensureWorkspaceIntegrationsTable();

  const workerId = options.workerId || 'inline';
  const leaseMs = options.leaseMs || DEFAULT_LEASE_MS;

  const exportIds = await claimExports(limit, leaseMs, workerId);
  if (exportIds.length === 0) {
    return { processed: 0, sent: 0, failed: 0, dead: 0 };
  }

  const rows = await loadClaimedExports(exportIds);
  let sent = 0;
  let failed = 0;
  let dead = 0;

  for (const row of rows) {
    try {
      const credentials = resolveGoogleAdsCredentials(row.gads_config, row.workspace_id);
      const accessToken = await getGoogleAccessToken(credentials);
      const result = await uploadExport(row, accessToken, credentials);
      await markSent(row, result);
      sent += 1;
    } catch (error) {
      const isDead = await markFailed(row, error);
      if (isDead) dead += 1;
      else failed += 1;
    }
  }

  return { processed: rows.length, sent, failed, dead };
}
