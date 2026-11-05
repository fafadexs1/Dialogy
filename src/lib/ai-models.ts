export type AiModelProvider = 'googleai' | 'lmstudio' | 'openai' | 'codex' | 'deepseek' | 'anthropic' | 'other';
export type AiModelRuntimeProvider = 'googleai' | 'lmstudio' | 'openai' | 'deepseek' | 'other';

export type AiModelCatalogEntry = {
  id: string;
  label: string;
  provider: AiModelProvider;
  description?: string;
  enabled: boolean;
};

export const SYSTEM_AI_MODEL_CATALOG_KEY = 'ai_model_catalog';
export const DEFAULT_AUTOPILOT_MODEL = 'googleai/gemini-2.5-flash-lite';

export const DEFAULT_AI_MODEL_CATALOG: AiModelCatalogEntry[] = [
  {
    id: 'googleai/gemini-3.5-flash',
    label: 'Gemini 3.5 Flash',
    provider: 'googleai',
    description: 'Modelo Gemini premium para casos em que qualidade pesa mais que custo.',
    enabled: true,
  },
  {
    id: 'googleai/gemini-3.1-flash-lite',
    label: 'Gemini 3.1 Flash-Lite',
    provider: 'googleai',
    description: 'Opcao Gemini economica e estavel para alto volume.',
    enabled: true,
  },
  {
    id: 'googleai/gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    provider: 'googleai',
    description: 'Fallback estavel para alto volume.',
    enabled: true,
  },
  {
    id: 'googleai/gemini-2.5-flash-lite',
    label: 'Gemini 2.5 Flash-Lite',
    provider: 'googleai',
    description: 'Mais barato e rapido para alto volume.',
    enabled: true,
  },
  {
    id: 'googleai/gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    provider: 'googleai',
    description: 'Mais capacidade para instrucoes e contexto complexo.',
    enabled: true,
  },
  {
    id: 'codex/gpt-5.3-codex',
    label: 'Codex GPT-5.3',
    provider: 'codex',
    description: 'Modelo OpenAI otimizado para tarefas agenticas e fluxos complexos.',
    enabled: true,
  },
  {
    id: 'openai/gpt-5.5',
    label: 'OpenAI GPT-5.5',
    provider: 'openai',
    description: 'Modelo OpenAI forte para atendimento, raciocinio e workflows com ferramentas.',
    enabled: true,
  },
  {
    id: 'openai/gpt-5.4-mini',
    label: 'OpenAI GPT-5.4 Mini',
    provider: 'openai',
    description: 'Fallback OpenAI mais rapido e economico.',
    enabled: true,
  },
  {
    id: 'deepseek/deepseek-flash',
    label: 'DeepSeek Flash',
    provider: 'deepseek',
    description: 'Modelo DeepSeek V4.1 com visao nativa e respostas rapidas via API OpenAI-compatible.',
    enabled: true,
  },
  {
    id: 'deepseek/deepseek-v4-flash',
    label: 'DeepSeek V4 Flash',
    provider: 'deepseek',
    description: 'Alias DeepSeek legado para respostas rapidas via API OpenAI-compatible.',
    enabled: true,
  },
  {
    id: 'deepseek/deepseek-v4-pro',
    label: 'DeepSeek V4 Pro',
    provider: 'deepseek',
    description: 'Modelo DeepSeek de maior capacidade via API OpenAI-compatible.',
    enabled: true,
  },
];

const PROVIDER_LABELS: Record<AiModelProvider, string> = {
  googleai: 'Gemini',
  lmstudio: 'LM Studio',
  openai: 'OpenAI',
  codex: 'Codex',
  deepseek: 'DeepSeek',
  anthropic: 'Anthropic',
  other: 'Outro',
};

function normalizeProvider(value: unknown): AiModelProvider {
  if (
    value === 'googleai' ||
    value === 'lmstudio' ||
    value === 'openai' ||
    value === 'codex' ||
    value === 'deepseek' ||
    value === 'anthropic' ||
    value === 'other'
  ) {
    return value;
  }
  return 'other';
}

function getCatalogProviderPrefix(provider: AiModelProvider): string | null {
  if (provider === 'googleai') return 'googleai';
  if (provider === 'lmstudio') return 'lmstudio';
  if (provider === 'openai') return 'openai';
  if (provider === 'codex') return 'codex';
  if (provider === 'deepseek') return 'deepseek';
  return null;
}

