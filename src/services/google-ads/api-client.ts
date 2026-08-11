import { db } from '@/lib/db';
import { ensureWorkspaceIntegrationsTable } from '@/lib/workspace-integrations';

import {
  getGoogleAccessToken,
  normalizeGoogleAdsCustomerId,
  resolveGoogleAdsCredentials,
  type GoogleAdsCredentials,
} from './credentials';

export class GoogleAdsApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'GoogleAdsApiError';
  }
}

export type GoogleAdsContext = {
  credentials: GoogleAdsCredentials;
  customerId: string | null;
  loginCustomerId: string | null;
  config: Record<string, unknown>;
};

/**
 * Reune credenciais e identificadores da conta a partir do workspace. Uma unica
 * porta de entrada para tudo que fala com a API.
 */
export async function loadWorkspaceGoogleAdsContext(workspaceId: string): Promise<GoogleAdsContext> {
  await ensureWorkspaceIntegrationsTable();

  const result = await db.query(
    `
    SELECT
      wi.config AS gads_config,
      w.google_ads_customer_id,
      w.google_ads_login_customer_id
    FROM workspaces w
    LEFT JOIN workspace_integrations wi
      ON wi.workspace_id = w.id
      AND wi.provider = 'gads'
    WHERE w.id = $1::uuid
    LIMIT 1
    `,
    [workspaceId]
  );

  const row = result.rows[0];
  if (!row) throw new GoogleAdsApiError('Workspace nao encontrado.', 404);

  const config = (row.gads_config || {}) as Record<string, unknown>;

  return {
    credentials: resolveGoogleAdsCredentials(config, workspaceId),
    customerId: normalizeGoogleAdsCustomerId(row.google_ads_customer_id || String(config.customerId ?? '')),
    loginCustomerId: normalizeGoogleAdsCustomerId(
      row.google_ads_login_customer_id || String(config.loginCustomerId ?? '')
    ),
    config,
  };
}

async function googleAdsRequest(
  credentials: GoogleAdsCredentials,
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown; loginCustomerId?: string | null }
): Promise<any> {
  const accessToken = await getGoogleAccessToken(credentials);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': credentials.developerToken,
    'Content-Type': 'application/json',
  };
  if (init.loginCustomerId) headers['login-customer-id'] = init.loginCustomerId;

  const response = await fetch(`https://googleads.googleapis.com/${credentials.apiVersion}/${path}`, {
    method: init.method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = String(payload?.error?.message || JSON.stringify(payload)).slice(0, 500);
    throw new GoogleAdsApiError(`Google Ads respondeu ${response.status}: ${detail}`, response.status);
  }

  return payload;
}

/** Chamada de escrita na API (mutate, create, run). */
export async function googleAdsPost(params: {
  credentials: GoogleAdsCredentials;
  path: string;
  body: unknown;
  loginCustomerId?: string | null;
}): Promise<any> {
  return googleAdsRequest(params.credentials, params.path, {
    method: 'POST',
    body: params.body,
    loginCustomerId: params.loginCustomerId,
  });
}

/**
 * Executa uma consulta GAQL paginada. A API devolve no maximo 10 mil linhas por
 * pagina; seguimos o nextPageToken ate o fim, com teto para nao girar sem parar.
 */
export async function searchGoogleAds(params: {
  credentials: GoogleAdsCredentials;
  customerId: string;
  loginCustomerId?: string | null;
  query: string;
  maxPages?: number;
}): Promise<any[]> {
  const rows: any[] = [];
  let pageToken: string | undefined;
  const maxPages = params.maxPages ?? 20;

  for (let page = 0; page < maxPages; page += 1) {
    const payload = await googleAdsRequest(params.credentials, `customers/${params.customerId}/googleAds:search`, {
      method: 'POST',
      loginCustomerId: params.loginCustomerId,
      body: { query: params.query, pageSize: 10000, ...(pageToken ? { pageToken } : {}) },
    });

    rows.push(...(payload.results || []));
    pageToken = payload.nextPageToken;
    if (!pageToken) break;
  }

  return rows;
}

export type AccessibleCustomer = {
  customerId: string;
  descriptiveName: string;
  currencyCode: string;
  isManager: boolean;
};

/**
 * Contas que o refresh token alcanca. Sob um MCC a lista costuma trazer apenas
 * o gerenciador, entao expandimos os filhos para o usuario escolher a conta
 * que de fato roda os anuncios.
 */
