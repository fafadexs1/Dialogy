export type AiModelProvider = 'googleai' | 'openai' | 'anthropic' | 'other';

export type AiModelCatalogEntry = {
  id: string;
  label: string;
  provider: AiModelProvider;
  description?: string;
  enabled: boolean;
};

export const SYSTEM_AI_MODEL_CATALOG_KEY = 'ai_model_catalog';
export const DEFAULT_AUTOPILOT_MODEL = 'googleai/gemini-2.0-flash';

export const DEFAULT_AI_MODEL_CATALOG: AiModelCatalogEntry[] = [
  {
    id: 'googleai/gemini-2.0-flash',
    label: 'Gemini 2.0 Flash',
    provider: 'googleai',
    description: 'Equilibrado para atendimento em tempo real.',
    enabled: true,
  },
  {
    id: 'googleai/gemini-2.5-flash-lite',
    label: 'Gemini 2.5 Flash Lite',
    provider: 'googleai',
    description: 'Mais barato e rapido para alto volume.',
    enabled: true,
  },
  {
    id: 'googleai/gemini-1.5-pro',
    label: 'Gemini 1.5 Pro',
    provider: 'googleai',
    description: 'Mais capacidade para instrucoes e contexto complexo.',
    enabled: true,
  },
  {
    id: 'googleai/gemini-3-flash-preview',
    label: 'Gemini 3 Flash',
    provider: 'googleai',
    description: 'Preview experimental.',
    enabled: true,
  },
];

const PROVIDER_LABELS: Record<AiModelProvider, string> = {
  googleai: 'Gemini',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  other: 'Outro',
};

function normalizeProvider(value: unknown): AiModelProvider {
  if (value === 'googleai' || value === 'openai' || value === 'anthropic' || value === 'other') {
    return value;
  }
  return 'other';
}

function normalizeEntry(entry: unknown): AiModelCatalogEntry | null {
  if (!entry || typeof entry !== 'object') return null;

  const raw = entry as Partial<AiModelCatalogEntry>;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!id) return null;

  const label = typeof raw.label === 'string' && raw.label.trim().length > 0
    ? raw.label.trim()
    : id;

  return {
    id,
    label,
    provider: normalizeProvider(raw.provider),
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

export function isAutopilotRuntimeSupportedModel(entry: AiModelCatalogEntry): boolean {
  return entry.provider === 'googleai' && entry.id.startsWith('googleai/');
}

export function getEnabledAiModels(catalog: AiModelCatalogEntry[]): AiModelCatalogEntry[] {
  return catalog.filter((entry) => entry.enabled);
}

export function getAutopilotSelectableModels(catalog: AiModelCatalogEntry[]): AiModelCatalogEntry[] {
  const supported = getEnabledAiModels(catalog).filter(isAutopilotRuntimeSupportedModel);
  return supported.length > 0 ? supported : DEFAULT_AI_MODEL_CATALOG;
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