function normalizeEntry(entry: unknown): AiModelCatalogEntry | null {
  if (!entry || typeof entry !== 'object') return null;

  const raw = entry as Partial<AiModelCatalogEntry>;
  const rawId = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!rawId) return null;
  const provider = normalizeProvider(raw.provider);
  const prefix = getCatalogProviderPrefix(provider);
  const id = provider === 'lmstudio' && !rawId.startsWith('lmstudio/')
    ? `lmstudio/${rawId}`
    : prefix && !rawId.startsWith(`${prefix}/`) && !rawId.includes('/')
      ? `${prefix}/${rawId}`
      : rawId;

  const label = typeof raw.label === 'string' && raw.label.trim().length > 0
    ? raw.label.trim()
    : id;

  return {
    id,
    label,
    provider,
    description: typeof raw.description === 'string' ? raw.description.trim() : undefined,
    enabled: raw.enabled !== false,
  };
}

export function parseAiModelCatalog(value?: string | null): AiModelCatalogEntry[] {
  if (!value || value.trim().length === 0) {
    return DEFAULT_AI_MODEL_CATALOG;
  }

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return DEFAULT_AI_MODEL_CATALOG;
    }

    const seen = new Set<string>();
    const catalog = parsed
      .map(normalizeEntry)
      .filter((entry): entry is AiModelCatalogEntry => Boolean(entry))
      .filter((entry) => {
        if (seen.has(entry.id)) return false;
        seen.add(entry.id);
        return true;
      });

    return catalog.length > 0 ? catalog : DEFAULT_AI_MODEL_CATALOG;
  } catch {
    return DEFAULT_AI_MODEL_CATALOG;
  }
}

export function serializeAiModelCatalog(catalog: AiModelCatalogEntry[]): string {
  const normalized = catalog
    .map(normalizeEntry)
    .filter((entry): entry is AiModelCatalogEntry => Boolean(entry));

  return JSON.stringify(normalized, null, 2);
}

export function isPreviewAiModel(id: string): boolean {
  return /\bpreview\b|\bexperimental\b|\balpha\b|\bbeta\b/i.test(id);
}

export function getAiModelRuntimeProvider(id?: string | null): AiModelRuntimeProvider {
  const normalized = id?.trim() || '';
  if (normalized.startsWith('googleai/')) return 'googleai';
  if (normalized.startsWith('lmstudio/')) return 'lmstudio';
  if (normalized.startsWith('openai/') || normalized.startsWith('codex/')) return 'openai';
  if (normalized.startsWith('deepseek/')) return 'deepseek';
  return 'other';
}

export function isAutopilotRuntimeSupportedModel(entry: AiModelCatalogEntry): boolean {
  const runtimeProvider = getAiModelRuntimeProvider(entry.id);
  const hasSupportedProviderPrefix = runtimeProvider !== 'other';
  return hasSupportedProviderPrefix && !isPreviewAiModel(entry.id);
}

export function getEnabledAiModels(catalog: AiModelCatalogEntry[]): AiModelCatalogEntry[] {
  return catalog.filter((entry) => entry.enabled);
}

export function getAutopilotSelectableModels(catalog: AiModelCatalogEntry[]): AiModelCatalogEntry[] {
  const supported = getEnabledAiModels(catalog).filter(isAutopilotRuntimeSupportedModel);
  return supported.length > 0
    ? supported
    : DEFAULT_AI_MODEL_CATALOG.filter((entry) => entry.enabled && isAutopilotRuntimeSupportedModel(entry));
}

export function normalizeGoogleAiModelId(model?: string | null): string | null {
  const normalized = model?.trim() || '';
  if (!normalized) return null;
  if (normalized.startsWith('googleai/')) return normalized;
  if (normalized.startsWith('models/')) return `googleai/${normalized.replace(/^models\//, '')}`;
  if (normalized.includes('/')) return null;
  return `googleai/${normalized}`;
}

