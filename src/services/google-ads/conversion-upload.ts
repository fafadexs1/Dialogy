import { db } from '@/lib/db';
import { ensureWorkspaceIntegrationsTable } from '@/lib/workspace-integrations';

const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';

type PendingConversionRow = {
  export_id: string;
  workspace_id: string;
  event_name: string;
  conversion_action_id: string | null;
  conversion_value: string | number | null;
  currency: string | null;
  created_at: string | Date;
  google_ads_customer_id: string | null;
  google_ads_login_customer_id: string | null;
  ad_click_id: string;
  message_id: string;
  chat_id: string;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  gads_config: Record<string, unknown> | null;
};

type GoogleAdsCredentials = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  developerToken: string;
  apiVersion: string;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variavel de ambiente obrigatoria ausente: ${name}`);
  return value;
}

function readConfigString(config: Record<string, unknown> | null | undefined, key: string): string {
  return String(config?.[key] ?? '').trim();
}

function requiredConfig(config: Record<string, unknown> | null | undefined, key: string, workspaceId: string): string {
  const value = readConfigString(config, key);
  if (!value) {
    throw new Error(`Credencial Google Ads ausente no workspace ${workspaceId}: ${key}.`);
  }
  return value;
}

function getGoogleAdsCredentials(row: PendingConversionRow): GoogleAdsCredentials {
  return {
    clientId: requiredEnv('GOOGLE_ADS_CLIENT_ID'),
    clientSecret: requiredEnv('GOOGLE_ADS_CLIENT_SECRET'),
    refreshToken: requiredConfig(row.gads_config, 'refreshToken', row.workspace_id),
    developerToken: requiredEnv('GOOGLE_ADS_DEVELOPER_TOKEN'),
    apiVersion: process.env.GOOGLE_ADS_API_VERSION?.trim() || 'v24',
  };
}

function normalizeGoogleAdsCustomerId(value: string | null | undefined): string | null {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits || null;
}

function formatGoogleAdsDateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error('Data de conversao invalida para Google Ads.');
  }

  const pad = (input: number) => String(input).padStart(2, '0');
  return [
    date.getUTCFullYear(),
    '-',
    pad(date.getUTCMonth() + 1),
    '-',
    pad(date.getUTCDate()),
    ' ',
    pad(date.getUTCHours()),
    ':',
    pad(date.getUTCMinutes()),
    ':',
    pad(date.getUTCSeconds()),
    '+00:00',
  ].join('');
}

async function getGoogleAccessToken(credentials: GoogleAdsCredentials): Promise<string> {
  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload.access_token !== 'string') {
    throw new Error(`Falha ao obter access token Google Ads: ${JSON.stringify(payload)}`);
  }

  return payload.access_token;
}

function buildClickConversion(row: PendingConversionRow) {
  const clickId =
    row.gclid ? { gclid: row.gclid } :
      row.gbraid ? { gbraid: row.gbraid } :
        row.wbraid ? { wbraid: row.wbraid } :
          null;

  if (!clickId) {
    throw new Error('Conversao sem gclid, gbraid ou wbraid.');
  }

  if (!row.conversion_action_id) {
    throw new Error(`Acao de conversao Google Ads nao configurada para ${row.event_name}.`);
  }

  return {
    conversionAction: row.conversion_action_id,
    conversionDateTime: formatGoogleAdsDateTime(row.created_at),
    conversionValue: Number(row.conversion_value ?? 1),
    currencyCode: row.currency || 'BRL',
    orderId: `${row.event_name}:${row.chat_id}:${row.message_id}`,
    ...clickId,
  };
}

async function uploadClickConversion(row: PendingConversionRow, accessToken: string, credentials: GoogleAdsCredentials) {
  const customerId = normalizeGoogleAdsCustomerId(row.google_ads_customer_id);
  if (!customerId) throw new Error('Workspace sem google_ads_customer_id.');

  const loginCustomerId = normalizeGoogleAdsCustomerId(
    row.google_ads_login_customer_id || readConfigString(row.gads_config, 'loginCustomerId')
  );
  const endpoint = `https://googleads.googleapis.com/${credentials.apiVersion}/customers/${customerId}:uploadClickConversions`;
  const conversion = buildClickConversion(row);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': credentials.developerToken,
    'Content-Type': 'application/json',
  };
  if (loginCustomerId) headers['login-customer-id'] = loginCustomerId;

  const requestPayload = {
    conversions: [conversion],
    partialFailure: true,
    validateOnly: false,
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestPayload),
  });

  const responsePayload = await response.json().catch(() => ({}));
  if (!response.ok || responsePayload.partialFailureError) {
    throw new Error(JSON.stringify(responsePayload));
  }

  return { requestPayload, responsePayload };
}

export async function processPendingGoogleAdsConversionExports(limit = 25) {
  await ensureWorkspaceIntegrationsTable();

  const pendingRes = await db.query(
    `
    SELECT
      ce.id AS export_id,
      ce.workspace_id,
      ce.event_name,
      ce.conversion_action_id,
      ce.conversion_value,
      ce.currency,
      ce.created_at,
      w.google_ads_customer_id,
      w.google_ads_login_customer_id,
      ac.id AS ad_click_id,
      aa.message_id,
      aa.chat_id,
      ac.gclid,
      ac.gbraid,
      ac.wbraid,
      wi.config AS gads_config
    FROM conversion_exports ce
    JOIN ad_attributions aa ON aa.id = ce.ad_attribution_id
    JOIN ad_clicks ac ON ac.id = aa.ad_click_id
    JOIN workspaces w ON w.id::text = ce.workspace_id
    LEFT JOIN workspace_integrations wi
      ON wi.workspace_id::text = ce.workspace_id
      AND wi.provider = 'gads'
      AND wi.is_active = true
    WHERE ce.status IN ('pending', 'failed')
      AND ce.attempt_count < 5
    ORDER BY ce.created_at ASC
    LIMIT $1
    `,
    [limit]
  );

  if (pendingRes.rows.length === 0) {
    return { processed: 0, sent: 0, failed: 0 };
  }

  const accessTokens = new Map<string, string>();
  let sent = 0;
  let failed = 0;

  for (const row of pendingRes.rows as PendingConversionRow[]) {
    try {
      const credentials = getGoogleAdsCredentials(row);
      const tokenCacheKey = JSON.stringify({
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
        refreshToken: credentials.refreshToken,
      });
      let accessToken = accessTokens.get(tokenCacheKey);
      if (!accessToken) {
        accessToken = await getGoogleAccessToken(credentials);
        accessTokens.set(tokenCacheKey, accessToken);
      }
      const result = await uploadClickConversion(row, accessToken, credentials);
      await db.query(
        `
        UPDATE conversion_exports
        SET status = 'sent',
            sent_at = timezone('utc', now()),
            updated_at = timezone('utc', now()),
            payload = $2::jsonb,
            response = $3::jsonb,
            error_message = NULL
        WHERE id = $1
        `,
        [row.export_id, JSON.stringify(result.requestPayload), JSON.stringify(result.responsePayload)]
      );
      sent += 1;
    } catch (error) {
      failed += 1;
      await db.query(
        `
        UPDATE conversion_exports
        SET status = 'failed',
            attempt_count = attempt_count + 1,
            updated_at = timezone('utc', now()),
            error_message = $2
        WHERE id = $1
        `,
        [row.export_id, error instanceof Error ? error.message : String(error)]
      );
    }
  }

  return { processed: pendingRes.rows.length, sent, failed };
}
