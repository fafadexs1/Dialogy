import { db } from '@/lib/db';
import {
  DEFAULT_AI_DECISION_MODEL_CONFIG,
  parseAiDecisionModelConfig,
  SYSTEM_AI_DECISION_MODELS_KEY,
  type AiDecisionModelConfig,
  type AiDecisionModelRole,
} from '@/lib/ai-decision-models';
import { DEFAULT_AUTOPILOT_MODEL } from '@/lib/ai-models';

function envModelForRole(role: AiDecisionModelRole): string | undefined {
  if (role === 'toolIntentGate') return process.env.AI_TOOL_INTENT_GATE_MODEL?.trim() || undefined;
  if (role === 'intentClassifier') return process.env.AI_INTENT_CLASSIFIER_MODEL?.trim() || undefined;
  if (role === 'fieldExtractor') return process.env.AI_FIELD_EXTRACTOR_MODEL?.trim() || undefined;
  return process.env.AI_WORKFLOW_CLASSIFIER_MODEL?.trim() || undefined;
}

function envTimeoutForRole(role: AiDecisionModelRole): number | undefined {
  const raw = role === 'toolIntentGate'
    ? process.env.AI_TOOL_INTENT_GATE_TIMEOUT_MS
    : role === 'intentClassifier'
      ? process.env.AI_INTENT_CLASSIFIER_TIMEOUT_MS
      : role === 'fieldExtractor'
        ? process.env.AI_FIELD_EXTRACTOR_TIMEOUT_MS
        : process.env.AI_WORKFLOW_CLASSIFIER_TIMEOUT_MS;
  const parsed = Number.parseInt(raw || '', 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function buildEnvFallbackConfig(): AiDecisionModelConfig {
  return {
    toolIntentGate: {
      model: envModelForRole('toolIntentGate') || DEFAULT_AI_DECISION_MODEL_CONFIG.toolIntentGate.model || DEFAULT_AUTOPILOT_MODEL,
      timeoutMs: envTimeoutForRole('toolIntentGate') || DEFAULT_AI_DECISION_MODEL_CONFIG.toolIntentGate.timeoutMs,
    },
    intentClassifier: {
      model: envModelForRole('intentClassifier') || DEFAULT_AI_DECISION_MODEL_CONFIG.intentClassifier.model || DEFAULT_AUTOPILOT_MODEL,
      timeoutMs: envTimeoutForRole('intentClassifier') || DEFAULT_AI_DECISION_MODEL_CONFIG.intentClassifier.timeoutMs,
    },
    workflowClassifier: {
      model: envModelForRole('workflowClassifier') || DEFAULT_AI_DECISION_MODEL_CONFIG.workflowClassifier.model || DEFAULT_AUTOPILOT_MODEL,
      timeoutMs: envTimeoutForRole('workflowClassifier') || DEFAULT_AI_DECISION_MODEL_CONFIG.workflowClassifier.timeoutMs,
    },
    fieldExtractor: {
      model: envModelForRole('fieldExtractor') || DEFAULT_AI_DECISION_MODEL_CONFIG.fieldExtractor.model || DEFAULT_AUTOPILOT_MODEL,
      timeoutMs: envTimeoutForRole('fieldExtractor') || DEFAULT_AI_DECISION_MODEL_CONFIG.fieldExtractor.timeoutMs,
    },
  };
}

export async function getGlobalAiDecisionModelConfig(): Promise<AiDecisionModelConfig> {
  const fallback = buildEnvFallbackConfig();

  try {
    const result = await db.query(
      'SELECT value FROM public.system_settings WHERE key = $1 LIMIT 1',
      [SYSTEM_AI_DECISION_MODELS_KEY]
    );
    return parseAiDecisionModelConfig(result.rows[0]?.value || null, fallback);
  } catch (error) {
    console.error('[AI_DECISION_MODELS] Failed to load global decision model config:', error);
    return fallback;
  }
}

export async function resolveAiDecisionModel(
  role: AiDecisionModelRole,
  fallbackModel?: string | null
): Promise<string> {
  const config = await getGlobalAiDecisionModelConfig();
  return config[role]?.model || fallbackModel?.trim() || envModelForRole(role) || DEFAULT_AUTOPILOT_MODEL;
}

export async function resolveAiDecisionTimeoutMs(
  role: AiDecisionModelRole,
  fallbackTimeoutMs?: number | null
): Promise<number> {
  const config = await getGlobalAiDecisionModelConfig();
  return config[role]?.timeoutMs || fallbackTimeoutMs || envTimeoutForRole(role) || DEFAULT_AI_DECISION_MODEL_CONFIG[role].timeoutMs;
}
