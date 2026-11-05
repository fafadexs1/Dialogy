'use server';

import { revalidatePath } from 'next/cache';

import { db } from '@/lib/db';
import { ensureWorkspaceIntegrationsTable } from '@/lib/workspace-integrations';
import { getCurrentUser } from '@/actions/user';
import { hasWorkspacePermission } from '@/lib/workspace-permissions';
import { normalizeWhatsappDestinationPhone } from '@/lib/marketing-attribution';
import { encryptGoogleAdsSecret } from '@/services/google-ads/credentials';

export type GoogleAdsDestination = {
  id: string;
  name: string;
  slug: string;
  instanceName: string;
  phone: string;
  defaultMessage: string;
};

/** Consent Mode do Google. Vazio significa "nao declarado" e nao e enviado. */
export type GoogleAdsConsentState = '' | 'GRANTED' | 'DENIED';

export type GoogleAdsIntegrationConfig = {
  customerId: string;
  loginCustomerId: string;
  refreshToken: string;
  conversionActionWhatsappMessage: string;
  conversionActionLeadQualified: string;
  conversionActionSaleWon: string;
  consentAdUserData: GoogleAdsConsentState;
  consentAdPersonalization: GoogleAdsConsentState;
  destinations: GoogleAdsDestination[];
  /** Preenchido pela leitura: indica se ha autorizacao OAuth guardada. */
  connected?: boolean;
};

const MASKED_SECRET = '********';

function sanitizeConsent(value: unknown): GoogleAdsConsentState {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized === 'GRANTED' || normalized === 'DENIED' ? normalized : '';
}

function sanitizeCustomerId(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '').slice(0, 20);
}

function sanitizeText(value: unknown, maxLength = 500): string {
  return String(value ?? '').trim().slice(0, maxLength);
}

function isMaskedSecret(value: unknown): boolean {
  return String(value ?? '').trim() === MASKED_SECRET;
}

function readSecretForClient(value: unknown): string {
  return sanitizeText(value, 2000) ? MASKED_SECRET : '';
}

function createDestinationId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function slugifyDestination(value: string, fallback: string): string {
  const slug = String(value || fallback)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || fallback;
}

function normalizeDestinations(rawDestinations: unknown, legacyDestination?: unknown): GoogleAdsDestination[] {
  const source = Array.isArray(rawDestinations)
    ? rawDestinations
    : legacyDestination && typeof legacyDestination === 'object'
      ? [legacyDestination]
      : [];

  return source
    .map((item, index) => {
      const candidate = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      const name = sanitizeText(candidate.name || `Destino ${index + 1}`, 80) || `Destino ${index + 1}`;
      const id = sanitizeText(candidate.id, 80) || createDestinationId();
      return {
        id,
        name,
        slug: slugifyDestination(sanitizeText(candidate.slug, 80) || name, id),
        instanceName: sanitizeText(candidate.instanceName, 120),
        phone: sanitizeText(candidate.phone, 30),
        defaultMessage: sanitizeText(candidate.defaultMessage, 300) || 'Ola, quero atendimento.',
      };
    })
    .filter((destination) => destination.instanceName || destination.phone);
}

async function assertWorkspaceAccess(workspaceId: string, permissionId: string) {
  const user = await getCurrentUser();
  if (!user?.activeWorkspaceId || user.activeWorkspaceId !== workspaceId) {
    return { user: null, error: 'Acesso negado ao workspace.' };
  }
  if (!await hasWorkspacePermission(user.id, workspaceId, permissionId)) {
    return { user: null, error: 'Acesso negado ao workspace.' };
  }
  return { user, error: null };
}

/**
 * O refresh token e gravado cifrado. Quando o formulario devolve a mascara,
 * mantemos exatamente o que ja estava guardado.
 */
function resolveRefreshTokenForStorage(inputValue: unknown, storedValue: unknown): string {
  const inputText = sanitizeText(inputValue, 2000);
  const storedText = sanitizeText(storedValue, 2000);
  if (!inputText || isMaskedSecret(inputText)) return storedText;
  return encryptGoogleAdsSecret(inputText);
}

