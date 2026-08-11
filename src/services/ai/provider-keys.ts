import { db } from '@/lib/db';
import type { AiModelRuntimeProvider } from '@/lib/ai-models';
import type { AiModelKeyCandidate } from './model-client';

type WorkspaceProvider = 'gemini' | 'openai' | 'deepseek';

type WorkspaceProviderConfig = {
  apiKey?: string;
  aiModel?: string;
};

type ResolveAiProviderKeyCandidatesInput = {
  config?: {
    workspace_id?: string | null;
    gemini_api_key?: string | null;
  } | null;
  workspaceGeminiApiKey?: string | null;
};

function cleanKey(value?: string | null): string {
  const key = value?.trim() || '';
  return key === 'no-key-configured' ? '' : key;
}

function parseProviderConfig(value: unknown): WorkspaceProviderConfig {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      return parseProviderConfig(JSON.parse(value));
    } catch {
      return {};
    }
  }
  if (typeof value !== 'object' || Array.isArray(value)) return {};

  const raw = value as Record<string, unknown>;
  return {
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey.trim() : undefined,
    aiModel: typeof raw.aiModel === 'string' ? raw.aiModel.trim() : undefined,
  };
}

export function getDefaultGeminiEnvKey(): string {
  return cleanKey(process.env.GOOGLE_GENAI_API_KEY) || cleanKey(process.env.GEMINI_API_KEY);
}

export function getDefaultOpenAiEnvKey(): string {
  return cleanKey(process.env.OPENAI_API_KEY) || cleanKey(process.env.CODEX_API_KEY);
}

export function getDefaultDeepSeekEnvKey(): string {
  return cleanKey(process.env.DEEPSEEK_API_KEY);
}

async function loadWorkspaceProviderConfigs(
  workspaceId?: string | null
): Promise<Partial<Record<WorkspaceProvider, WorkspaceProviderConfig>>> {
  if (!workspaceId) return {};

  try {
    const result = await db.query(
      `
        SELECT provider, config
        FROM workspace_integrations
        WHERE workspace_id = $1
          AND provider = ANY($2::text[])
          AND is_active = true
      `,
      [workspaceId, ['gemini', 'openai', 'deepseek']]
    );

    return Object.fromEntries(
      result.rows.map((row) => [
        row.provider as WorkspaceProvider,
        parseProviderConfig(row.config),
      ])
    );
  } catch (error) {
    console.error('[AI_PROVIDER_KEYS] Failed to load workspace AI provider keys:', error);
    return {};
  }
}

function candidate(
  source: string,
  provider: AiModelRuntimeProvider,
  key?: string | null
): AiModelKeyCandidate | null {
  const cleaned = cleanKey(key);
  return cleaned ? { source, provider, key: cleaned } : null;
}

export async function resolveAiProviderKeyCandidates(
  input: ResolveAiProviderKeyCandidatesInput
): Promise<AiModelKeyCandidate[]> {
  const workspaceConfigs = await loadWorkspaceProviderConfigs(input.config?.workspace_id);
  const workspaceGeminiKey = cleanKey(input.workspaceGeminiApiKey)
    || cleanKey(input.config?.gemini_api_key)
    || cleanKey(workspaceConfigs.gemini?.apiKey);

  return [
    candidate('workspace-gemini', 'googleai', workspaceGeminiKey),
    candidate('env-gemini', 'googleai', getDefaultGeminiEnvKey()),
    candidate('workspace-openai', 'openai', workspaceConfigs.openai?.apiKey),
    candidate('env-openai', 'openai', getDefaultOpenAiEnvKey()),
    candidate('workspace-deepseek', 'deepseek', workspaceConfigs.deepseek?.apiKey),
    candidate('env-deepseek', 'deepseek', getDefaultDeepSeekEnvKey()),
  ].filter((item): item is AiModelKeyCandidate => Boolean(item));
}