export async function listAccessibleCustomers(
  credentials: GoogleAdsCredentials
): Promise<AccessibleCustomer[]> {
  const payload = await googleAdsRequest(credentials, 'customers:listAccessibleCustomers', { method: 'GET' });
  const resourceNames: string[] = payload.resourceNames || [];

  const customers = new Map<string, AccessibleCustomer>();

  for (const resourceName of resourceNames) {
    const rootId = resourceName.split('/')[1];
    if (!rootId) continue;

    try {
      const rows = await searchGoogleAds({
        credentials,
        customerId: rootId,
        loginCustomerId: rootId,
        query: `
          SELECT
            customer_client.id,
            customer_client.descriptive_name,
            customer_client.currency_code,
            customer_client.manager
          FROM customer_client
          WHERE customer_client.status = 'ENABLED'
        `,
        maxPages: 5,
      });

      for (const row of rows) {
        const client = row.customerClient || {};
        const id = normalizeGoogleAdsCustomerId(client.id);
        if (!id) continue;
        customers.set(id, {
          customerId: id,
          descriptiveName: client.descriptiveName || id,
          currencyCode: client.currencyCode || 'BRL',
          isManager: Boolean(client.manager),
        });
      }
    } catch {
      // Uma conta sem permissao de leitura nao pode derrubar a listagem inteira.
      if (!customers.has(rootId)) {
        customers.set(rootId, {
          customerId: rootId,
          descriptiveName: rootId,
          currencyCode: 'BRL',
          isManager: false,
        });
      }
    }
  }

  return Array.from(customers.values()).sort((left, right) =>
    left.descriptiveName.localeCompare(right.descriptiveName, 'pt-BR')
  );
}

export type ConversionActionOption = {
  resourceName: string;
  id: string;
  name: string;
  category: string;
  type: string;
};

/** Ações de conversão da conta, para o usuario escolher em vez de colar resource name. */
export async function listConversionActions(params: {
  credentials: GoogleAdsCredentials;
  customerId: string;
  loginCustomerId?: string | null;
}): Promise<ConversionActionOption[]> {
  const rows = await searchGoogleAds({
    ...params,
    query: `
      SELECT
        conversion_action.resource_name,
        conversion_action.id,
        conversion_action.name,
        conversion_action.category,
        conversion_action.type
      FROM conversion_action
      WHERE conversion_action.status = 'ENABLED'
    `,
    maxPages: 5,
  });

  return rows
    .map((row) => {
      const action = row.conversionAction || {};
      return {
        resourceName: action.resourceName || '',
        id: String(action.id || ''),
        name: action.name || '',
        category: action.category || '',
        type: action.type || '',
      };
    })
    .filter((action) => action.resourceName)
    .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
}

export type CampaignCostRow = {
  campaignId: string;
  campaignName: string;
  cost: number;
  impressions: number;
  clicks: number;
  currencyCode: string;
};

/** Custo por campanha no periodo. cost_micros vem em milionesimos da moeda. */
export async function fetchCampaignCosts(params: {
  credentials: GoogleAdsCredentials;
  customerId: string;
  loginCustomerId?: string | null;
  startDate: string;
  endDate: string;
}): Promise<CampaignCostRow[]> {
  const rows = await searchGoogleAds({
    credentials: params.credentials,
    customerId: params.customerId,
    loginCustomerId: params.loginCustomerId,
    query: `
      SELECT
        campaign.id,
        campaign.name,
        customer.currency_code,
        metrics.cost_micros,
        metrics.impressions,
        metrics.clicks
      FROM campaign
      WHERE segments.date BETWEEN '${params.startDate}' AND '${params.endDate}'
    `,
  });

  const byCampaign = new Map<string, CampaignCostRow>();

  for (const row of rows) {
    const campaignId = String(row.campaign?.id || '');
    if (!campaignId) continue;

    const existing = byCampaign.get(campaignId) ?? {
      campaignId,
      campaignName: row.campaign?.name || campaignId,
      cost: 0,
      impressions: 0,
      clicks: 0,
      currencyCode: row.customer?.currencyCode || 'BRL',
    };

    existing.cost += Number(row.metrics?.costMicros || 0) / 1_000_000;
    existing.impressions += Number(row.metrics?.impressions || 0);
    existing.clicks += Number(row.metrics?.clicks || 0);
    byCampaign.set(campaignId, existing);
  }

  return Array.from(byCampaign.values()).sort((left, right) => right.cost - left.cost);
}