export async function getGoogleAdsIntegrationConfig(
  workspaceId: string
): Promise<{
  config: GoogleAdsIntegrationConfig | null;
  instances: Array<{ instanceName: string; displayName: string | null; type: string | null }>;
  error?: string;
}> {
  const access = await assertWorkspaceAccess(workspaceId, 'workspace:settings:view');
  if (access.error) return { config: null, instances: [], error: access.error };

  try {
    await ensureWorkspaceIntegrationsTable();

    const [integrationRes, workspaceRes, instancesRes] = await Promise.all([
      db.query(
        `SELECT config FROM workspace_integrations WHERE workspace_id = $1 AND provider = 'gads' LIMIT 1`,
        [workspaceId]
      ),
      db.query(
        `
        SELECT
          google_ads_customer_id,
          google_ads_login_customer_id,
          google_ads_conversion_action_whatsapp_message,
          google_ads_conversion_action_lead_qualified,
          google_ads_conversion_action_sale_won
        FROM workspaces
        WHERE id = $1
        LIMIT 1
        `,
        [workspaceId]
      ),
      db.query(
        `
        SELECT instance_name, display_name, type
        FROM evolution_api_instances
        WHERE workspace_id = $1
        ORDER BY display_name NULLS LAST, instance_name
        `,
        [workspaceId]
      ),
    ]);

    const stored = integrationRes.rows[0]?.config || {};
    const workspace = workspaceRes.rows[0] || {};

    return {
      config: {
        customerId: stored.customerId || workspace.google_ads_customer_id || '',
        loginCustomerId: stored.loginCustomerId || workspace.google_ads_login_customer_id || '',
        refreshToken: readSecretForClient(stored.refreshToken),
        conversionActionWhatsappMessage:
          stored.conversionActionWhatsappMessage ||
          workspace.google_ads_conversion_action_whatsapp_message ||
          '',
        conversionActionLeadQualified:
          stored.conversionActionLeadQualified ||
          workspace.google_ads_conversion_action_lead_qualified ||
          '',
        conversionActionSaleWon:
          stored.conversionActionSaleWon ||
          workspace.google_ads_conversion_action_sale_won ||
          '',
        consentAdUserData: sanitizeConsent(stored.consentAdUserData),
        consentAdPersonalization: sanitizeConsent(stored.consentAdPersonalization),
        connected: Boolean(sanitizeText(stored.refreshToken, 2000)),
        destinations: normalizeDestinations(stored.destinations, stored.destination),
      },
      instances: instancesRes.rows.map((row) => ({
        instanceName: row.instance_name,
        displayName: row.display_name,
        type: row.type,
      })),
    };
  } catch (error) {
    console.error('[GET_GADS_CONFIG] Error:', error);
    return { config: null, instances: [], error: 'Falha ao carregar configuracao do Google Ads.' };
  }
}

export type GoogleAdsAccountOption = {
  customerId: string;
  descriptiveName: string;
  currencyCode: string;
  isManager: boolean;
};

/** Contas que o token conectado alcanca, para o usuario escolher em vez de digitar. */
export async function listGoogleAdsAccounts(
  workspaceId: string
): Promise<{ accounts: GoogleAdsAccountOption[]; error?: string }> {
  const access = await assertWorkspaceAccess(workspaceId, 'workspace:settings:view');
  if (access.error) return { accounts: [], error: access.error };

  try {
    const { listAccessibleCustomers, loadWorkspaceGoogleAdsContext } = await import(
      '@/services/google-ads/api-client'
    );
    const context = await loadWorkspaceGoogleAdsContext(workspaceId);
    return { accounts: await listAccessibleCustomers(context.credentials) };
  } catch (error) {
    return { accounts: [], error: describeGoogleAdsError(error) };
  }
}

export type GoogleAdsConversionActionOption = {
  resourceName: string;
  id: string;
  name: string;
  category: string;
  type: string;
};

