'use server';

import { revalidatePath } from 'next/cache';

import { db } from '@/lib/db';
import { ensureWorkspaceIntegrationsTable } from '@/lib/workspace-integrations';
import { getCurrentUser } from '@/actions/user';
import { normalizeWhatsappDestinationPhone } from '@/lib/marketing-attribution';

export type GoogleAdsDestination = {
  id: string;
  name: string;
  slug: string;
  instanceName: string;
  phone: string;
  defaultMessage: string;
};

export type GoogleAdsIntegrationConfig = {
  customerId: string;
  loginCustomerId: string;
  refreshToken: string;
  conversionActionWhatsappMessage: string;
  conversionActionLeadQualified: string;
  conversionActionSaleWon: string;
  destinations: GoogleAdsDestination[];
};

const MASKED_SECRET = '********';

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

function mergeSecretInput(inputValue: unknown, storedValue: unknown): string {
  const inputText = sanitizeText(inputValue, 2000);
  const storedText = sanitizeText(storedValue, 2000);
  if (!inputText || isMaskedSecret(inputText)) return storedText;
  return inputText;
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

async function assertWorkspaceAccess(workspaceId: string) {
  const user = await getCurrentUser();
  if (!user?.activeWorkspaceId || user.activeWorkspaceId !== workspaceId) {
    return { user: null, error: 'Acesso negado ao workspace.' };
  }
  return { user, error: null };
}

export async function getGoogleAdsIntegrationConfig(
  workspaceId: string
): Promise<{
  config: GoogleAdsIntegrationConfig | null;
  instances: Array<{ instanceName: string; displayName: string | null; type: string | null }>;
  error?: string;
}> {
  const access = await assertWorkspaceAccess(workspaceId);
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

export async function saveGoogleAdsIntegrationConfig(
  workspaceId: string,
  input: GoogleAdsIntegrationConfig
): Promise<{ success: boolean; error?: string }> {
  const access = await assertWorkspaceAccess(workspaceId);
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
    refreshToken: mergeSecretInput(input.refreshToken, storedConfig.refreshToken),
    conversionActionWhatsappMessage: sanitizeText(input.conversionActionWhatsappMessage, 300),
    conversionActionLeadQualified: sanitizeText(input.conversionActionLeadQualified, 300),
    conversionActionSaleWon: sanitizeText(input.conversionActionSaleWon, 300),
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
