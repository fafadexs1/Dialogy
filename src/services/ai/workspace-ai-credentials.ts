import { db } from '@/lib/db';
import { ensureWorkspaceIntegrationsTable } from '@/lib/workspace-integrations';
import { resolveConfiguredAiModel, type AiModelCatalogEntry } from '@/lib/ai-models';
import {
  AI_CREDENTIAL_PROVIDERS,
  formatAiCredentialModelLabel,
  getAiCredentialModelProvider,
  getAiCredentialProviderLabel,
  getDefaultAiCredentialModel,
  isAiCredentialProvider,
  normalizeAiCredentialModel,
  type AiCredentialProvider,
} from '@/lib/ai-provider-credentials';

export type WorkspaceAiCredentialRecord = {
  provider: AiCredentialProvider;
  apiKey: string;
  aiModel: string;
  isActive: boolean;
  updatedAt: string | null;
};

export type ConfiguredWorkspaceAiModel = AiModelCatalogEntry & {
  credentialProvider: AiCredentialProvider;
  providerLabel: string;
};

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function parseWorkspaceAiProviderConfig(value: unknown): { apiKey: string; aiModel: string } {
  if (!value) return { apiKey: '', aiModel: '' };
  if (typeof value === 'string') {
    try {
      return parseWorkspaceAiProviderConfig(JSON.parse(value));
    } catch {
      return { apiKey: '', aiModel: '' };
    }
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { apiKey: '', aiModel: '' };
  }

  const raw = value as Record<string, unknown>;
  return {
    apiKey: clean(raw.apiKey),
    aiModel: clean(raw.aiModel),
  };
}

export async function loadWorkspaceAiCredentialRecords(
  workspaceId: string,
  options: { activeOnly?: boolean } = {},
): Promise<WorkspaceAiCredentialRecord[]> {
  if (!workspaceId) return [];

  await ensureWorkspaceIntegrationsTable();
  const result = await db.query(
    `
      SELECT provider, config, is_active, updated_at
      FROM workspace_integrations
      WHERE workspace_id = $1
        AND provider = ANY($2::text[])
        ${options.activeOnly ? 'AND is_active = true' : ''}
      ORDER BY updated_at DESC
    `,
    [workspaceId, AI_CREDENTIAL_PROVIDERS],
  );

  return result.rows
    .filter((row) => isAiCredentialProvider(row.provider))
    .map((row): WorkspaceAiCredentialRecord => {
      const config = parseWorkspaceAiProviderConfig(row.config);
      const model = normalizeAiCredentialModel(row.provider, config.aiModel)
        || getDefaultAiCredentialModel(row.provider);
      return {
        provider: row.provider,
        apiKey: config.apiKey,
        aiModel: model,
        isActive: row.is_active === true,
        updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      };
    });
}

export async function listWorkspaceConfiguredAiModels(
  workspaceId: string,
): Promise<ConfiguredWorkspaceAiModel[]> {
  const records = await loadWorkspaceAiCredentialRecords(workspaceId, { activeOnly: true });
  const seen = new Set<string>();

  return records
    .filter((record) => record.apiKey.length > 0 && record.aiModel.length > 0)
    .map((record): ConfiguredWorkspaceAiModel | null => {
      const model = normalizeAiCredentialModel(record.provider, record.aiModel);
      if (!model || seen.has(model)) return null;
      seen.add(model);
      return {
        id: model,
        label: formatAiCredentialModelLabel(model),
        provider: getAiCredentialModelProvider(model),
        description: `${getAiCredentialProviderLabel(record.provider)} configurado no workspace.`,
        enabled: true,
        credentialProvider: record.provider,
        providerLabel: getAiCredentialProviderLabel(record.provider),
      };
    })
    .filter((entry): entry is ConfiguredWorkspaceAiModel => Boolean(entry));
}

export async function isWorkspaceConfiguredAiModel(
  workspaceId: string,
  model?: string | null,
): Promise<boolean> {
  const normalized = clean(model);
  if (!workspaceId || !normalized) return false;
  const models = await listWorkspaceConfiguredAiModels(workspaceId);
  return Boolean(resolveConfiguredAiModel(normalized, models));
}