/** Acoes de conversao da conta escolhida, para virar seletor no lugar do resource name. */
export async function listGoogleAdsConversionActions(
  workspaceId: string,
  customerId: string,
  loginCustomerId?: string
): Promise<{ actions: GoogleAdsConversionActionOption[]; error?: string }> {
  const access = await assertWorkspaceAccess(workspaceId, 'workspace:settings:view');
  if (access.error) return { actions: [], error: access.error };

  const targetCustomerId = sanitizeCustomerId(customerId);
  if (!targetCustomerId) return { actions: [], error: 'Selecione uma conta do Google Ads.' };

  try {
    const { listConversionActions, loadWorkspaceGoogleAdsContext } = await import(
      '@/services/google-ads/api-client'
    );
    const context = await loadWorkspaceGoogleAdsContext(workspaceId);
    const actions = await listConversionActions({
      credentials: context.credentials,
      customerId: targetCustomerId,
      loginCustomerId: sanitizeCustomerId(loginCustomerId) || context.loginCustomerId,
    });
    return { actions };
  } catch (error) {
    return { actions: [], error: describeGoogleAdsError(error) };
  }
}

/** Remove a autorizacao guardada sem apagar destinos e acoes ja configurados. */
export async function disconnectGoogleAdsAccount(
  workspaceId: string
): Promise<{ success: boolean; error?: string }> {
  const access = await assertWorkspaceAccess(workspaceId, 'workspace:settings:edit');
  if (access.error) return { success: false, error: access.error };

  try {
    await ensureWorkspaceIntegrationsTable();
    await db.query(
      `
      UPDATE workspace_integrations
      SET config = COALESCE(config, '{}'::jsonb) - 'refreshToken',
          is_active = false,
          updated_at = timezone('utc', now())
      WHERE workspace_id = $1 AND provider = 'gads'
      `,
      [workspaceId]
    );
    revalidatePath('/integrations/gads');
    return { success: true };
  } catch (error) {
    console.error('[DISCONNECT_GADS] Error:', error);
    return { success: false, error: 'Falha ao desconectar a conta.' };
  }
}

function describeGoogleAdsError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('refreshToken')) return 'Conecte uma conta do Google Ads primeiro.';
  if (message.includes('Variavel de ambiente')) return 'Credenciais da API Google Ads ausentes no servidor.';
  return message.slice(0, 300);
}

export type GoogleAdsConversionHealth = {
  counts: { pending: number; processing: number; sent: number; failed: number; dead: number };
  lastSentAt: string | null;
  recentFailures: Array<{ eventName: string; errorMessage: string; attemptCount: number; updatedAt: string }>;
  attributedContacts: { deterministic: number; probabilistic: number };
};

/**
 * Sem isso uma falha de credencial fica invisivel: as conversoes simplesmente
 * param de chegar ao Google e ninguem fica sabendo.
 */
export async function getGoogleAdsConversionHealth(
  workspaceId: string
): Promise<{ health: GoogleAdsConversionHealth | null; error?: string }> {
  const access = await assertWorkspaceAccess(workspaceId, 'workspace:settings:view');
  if (access.error) return { health: null, error: access.error };

  try {
    const [countsRes, failuresRes, attributionRes] = await Promise.all([
      db.query(
        `
        SELECT
          COUNT(*) FILTER (WHERE status = 'pending') AS pending,
          COUNT(*) FILTER (WHERE status = 'processing') AS processing,
          COUNT(*) FILTER (WHERE status = 'sent') AS sent,
          COUNT(*) FILTER (WHERE status = 'failed') AS failed,
          COUNT(*) FILTER (WHERE status = 'dead') AS dead,
          MAX(sent_at) AS last_sent_at
        FROM conversion_exports
        WHERE workspace_id = $1
        `,
        [workspaceId]
      ),
      db.query(
        `
        SELECT event_name, error_message, attempt_count, updated_at
        FROM conversion_exports
        WHERE workspace_id = $1
          AND status IN ('failed', 'dead')
          AND error_message IS NOT NULL
        ORDER BY updated_at DESC
        LIMIT 5
        `,
        [workspaceId]
      ),
      db.query(
        `
        SELECT
          COUNT(*) FILTER (WHERE confidence = 'deterministic') AS deterministic,
          COUNT(*) FILTER (WHERE confidence = 'probabilistic') AS probabilistic
        FROM ad_attributions
        WHERE workspace_id = $1
        `,
        [workspaceId]
      ),
    ]);

    const counts = countsRes.rows[0] || {};
    const attribution = attributionRes.rows[0] || {};

    return {
      health: {
        counts: {
          pending: Number(counts.pending || 0),
          processing: Number(counts.processing || 0),
          sent: Number(counts.sent || 0),
          failed: Number(counts.failed || 0),
          dead: Number(counts.dead || 0),
        },
        lastSentAt: counts.last_sent_at ? new Date(counts.last_sent_at).toISOString() : null,
        recentFailures: failuresRes.rows.map((row) => ({
          eventName: row.event_name,
          errorMessage: String(row.error_message || '').slice(0, 300),
          attemptCount: Number(row.attempt_count || 0),
          updatedAt: new Date(row.updated_at).toISOString(),
        })),
        attributedContacts: {
          deterministic: Number(attribution.deterministic || 0),
          probabilistic: Number(attribution.probabilistic || 0),
        },
      },
    };
  } catch (error) {
    console.error('[GET_GADS_HEALTH] Error:', error);
    return { health: null, error: 'Falha ao carregar a saude das conversoes.' };
  }
}

