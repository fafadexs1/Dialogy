import { DEFAULT_AUTOPILOT_MODEL } from '@/lib/ai-models';
import { z } from 'zod';

const decisionSettingsSchema = z.object({ model: z.string().trim().min(1), timeoutMs: z.number().int().min(500).max(15000) });
export const AiDecisionModelConfigSchema = z.object({
  toolIntentGate: decisionSettingsSchema,
  intentClassifier: decisionSettingsSchema,
  workflowClassifier: decisionSettingsSchema,
  fieldExtractor: decisionSettingsSchema,
});

export function assertDecisionModelsAvailable(config: AiDecisionModelConfig, models: Array<{id:string;enabled:boolean}>) {
  for (const role of AI_DECISION_MODEL_ROLES) {
    if (!models.some(model => model.id === config[role.id].model && model.enabled)) {
      throw new Error(`O modelo de ${role.label} precisa estar cadastrado e ativo. Altere a etapa antes de desativar o modelo.`);
    }
  }
}

export const SYSTEM_AI_DECISION_MODELS_KEY = 'ai_decision_model_config';

export type AiDecisionModelRole =
  | 'toolIntentGate'
  | 'intentClassifier'
  | 'workflowClassifier'
  | 'fieldExtractor';

export type AiDecisionModelSettings = {
  model: string;
  timeoutMs: number;
};

export type AiDecisionModelConfig = Record<AiDecisionModelRole, AiDecisionModelSettings>;

export const AI_DECISION_MODEL_ROLES: Array<{
  id: AiDecisionModelRole;
  label: string;
  description: string;
  defaultTimeoutMs: number;
}> = [
  {
    id: 'toolIntentGate',
    label: 'Tool Intent Gate',
    description: 'Decide se transfer_chat e close_chat devem executar agora.',
    defaultTimeoutMs: 2500,
  },
  {
    id: 'intentClassifier',
    label: 'Intent Classifier',
    description: 'Refina a intencao universal quando a regra deterministica esta incerta.',
    defaultTimeoutMs: 1800,
  },
  {
    id: 'workflowClassifier',
    label: 'Workflow Classifier',
    description: 'Decide consultas operacionais opcionais antes da resposta.',
    defaultTimeoutMs: 1800,
  },
  {
    id: 'fieldExtractor',
    label: 'Field Extractor',
    description: 'Le a resposta do cliente e extrai os campos de coleta que as regras deterministicas nao conseguiram identificar.',
    defaultTimeoutMs: 2500,
  },
];

export const DEFAULT_AI_DECISION_MODEL_CONFIG: AiDecisionModelConfig = {
  toolIntentGate: {
    model: DEFAULT_AUTOPILOT_MODEL,
    timeoutMs: 2500,
  },
  intentClassifier: {
    model: DEFAULT_AUTOPILOT_MODEL,
    timeoutMs: 1800,
  },
  workflowClassifier: {
    model: DEFAULT_AUTOPILOT_MODEL,
    timeoutMs: 1800,
  },
  fieldExtractor: {
    model: DEFAULT_AUTOPILOT_MODEL,
    timeoutMs: 2500,
  },
};

function normalizeTimeoutMs(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number.parseInt(value, 10)
      : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(15000, Math.max(500, Math.round(parsed)));
}

function normalizeRoleSettings(
  value: unknown,
  fallback: AiDecisionModelSettings
): AiDecisionModelSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallback;
  }

  const raw = value as Record<string, unknown>;
  const model = typeof raw.model === 'string' && raw.model.trim()
    ? raw.model.trim()
    : fallback.model;

  return {
    model,
    timeoutMs: normalizeTimeoutMs(raw.timeoutMs, fallback.timeoutMs),
  };
}

export function parseAiDecisionModelConfig(
  value?: string | null,
  fallback: AiDecisionModelConfig = DEFAULT_AI_DECISION_MODEL_CONFIG
): AiDecisionModelConfig {
  if (!value || value.trim().length === 0) return fallback;

  try {
    const parsed = JSON.parse(value) as Partial<Record<AiDecisionModelRole, unknown>>;
    return {
      toolIntentGate: normalizeRoleSettings(parsed.toolIntentGate, fallback.toolIntentGate),
      intentClassifier: normalizeRoleSettings(parsed.intentClassifier, fallback.intentClassifier),
      workflowClassifier: normalizeRoleSettings(parsed.workflowClassifier, fallback.workflowClassifier),
      fieldExtractor: normalizeRoleSettings(parsed.fieldExtractor, fallback.fieldExtractor),
    };
  } catch {
    return fallback;
  }
}

export function serializeAiDecisionModelConfig(config: AiDecisionModelConfig): string {
  return JSON.stringify({
    toolIntentGate: normalizeRoleSettings(config.toolIntentGate, DEFAULT_AI_DECISION_MODEL_CONFIG.toolIntentGate),
    intentClassifier: normalizeRoleSettings(config.intentClassifier, DEFAULT_AI_DECISION_MODEL_CONFIG.intentClassifier),
    workflowClassifier: normalizeRoleSettings(config.workflowClassifier, DEFAULT_AI_DECISION_MODEL_CONFIG.workflowClassifier),
    fieldExtractor: normalizeRoleSettings(config.fieldExtractor, DEFAULT_AI_DECISION_MODEL_CONFIG.fieldExtractor),
  }, null, 2);
}
