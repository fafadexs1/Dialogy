import type { AiModelKeyCandidate } from './model-client';
import { platformApiKey, platformModel } from './platform-config';
import { getAiModelRuntimeProvider } from '@/lib/ai-models';

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

export function getDefaultGeminiEnvKey(): string {
  return cleanKey(process.env.GOOGLE_GENAI_API_KEY) || cleanKey(process.env.GEMINI_API_KEY);
}

export function getDefaultOpenAiEnvKey(): string {
  return cleanKey(process.env.OPENAI_API_KEY) || cleanKey(process.env.CODEX_API_KEY);
}

export function getDefaultDeepSeekEnvKey(): string {
  return cleanKey(process.env.DEEPSEEK_API_KEY);
}

export async function resolveAiProviderKeyCandidates(
  _input: ResolveAiProviderKeyCandidatesInput
): Promise<AiModelKeyCandidate[]> {
  const model = await platformModel();
  return [{ source: 'platform', provider: getAiModelRuntimeProvider(model.id), key: await platformApiKey(model.id) }];
}