export type GoogleAdsCampaignRow = {
  campaignId: string;
  campaignName: string;
  cost: number;
  impressions: number;
  clicks: number;
  trackedClicks: number;
  conversations: number;
  wonDeals: number;
  revenue: number;
  costPerConversation: number | null;
  costPerAcquisition: number | null;
  roas: number | null;
};

export type GoogleAdsPerformanceReport = {
  currencyCode: string;
  startDate: string;
  endDate: string;
  rows: GoogleAdsCampaignRow[];
  totals: {
    cost: number;
    conversations: number;
    wonDeals: number;
    revenue: number;
    roas: number | null;
    costPerAcquisition: number | null;
  };
  costUnavailableReason?: string;
};

/** CAC e ROAS reais: custo vindo do Google, receita vinda do CRM. */
export async function getGoogleAdsCampaignPerformance(
  workspaceId: string,
  startDate: string,
  endDate: string
): Promise<{ report: GoogleAdsPerformanceReport | null; error?: string }> {
  const access = await assertWorkspaceAccess(workspaceId, 'workspace:settings:view');
  if (access.error) return { report: null, error: access.error };

  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  if (!isoDate.test(startDate) || !isoDate.test(endDate)) {
    return { report: null, error: 'Periodo invalido.' };
  }

  try {
    const { getCampaignPerformance } = await import('@/services/google-ads/campaign-performance');
    return { report: await getCampaignPerformance({ workspaceId, startDate, endDate }) };
  } catch (error) {
    console.error('[GADS_PERFORMANCE] Error:', error);
    return { report: null, error: describeGoogleAdsError(error) };
  }
}

/** Sincroniza uma lista do CRM como publico de Customer Match, sem CSV manual. */
export async function syncSegmentToGoogleAdsAudience(
  workspaceId: string,
  segmentId: string
): Promise<{ result: { uploadedCount: number; skippedCount: number; userListName: string } | null; error?: string }> {
  const access = await assertWorkspaceAccess(workspaceId, 'workspace:settings:edit');
  if (access.error) return { result: null, error: access.error };

  try {
    const { syncSegmentToCustomerMatch } = await import('@/services/google-ads/customer-match');
    const result = await syncSegmentToCustomerMatch({ workspaceId, segmentId });
    revalidatePath('/crm');
    return {
      result: {
        uploadedCount: result.uploadedCount,
        skippedCount: result.skippedCount,
        userListName: result.userListName,
      },
    };
  } catch (error) {
    console.error('[GADS_CUSTOMER_MATCH] Error:', error);
    return { result: null, error: describeGoogleAdsError(error) };
  }
}

