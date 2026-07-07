import {
  getAiModelRuntimeProvider,
  type AiModelRuntimeProvider,
} from '@/lib/ai-models';
import {
  AiModelClientError,
  classifyAiModelError,
  type AiModelAttemptSummary,
  type AiModelErrorClassification,
} from './model-errors';

export type AiModelKeyCandidate = {
  source: string;
  key: string;
  provider?: AiModelRuntimeProvider;
};

export type AiModelAttemptContext = {
  label: string;
  model: string;
  keySource: string;
  apiKey: string;
  attempt: number;
};

export type AiModelAttemptEvent = AiModelAttemptSummary & {
  label: string;
};

export type RunAiModelWithFallbackInput<T> = {
  label: string;
  modelCandidates: string[];
  apiKeyCandidates: AiModelKeyCandidate[];
  maxAttemptsPerCandidate?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  execute: (context: AiModelAttemptContext) => Promise<T>;
  onAttempt?: (event: AiModelAttemptEvent) => void;
};

export type RunAiModelWithFallbackResult<T> = {
  result: T;
  model: string;
  keySource: string;
  attempts: AiModelAttemptSummary[];
};

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function uniqueApiKeyCandidates(candidates: AiModelKeyCandidate[]): AiModelKeyCandidate[] {
  const seen = new Set<string>();
  const result: AiModelKeyCandidate[] = [];

  for (const candidate of candidates) {
    const key = candidate.key?.trim();
    const source = candidate.source?.trim() || 'unknown';
    const provider = candidate.provider || 'other';
    const signature = `${provider}:${key}`;
    if (!key || seen.has(signature)) continue;
    seen.add(signature);
    result.push({ source, key, provider: candidate.provider });
  }

  return result;
}

function isKeyCompatibleWithModel(candidate: AiModelKeyCandidate, model: string): boolean {
  if (!candidate.provider) return true;
  return candidate.provider === getAiModelRuntimeProvider(model);
}

function keySignature(candidate: AiModelKeyCandidate): string {
  return `${candidate.provider || 'any'}:${candidate.key}`;
}

function sleep(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(baseDelayMs: number, maxDelayMs: number, attempt: number) {
  const exponential = baseDelayMs * 2 ** Math.max(0, attempt - 1);
  const jitter = exponential * 0.2 * Math.random();
  return Math.min(maxDelayMs, Math.round(exponential + jitter));
}

function buildAttemptSummary(input: {
  model: string;
  keySource: string;
  attempt: number;
  durationMs: number;
  classification?: AiModelErrorClassification;
}): AiModelAttemptSummary {
  if (!input.classification) {
    return {
      model: input.model,
      keySource: input.keySource,
      attempt: input.attempt,
      durationMs: input.durationMs,
      status: 'success',
    };
  }

  return {
    model: input.model,
    keySource: input.keySource,
    attempt: input.attempt,
    durationMs: input.durationMs,
    status: 'error',
    errorCode: input.classification.code,
    errorMessage: input.classification.message,
    retryable: input.classification.retryable,
  };
}

export async function runAiModelWithFallback<T>(
  input: RunAiModelWithFallbackInput<T>
): Promise<RunAiModelWithFallbackResult<T>> {
  const models = uniqueNonEmpty(input.modelCandidates);
  const keys = uniqueApiKeyCandidates(input.apiKeyCandidates);
  const maxAttemptsPerCandidate = Math.max(1, input.maxAttemptsPerCandidate || 2);
  const retryBaseDelayMs = input.retryBaseDelayMs ?? 250;
  const retryMaxDelayMs = input.retryMaxDelayMs ?? 1500;
  const attempts: AiModelAttemptSummary[] = [];

  if (models.length === 0) {
    throw new AiModelClientError('No AI model candidate configured.', {
      code: 'model_unavailable',
      retryable: false,
      attempts,
    });
  }

  if (keys.length === 0) {
    throw new AiModelClientError('No AI API key candidate configured.', {
      code: 'auth_error',
      retryable: false,
      attempts,
    });
  }

  let lastError: unknown = null;
  let attemptedCompatiblePair = false;
  const authFailedKeys = new Set<string>();

  for (const model of models) {
    for (const keyCandidate of keys) {
      const signature = keySignature(keyCandidate);
      if (authFailedKeys.has(signature)) {
        continue;
      }
      if (!isKeyCompatibleWithModel(keyCandidate, model)) {
        continue;
      }
      attemptedCompatiblePair = true;

      for (let attempt = 1; attempt <= maxAttemptsPerCandidate; attempt += 1) {
        const startedAt = Date.now();

        try {
          const result = await input.execute({
            label: input.label,
            model,
            keySource: keyCandidate.source,
            apiKey: keyCandidate.key,
            attempt,
          });
          const summary = buildAttemptSummary({
            model,
            keySource: keyCandidate.source,
            attempt,
            durationMs: Date.now() - startedAt,
          });
          attempts.push(summary);
          input.onAttempt?.({ ...summary, label: input.label });
          return {
            result,
            model,
            keySource: keyCandidate.source,
            attempts,
          };
        } catch (error) {
          lastError = error;
          const classification = classifyAiModelError(error);
          const summary = buildAttemptSummary({
            model,
            keySource: keyCandidate.source,
            attempt,
            durationMs: Date.now() - startedAt,
            classification,
          });
          attempts.push(summary);
          input.onAttempt?.({ ...summary, label: input.label });

          if (!classification.retryable || attempt >= maxAttemptsPerCandidate) {
            if (classification.code === 'auth_error') {
              authFailedKeys.add(signature);
              break;
            }
            break;
          }

          await sleep(retryDelayMs(retryBaseDelayMs, retryMaxDelayMs, attempt));
        }
      }
    }
  }

  if (!attemptedCompatiblePair) {
    throw new AiModelClientError('No AI API key candidate configured for the selected model provider(s).', {
      code: 'auth_error',
      retryable: false,
      attempts,
    });
  }

  const classification = classifyAiModelError(lastError);
  throw new AiModelClientError(
    `AI model call failed after ${attempts.length} attempt(s): ${classification.message}`,
    {
      code: classification.code,
      retryable: classification.retryable,
      status: classification.status,
      cause: lastError,
      attempts,
    }
  );
}

export function assertAiModelOutput<T>(value: T | null | undefined, message = 'AI model returned no output.'): T {
  if (value == null) {
    throw new AiModelClientError(message, {
      code: 'empty_response',
      retryable: true,
    });
  }

  return value;
}

