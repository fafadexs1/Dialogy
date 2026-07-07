import {
  DEFAULT_AUTOPILOT_MODEL,
  getAiModelRuntimeProvider,
  normalizeGoogleAiModelId,
  type AiModelProvider,
  type AiModelRuntimeProvider,
} from '@/lib/ai-models';

export type AiCredentialProvider = 'gemini' | 'openai' | 'deepseek';

export const AI_CREDENTIAL_PROVIDERS: AiCredentialProvider[] = ['gemini', 'openai', 'deepseek'];

export const AI_CREDENTIAL_PROVIDER_META: Record<AiCredentialProvider, {
  label: string;
  defaultModel: string;
  modelProviders: AiModelProvider[];
  runtimeProvider: AiModelRuntimeProvider;
}> = {
  gemini: {
    label: 'Gemini',
    defaultModel: DEFAULT_AUTOPILOT_MODEL,
    modelProviders: ['googleai'],
    runtimeProvider: 'googleai',
  },
  openai: {
    label: 'OpenAI / Codex',
    defaultModel: 'openai/gpt-5.4-mini',
    modelProviders: ['openai', 'codex'],
    runtimeProvider: 'openai',
  },
  deepseek: {
    label: 'DeepSeek',
    defaultModel: 'deepseek/deepseek-v4-flash',
    modelProviders: ['deepseek'],
    runtimeProvider: 'deepseek',
  },
};

export function isAiCredentialProvider(value: unknown): value is AiCredentialProvider {
  return value === 'gemini' || value === 'openai' || value === 'deepseek';
}

export function getDefaultAiCredentialModel(provider: AiCredentialProvider): string {
  return AI_CREDENTIAL_PROVIDER_META[provider].defaultModel;
}

export function getAiCredentialProviderLabel(provider: AiCredentialProvider): string {
  return AI_CREDENTIAL_PROVIDER_META[provider].label;
}

export function normalizeAiCredentialModel(
  provider: AiCredentialProvider,
  model?: string | null,
): string | null {
  const normalized = model?.trim() || '';
  if (!normalized) return null;

  if (provider === 'gemini') {
    return normalizeGoogleAiModelId(normalized);
  }

  if (provider === 'deepseek') {
    if (normalized.startsWith('deepseek/')) return normalized;
    if (normalized.includes('/')) return null;
    return `deepseek/${normalized}`;
  }

  if (normalized.startsWith('openai/') || normalized.startsWith('codex/')) {
    return normalized;
  }
  if (normalized.includes('/')) return null;
  return `openai/${normalized}`;
}

export function getAiCredentialModelProvider(model: string): AiModelProvider {
  if (model.startsWith('googleai/')) return 'googleai';
  if (model.startsWith('codex/')) return 'codex';
  if (model.startsWith('openai/')) return 'openai';
  if (model.startsWith('deepseek/')) return 'deepseek';

  const runtimeProvider = getAiModelRuntimeProvider(model);
  if (runtimeProvider === 'googleai') return 'googleai';
  if (runtimeProvider === 'openai') return 'openai';
  if (runtimeProvider === 'deepseek') return 'deepseek';
  return 'other';
}

export function formatAiCredentialModelLabel(model: string): string {
  const suffix = model.split('/').pop() || model;
  return suffix
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