export async function saveGoogleAdsIntegrationConfig(
  workspaceId: string,
  input: GoogleAdsIntegrationConfig
): Promise<{ success: boolean; error?: string }> {
  const access = await assertWorkspaceAccess(workspaceId, 'workspace:settings:edit');
  if (access.error) return { success: false, error: access.error };

  await ensureWorkspaceIntegrationsTable();

  const existingIntegrationRes = await db.query(
    `SELECT config FROM workspace_integrations WHERE workspace_id = $1 AND provider = 'gads' LIMIT 1`,
    [workspaceId]
  );
  const storedConfig = existingIntegrationRes.rows[0]?.config || {};

  const destinations = (input.destinations || []).map((destination, index) => {
    const id = sanitizeText(destination.id, 80) || createDestinationId();
    const name = sanitizeText(destination.name, 80) || `Destino ${index + 1}`;
    return {
      id,
      name,
      slug: slugifyDestination(destination.slug || name, id),
      instanceName: sanitizeText(destination.instanceName, 120),
      phone: normalizeWhatsappDestinationPhone(destination.phone),
      defaultMessage: sanitizeText(destination.defaultMessage, 300) || 'Ola, quero atendimento.',
    };
  });

  if (destinations.length === 0) {
    return { success: false, error: 'Adicione pelo menos um destino de anuncio.' };
  }

  const seenSlugs = new Set<string>();
  for (const destination of destinations) {
    if (!destination.phone) return { success: false, error: `Destino "${destination.name}" sem WhatsApp valido.` };
    if (!destination.instanceName) return { success: false, error: `Destino "${destination.name}" sem instancia Evolution.` };
    if (seenSlugs.has(destination.slug)) return { success: false, error: `Slug duplicado: ${destination.slug}.` };
    seenSlugs.add(destination.slug);
  }

  const config: GoogleAdsIntegrationConfig = {
    customerId: sanitizeCustomerId(input.customerId),
    loginCustomerId: sanitizeCustomerId(input.loginCustomerId),
    refreshToken: resolveRefreshTokenForStorage(input.refreshToken, storedConfig.refreshToken),
    conversionActionWhatsappMessage: sanitizeText(input.conversionActionWhatsappMessage, 300),
    conversionActionLeadQualified: sanitizeText(input.conversionActionLeadQualified, 300),
    conversionActionSaleWon: sanitizeText(input.conversionActionSaleWon, 300),
    consentAdUserData: sanitizeConsent(input.consentAdUserData),
    consentAdPersonalization: sanitizeConsent(input.consentAdPersonalization),
    destinations: destinations as GoogleAdsDestination[],
  };

  try {
    const instanceRes = await db.query(
      `SELECT instance_name FROM evolution_api_instances WHERE workspace_id = $1 AND instance_name = ANY($2::text[])`,
      [workspaceId, config.destinations.map((destination) => destination.instanceName)]
    );
    const validInstances = new Set(instanceRes.rows.map((row) => row.instance_name));
    const invalidDestination = config.destinations.find((destination) => !validInstances.has(destination.instanceName));
    if (invalidDestination) {
      return { success: false, error: `Instancia invalida no destino "${invalidDestination.name}".` };
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `
        INSERT INTO workspace_integrations (workspace_id, provider, config, is_active, updated_at)
        VALUES ($1, 'gads', $2::jsonb, true, timezone('utc', now()))
        ON CONFLICT (workspace_id, provider)
        DO UPDATE SET config = $2::jsonb, is_active = true, updated_at = timezone('utc', now())
        `,
        [workspaceId, JSON.stringify(config)]
      );

      await client.query(
        `
        UPDATE workspaces
        SET google_ads_customer_id = $2,
            google_ads_login_customer_id = $3,
            google_ads_conversion_action_whatsapp_message = $4,
            google_ads_conversion_action_lead_qualified = $5,
            google_ads_conversion_action_sale_won = $6
        WHERE id = $1
        `,
        [
          workspaceId,
          config.customerId || null,
          config.loginCustomerId || null,
          config.conversionActionWhatsappMessage || null,
          config.conversionActionLeadQualified || null,
          config.conversionActionSaleWon || null,
        ]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    revalidatePath('/integrations');
    revalidatePath('/integrations/gads');
    return { success: true };
  } catch (error) {
    console.error('[SAVE_GADS_CONFIG] Error:', error);
    return { success: false, error: 'Falha ao salvar integracao Google Ads.' };
  }
}
