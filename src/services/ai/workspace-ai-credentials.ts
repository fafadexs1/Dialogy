import { db } from '@/lib/db';
import { platformModel, platformApiKey, readPlatformAiConfig } from './platform-config';
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
  const model = await platformModel();
  const provider = model.id.startsWith('googleai/') ? 'gemini' : model.id.startsWith('deepseek/') ? 'deepseek' : 'openai';
  return [{ provider, apiKey: await platformApiKey(model.id), aiModel: model.id, isActive: true, updatedAt: null }];
}

export async function listWorkspaceConfiguredAiModels(
  workspaceId: string,
): Promise<ConfiguredWorkspaceAiModel[]> {
  if (!workspaceId) return [];
  // Browsing agents must not depend on an execution-ready platform model.
  const config = await readPlatformAiConfig();
  if (!config) return [];
  const selected = config.models.find(model => model.id === config.defaultModel && model.enabled)!;
  const provider = selected.id.startsWith('googleai/') ? 'gemini' : selected.id.startsWith('deepseek/') ? 'deepseek' : 'openai';
  return [{ id: selected.id, label: 'IA Dialogy', enabled: true, provider: getAiCredentialModelProvider(provider),
    credentialProvider: provider, providerLabel: 'Dialogy' }];

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
