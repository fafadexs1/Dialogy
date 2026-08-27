import { db } from '@/lib/db';
import { ensureWorkspaceIntegrationsTable } from '@/lib/workspace-integrations';

import {
  getGoogleAccessToken,
  normalizeGoogleAdsCustomerId,
  resolveGoogleAdsCredentials,
  type GoogleAdsCredentials,
} from './credentials';
import { buildUserData, buildUserIdentifiers } from './identifiers';

export const MAX_EXPORT_ATTEMPTS = 6;
const BASE_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;
const DEFAULT_LEASE_MS = 120_000;
export const DATA_MANAGER_API_BASE = 'https://datamanager.googleapis.com/v1';

export type ExportRow = {
  export_id: string;
  workspace_id: string;
  kind: string;
  event_name: string;
  conversion_action_id: string | null;
  product_destination_id: string | null;
  conversion_value: string | number | null;
  currency: string | null;
  created_at: string | Date;
  attempt_count: number;
  order_id: string | null;
  transaction_id: string | null;
  request_id: string | null;
  processing_status: string | null;
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
  responsePayload?: unknown;
};

export type ProcessResult = {
  processed: number;
  submitted: number;
  sent: number;
  confirmed: number;
  failed: number;
  dead: number;
};

/**
 * Erro que nao melhora com nova tentativa (config invalida, dado faltando,
 * rejeicao de schema pelo Google, conta errada). Vai direto para dead-letter.
 */
export class PermanentExportError extends Error {}

function readConfigString(config: Record<string, unknown> | null | undefined, key: string): string {
  return String(config?.[key] ?? '').trim();
}

function backoffMs(attemptCount: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** Math.max(0, attemptCount), MAX_BACKOFF_MS);
}

/** Formata data no padrao RFC 3339 / ISO 8601 exigido pela Data Manager API. */
export function formatRfc3339DateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new PermanentExportError('Data de conversao invalida para Google Data Manager API.');
  }
  return date.toISOString();
}