export function getGoogleAiSdkModelName(model?: string | null): string | null {
  return normalizeGoogleAiModelId(model)?.replace(/^googleai\//, '') || null;
}

export function getWorkspaceGeminiSelectableModels(catalog: AiModelCatalogEntry[]): AiModelCatalogEntry[] {
  const selectable = getEnabledAiModels(catalog).filter((entry) => (
    entry.provider === 'googleai' && entry.id.startsWith('googleai/')
  ));

  return selectable.length > 0
    ? selectable
    : DEFAULT_AI_MODEL_CATALOG.filter((entry) => entry.enabled && entry.provider === 'googleai');
}

export function getWorkspaceProviderSelectableModels(
  catalog: AiModelCatalogEntry[],
  providers: AiModelProvider[]
): AiModelCatalogEntry[] {
  const providerSet = new Set(providers);
  const selectable = getEnabledAiModels(catalog).filter((entry) => (
    providerSet.has(entry.provider) && isAutopilotRuntimeSupportedModel(entry)
  ));

  return selectable.length > 0
    ? selectable
    : DEFAULT_AI_MODEL_CATALOG.filter((entry) => (
        entry.enabled &&
        providerSet.has(entry.provider) &&
        isAutopilotRuntimeSupportedModel(entry)
      ));
}

export function getAiModelById(
  catalog: AiModelCatalogEntry[],
  id?: string | null
): AiModelCatalogEntry | null {
  if (!id) return null;
  return catalog.find((entry) => entry.id === id) || null;
}

export function getAiModelLabel(
  id?: string | null,
  catalog: AiModelCatalogEntry[] = DEFAULT_AI_MODEL_CATALOG
): string {
  const entry = getAiModelById(catalog, id);
  if (entry) return entry.label;
  if (!id) return getAiModelById(catalog, DEFAULT_AUTOPILOT_MODEL)?.label || 'Modelo padrao';

  const [, suffix] = id.split('/');
  return suffix || id;
}

export function getAiModelProviderLabel(provider: AiModelProvider): string {
  return PROVIDER_LABELS[provider];
}

export const KNOWN_MODEL_ALIASES: Record<string, string> = {
  'deepseek/deepseek-v4-flash': 'deepseek/deepseek-flash',
  'deepseek/deepseek-v4-pro': 'deepseek/deepseek-flash',
  'deepseek-v4-flash': 'deepseek/deepseek-flash',
  'deepseek-v4-pro': 'deepseek/deepseek-flash',
  'deepseek-flash': 'deepseek/deepseek-flash',
  'deepseek-chat': 'deepseek/deepseek-flash',
  'deepseek/deepseek-chat': 'deepseek/deepseek-flash',
  'openai/gpt-4o': 'openai/gpt-5.5',
  'openai/gpt-4o-mini': 'openai/gpt-5.4-mini',
  'gpt-5.4-mini': 'openai/gpt-5.4-mini',
  'gpt-5.5': 'openai/gpt-5.5',
  'gpt-5.3-codex': 'codex/gpt-5.3-codex',
  'gemini-3.1-flash-lite': 'googleai/gemini-3.1-flash-lite',
  'gemini-2.5-flash-lite': 'googleai/gemini-2.5-flash-lite',
  'gemini-2.5-flash': 'googleai/gemini-2.5-flash',
  'gemini-3.5-flash': 'googleai/gemini-3.5-flash',
};

export function resolveConfiguredAiModel(
  requested?: string | null,
  availableModels: { id: string; provider?: string; credentialProvider?: string }[] = [],
  fallback?: string | null,
): string | null {
  if (!availableModels || availableModels.length === 0) return null;

  const cleanReq = (requested || '').trim();
  const cleanFallback = (fallback || '').trim();

  // 1. Direct exact match with requested
  if (cleanReq && availableModels.some((m) => m.id === cleanReq)) {
    return cleanReq;
  }

  // 2. Direct alias match for requested
  if (cleanReq && KNOWN_MODEL_ALIASES[cleanReq]) {
    const aliased = KNOWN_MODEL_ALIASES[cleanReq];
    if (availableModels.some((m) => m.id === aliased)) {
      return aliased;
    }
  }

  // 3. Provider-level match for requested
  if (cleanReq) {
    const reqProvider = getAiModelRuntimeProvider(cleanReq);
    if (reqProvider !== 'other') {
      const match = availableModels.find((m) => {
        const mProvider = getAiModelRuntimeProvider(m.id);
        return mProvider === reqProvider || m.provider === reqProvider || m.credentialProvider === reqProvider;
      });
      if (match) return match.id;
    }
  }

  // 4. Exact match with fallback
  if (cleanFallback && availableModels.some((m) => m.id === cleanFallback)) {
    return cleanFallback;
  }

  // 5. Alias match for fallback
  if (cleanFallback && KNOWN_MODEL_ALIASES[cleanFallback]) {
    const aliased = KNOWN_MODEL_ALIASES[cleanFallback];
    if (availableModels.some((m) => m.id === aliased)) {
      return aliased;
    }
  }

  // 6. Provider-level match for fallback
  if (cleanFallback) {
    const fallbackProvider = getAiModelRuntimeProvider(cleanFallback);
    if (fallbackProvider !== 'other') {
      const match = availableModels.find((m) => {
        const mProvider = getAiModelRuntimeProvider(m.id);
        return mProvider === fallbackProvider || m.provider === fallbackProvider || m.credentialProvider === fallbackProvider;
      });
      if (match) return match.id;
    }
  }

  // 7. Fallback to first available configured model
  return availableModels[0]?.id || null;
}
