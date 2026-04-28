import { db } from '@/lib/db';
import {
  DEFAULT_AUTOPILOT_MODEL,
  getAutopilotSelectableModels,
  parseAiModelCatalog,
  SYSTEM_AI_MODEL_CATALOG_KEY,
  type AiModelCatalogEntry,
} from '@/lib/ai-models';

export type ResolvedAutopilotModel = {
  model: string;
  requestedModel?: string | null;
  fallbackUsed: boolean;
  catalog: AiModelCatalogEntry[];
};

export async function getGlobalAutopilotModelCatalog(): Promise<AiModelCatalogEntry[]> {
  const result = await db.query(
    'SELECT value FROM public.system_settings WHERE key = $1 LIMIT 1',
    [SYSTEM_AI_MODEL_CATALOG_KEY]
  );

  return parseAiModelCatalog(result.rows[0]?.value || null);
}

export async function resolveAutopilotModelFromCatalog(
  requestedModel?: string | null
): Promise<ResolvedAutopilotModel> {
  const catalog = await getGlobalAutopilotModelCatalog();
  const selectable = getAutopilotSelectableModels(catalog);
  const normalizedRequested = requestedModel?.trim() || null;

  if (normalizedRequested && selectable.some((entry) => entry.id === normalizedRequested)) {
    return {
      model: normalizedRequested,
      requestedModel: normalizedRequested,
      fallbackUsed: false,
      catalog,
    };
  }

  return {
    model: selectable[0]?.id || DEFAULT_AUTOPILOT_MODEL,
    requestedModel: normalizedRequested,
    fallbackUsed: Boolean(normalizedRequested),
    catalog,
  };
}

export async function isAllowedAutopilotModel(model?: string | null): Promise<boolean> {
  if (!model || model.trim().length === 0) return false;
  const resolved = await resolveAutopilotModelFromCatalog(model);
  return !resolved.fallbackUsed && resolved.model === model.trim();
}