/** Alias mantido para compatibilidade com testes legados. */
export function formatGoogleAdsDateTime(value: string | Date): string {
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
 * A Data Manager API exige apenas o ID numerico da acao de conversao (productDestinationId).
 * Aceitamos tambem o resource name completo legado (customers/.../conversionActions/123)
 * e extraimos somente os digitos.
 */
export function buildProductDestinationId(
  row: Pick<ExportRow, 'product_destination_id' | 'conversion_action_id'>
): string {
  const raw = String(row.product_destination_id || row.conversion_action_id || '').trim();
  if (!raw) {
    throw new PermanentExportError('Acao de conversao Google Ads nao configurada para este evento.');
  }

  let target = raw;
  if (target.includes('conversionActions/')) {
    target = target.split('conversionActions/')[1] || target;
  } else if (target.includes('/')) {
    target = target.split('/').pop() || target;
  }

  const digits = target.replace(/\D/g, '');
  if (!digits) {
    throw new PermanentExportError(`Acao de conversao Google Ads invalida: ${raw}`);
  }
  return digits;
}

/**
 * Mantido para compatibilidade de testes/utilitarios legados.
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

export function buildOrderId(
  row: Pick<ExportRow, 'order_id' | 'event_name' | 'chat_id' | 'message_id'>
): string {
  return row.order_id || `${row.event_name}:${row.chat_id}:${row.message_id}`;
}

export function buildTransactionId(
  row: Pick<
    ExportRow,
    'transaction_id' | 'order_id' | 'workspace_id' | 'event_name' | 'chat_id' | 'message_id' | 'export_id'
  >
): string {
  if (row.transaction_id) return row.transaction_id;
  if (row.order_id) return row.order_id;
  const anchor = row.chat_id || row.export_id;
  return `dialogy:${row.workspace_id}:${row.event_name}:${anchor}`;
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

/**
 * Monta o payload de conversao no formato da Google Data Manager API v1 (events:ingest).
 */
export function buildDataManagerEventPayload(row: ExportRow, customerId: string) {
  const productDestinationId = buildProductDestinationId(row);
  const transactionId = buildTransactionId(row);

  const gclid = sanitizeClickId(row.gclid);
  const gbraid = sanitizeClickId(row.gbraid);
  const wbraid = sanitizeClickId(row.wbraid);

  const adIdentifiers: Record<string, string> = {};
  if (gclid) adIdentifiers.gclid = gclid;
  else if (gbraid) adIdentifiers.gbraid = gbraid;
  else if (wbraid) adIdentifiers.wbraid = wbraid;

  const userData = buildUserData({
    email: row.contact_email,
    phone: row.contact_phone,
  });

  // Sem click id e sem identificador de usuario o Google nao tem como atribuir.
  if (Object.keys(adIdentifiers).length === 0 && !userData) {
    throw new PermanentExportError('Conversao sem gclid/gbraid/wbraid e sem identificador de usuario.');
  }

  const rawValue = Number(row.conversion_value ?? 1);
  const conversionValue = Number.isFinite(rawValue) && rawValue >= 0 ? rawValue : 1;
  const consent = buildConsent(row.gads_config);

  const event: Record<string, unknown> = {
    eventTimestamp: formatRfc3339DateTime(row.created_at),
    transactionId,
    conversionValue,
    currency: row.currency || 'BRL',
  };

  if (Object.keys(adIdentifiers).length > 0) {
    event.adIdentifiers = adIdentifiers;
  }
  if (userData) {
    event.userData = userData;
  }
  if (consent) {
    event.consent = consent;
  }

  return {
    destinations: [
      {
        operatingAccount: {
          accountId: customerId,
          accountType: 'GOOGLE_ADS',
        },
        productDestinationId,
      },
    ],
    events: [event],
    validateOnly: false,
  };
}

/**
 * Mantido para compatibilidade com testes que validam a estrutura individual de clique.
 */
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

/** 4xx (exceto 401/408/429) é erro de dado definitivo: nova tentativa nao resolve. */
export function isPermanentStatus(status: number): boolean {
  if (status === 401 || status === 408 || status === 429) return false;
  return status >= 400 && status < 500;
}

export async function uploadExportToDataManager(row: ExportRow, accessToken: string) {
  const customerId = normalizeGoogleAdsCustomerId(row.google_ads_customer_id);
  if (!customerId) {
    throw new PermanentExportError('Workspace sem google_ads_customer_id configurado.');
  }

  const payload = buildDataManagerEventPayload(row, customerId);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };

  const response = await fetch(`${DATA_MANAGER_API_BASE}/events:ingest`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const responsePayload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail = JSON.stringify(responsePayload).slice(0, 2000);
    const message = `Google Data Manager API respondeu ${response.status}: ${detail}`;
    throw isPermanentStatus(response.status) ? new PermanentExportError(message) : new Error(message);
  }

  const requestId =
    responsePayload.requestId ||
    responsePayload.request_id ||
    responsePayload.name ||
    null;

  return { requestPayload: payload, responsePayload, requestId };
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

async function claimSubmittedExports(limit: number, leaseMs: number, workerId: string): Promise<string[]> {
  const claimed = await db.query(
    `
    UPDATE conversion_exports
    SET locked_by = $1,
        lease_expires_at = clock_timestamp() + ($2 * interval '1 millisecond'),
        updated_at = timezone('utc', now())
    WHERE id IN (
      SELECT id
      FROM conversion_exports
      WHERE status = 'submitted'
        AND next_attempt_at <= clock_timestamp()
        AND (locked_by IS NULL OR lease_expires_at <= clock_timestamp())
      ORDER BY next_attempt_at
      LIMIT $3
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
    `,
    [workerId, leaseMs, limit]
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
      ce.product_destination_id,
      ce.conversion_value,
      ce.currency,
      ce.created_at,
      ce.attempt_count,
      ce.order_id,
      ce.transaction_id,
      ce.request_id,
      ce.processing_status,
      ce.adjustment_type,
      ce.custom_variables,
      ce.response AS response_payload,
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

  return result.rows.map((r) => ({
    ...r,
    responsePayload: r.response_payload,
  })) as ExportRow[];
}

export async function markSubmitted(
  row: ExportRow,
  result: { requestPayload: unknown; responsePayload: unknown; requestId: string | null }
) {
  await db.query(
    `
    UPDATE conversion_exports
    SET status = 'submitted',
        request_id = $2,
        processing_status = 'PROCESSING',
        sent_at = timezone('utc', now()),
        next_attempt_at = timezone('utc', now()) + interval '30 seconds',
        updated_at = timezone('utc', now()),
        locked_by = NULL,
        lease_expires_at = NULL,
        payload = $3::jsonb,
        response = $4::jsonb,
        error_message = NULL,
        last_error_code = NULL,
        last_error_message = NULL
    WHERE id = $1
    `,
    [
      row.export_id,
      result.requestId,
      JSON.stringify(result.requestPayload),
      JSON.stringify(result.responsePayload),
    ]
  );
}

export async function markConfirmed(exportId: string, responsePayload: unknown) {
  await db.query(
    `
    UPDATE conversion_exports
    SET status = 'confirmed',
        processing_status = 'SUCCESS',
        processing_checked_at = timezone('utc', now()),
        updated_at = timezone('utc', now()),
        locked_by = NULL,
        lease_expires_at = NULL,
        response = COALESCE($2::jsonb, response),
        error_message = NULL,
        last_error_code = NULL,
        last_error_message = NULL
    WHERE id = $1
    `,
    [exportId, responsePayload ? JSON.stringify(responsePayload) : null]
  );
}

export async function markPermanentDead(
  row: ExportRow,
  errorCode: string,
  errorMessage: string,
  responsePayload?: unknown
) {
  await db.query(
    `
    UPDATE conversion_exports
    SET status = 'dead',
        processing_status = 'FAILED',
        processing_checked_at = timezone('utc', now()),
        last_error_code = $2,
        last_error_message = $3,
        error_message = $3,
        updated_at = timezone('utc', now()),
        locked_by = NULL,
        lease_expires_at = NULL,
        response = COALESCE($4::jsonb, response)
    WHERE id = $1
    `,
    [
      row.export_id,
      errorCode.slice(0, 255),
      errorMessage.slice(0, 4000),
      responsePayload ? JSON.stringify(responsePayload) : null,
    ]
  );
}

export async function markFailed(row: ExportRow, error: unknown) {
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
        error_message = $2,
        last_error_message = $2
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

/**
 * Processa a fila de conversoes pendentes enviando para a Data Manager API (events:ingest).
 */
export async function processPendingGoogleAdsConversionExports(
  limit = 25,
  options: { workerId?: string; leaseMs?: number } = {}
): Promise<ProcessResult> {
  await ensureWorkspaceIntegrationsTable();

  const workerId = options.workerId || 'inline';
  const leaseMs = options.leaseMs || DEFAULT_LEASE_MS;

  const exportIds = await claimExports(limit, leaseMs, workerId);
  if (exportIds.length === 0) {
    return { processed: 0, submitted: 0, sent: 0, confirmed: 0, failed: 0, dead: 0 };
  }

  const rows = await loadClaimedExports(exportIds);
  let submitted = 0;
  let sent = 0;
  let failed = 0;
  let dead = 0;

  for (const row of rows) {
    try {
      const credentials = resolveGoogleAdsCredentials(row.gads_config, row.workspace_id);
      const accessToken = await getGoogleAccessToken(credentials);
      const result = await uploadExportToDataManager(row, accessToken);
      await markSubmitted(row, result);
      submitted += 1;
      sent += 1;
    } catch (error) {
      const isDead = await markFailed(row, error);
      if (isDead) dead += 1;
      else failed += 1;
    }
  }

  return { processed: rows.length, submitted, sent, confirmed: 0, failed, dead };
}

/**
 * Consulta o status assincrono dos jobs em `submitted` via Data Manager API (requestStatus:retrieve).
 */
export async function checkSubmittedGoogleAdsConversionRequests(
  limit = 25,
  options: { workerId?: string; leaseMs?: number } = {}
): Promise<{ checked: number; confirmed: number; failed: number; dead: number; processing: number }> {
  await ensureWorkspaceIntegrationsTable();

  const workerId = options.workerId || 'inline-checker';
  const leaseMs = options.leaseMs || DEFAULT_LEASE_MS;

  const exportIds = await claimSubmittedExports(limit, leaseMs, workerId);
  if (exportIds.length === 0) {
    return { checked: 0, confirmed: 0, failed: 0, dead: 0, processing: 0 };
  }

  const rows = await loadClaimedExports(exportIds);
  let confirmed = 0;
  let failed = 0;
  let dead = 0;
  let processing = 0;

  for (const row of rows) {
    try {
      if (!row.request_id) {
        // Registro sem requestId (ex: gerado antes da migracao)
        await markConfirmed(row.export_id, row.responsePayload || { note: 'no_request_id' });
        confirmed += 1;
        continue;
      }

      const credentials = resolveGoogleAdsCredentials(row.gads_config, row.workspace_id);
      const accessToken = await getGoogleAccessToken(credentials);

      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      };

      const url = `${DATA_MANAGER_API_BASE}/requestStatus:retrieve?requestId=${encodeURIComponent(row.request_id)}`;
      const response = await fetch(url, { method: 'GET', headers });
      const responsePayload = await response.json().catch(() => ({}));

      if (!response.ok) {
        const detail = JSON.stringify(responsePayload).slice(0, 2000);
        const message = `Falha ao consultar requestStatus (${response.status}): ${detail}`;
        if (isPermanentStatus(response.status)) {
          await markPermanentDead(row, `HTTP_${response.status}`, message, responsePayload);
          dead += 1;
        } else {
          await markFailed(row, new Error(message));
          failed += 1;
        }
        continue;
      }

      const topLevelStatus = String(
        responsePayload.status ||
        responsePayload.processingStatus ||
        responsePayload.state ||
        ''
      ).toUpperCase();

      const destinationStatuses: any[] = Array.isArray(responsePayload.requestStatusPerDestination)
        ? responsePayload.requestStatusPerDestination
        : [];

      const hasDestinationErrors = destinationStatuses.some((d: any) =>
        d.status === 'FAILED' || (Array.isArray(d.errors) && d.errors.length > 0)
      );

      const isStillProcessing =
        topLevelStatus === 'PROCESSING' ||
        (destinationStatuses.length > 0 && destinationStatuses.every((d: any) => d.status === 'PROCESSING'));

      if (isStillProcessing) {
        await db.query(
          `
          UPDATE conversion_exports
          SET processing_status = 'PROCESSING',
              processing_checked_at = timezone('utc', now()),
              next_attempt_at = timezone('utc', now()) + interval '60 seconds',
              updated_at = timezone('utc', now()),
              locked_by = NULL,
              lease_expires_at = NULL,
              response = $2::jsonb
          WHERE id = $1
          `,
          [row.export_id, JSON.stringify(responsePayload)]
        );
        processing += 1;
        continue;
      }

      if (topLevelStatus === 'FAILED' || hasDestinationErrors) {
        const firstError =
          destinationStatuses.find((d: any) => Array.isArray(d.errors) && d.errors.length > 0)?.errors?.[0] || {};
        const errorCode = firstError.code || firstError.errorCode || topLevelStatus || 'DATA_MANAGER_ERROR';
        const errorMessage = firstError.message || JSON.stringify(responsePayload).slice(0, 2000);

        await markPermanentDead(row, String(errorCode), String(errorMessage), responsePayload);
        dead += 1;
        continue;
      }

      // Sucesso confirmado
      await markConfirmed(row.export_id, responsePayload);
      confirmed += 1;
    } catch (error) {
      const isDead = await markFailed(row, error);
      if (isDead) dead += 1;
      else failed += 1;
    }
  }

  return { checked: rows.length, confirmed, failed, dead, processing };
}
