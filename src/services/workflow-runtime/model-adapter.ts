import type { z } from 'zod';
import type {
  ModelCapabilityProfile,
  ModelConfiguration,
} from './types';
import { normalizeRuntimeError } from './utils';

export type ModelRole = 'system' | 'user' | 'assistant' | 'tool';

export type ModelMessage = {
  role: ModelRole;
  content: string;
  name?: string;
  toolCallId?: string;
};

export type ModelToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type ModelToolRequest = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ModelUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type ModelInfo = {
  id: string;
  ownedBy?: string;
  loaded?: boolean;
  contextWindow?: number;
  capabilities?: ModelCapabilityProfile;
};

export type ModelHealth = {
  ok: boolean;
  latencyMs: number;
  error?: string;
  models?: string[];
};

export type GenerateRequest = {
  model: string;
  messages: ModelMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  tools?: ModelToolDefinition[];
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type GenerateResult = {
  model: string;
  text: string;
  toolRequests: ModelToolRequest[];
  usage?: ModelUsage;
  finishReason?: string;
  raw?: unknown;
};

export type StructuredGenerateRequest<T> = GenerateRequest & {
  schema: z.ZodType<T>;
  schemaName: string;
  jsonSchema?: Record<string, unknown>;
};

export type ModelStreamEvent =
  | { type: 'started'; model: string }
  | { type: 'text_delta'; model: string; text: string }
  | { type: 'completed'; model: string; usage?: ModelUsage }
  | { type: 'error'; model: string; error: string };

export interface ModelAdapter {
  listModels(): Promise<ModelInfo[]>;
  healthCheck(): Promise<ModelHealth>;
  generate(request: GenerateRequest): Promise<GenerateResult>;
  generateStructured<T>(request: StructuredGenerateRequest<T>): Promise<T>;
  stream(request: GenerateRequest): AsyncIterable<ModelStreamEvent>;
  supportsTools(model: string): Promise<boolean>;
  supportsStructuredOutput(model: string): Promise<boolean>;
}

export type ModelCandidate = {
  adapter: ModelAdapter;
  config: ModelConfiguration;
  label?: string;
};

export type ModelFallbackAttempt = {
  model: string;
  provider: string;
  status: 'failed' | 'selected';
  errorCode?: string;
  errorMessage?: string;
};

export type ModelFallbackResult<T> = {
  output: T;
  selected: ModelCandidate;
  attempts: ModelFallbackAttempt[];
};

export type ModelFallbackHooks = {
  onFallback?: (input: {
    from: ModelCandidate;
    to: ModelCandidate;
    error: ReturnType<typeof normalizeRuntimeError>;
  }) => void | Promise<void>;
};

const FALLBACK_ERROR_CODES = new Set([
  'MODEL_UNAVAILABLE',
  'MODEL_TIMEOUT',
  'TIMEOUT',
  'INVALID_STRUCTURED_OUTPUT',
  'MODEL_SCHEMA_VALIDATION_FAILED',
  'NETWORK_ERROR',
  'UPSTREAM_UNAVAILABLE',
]);

function isFallbackEligible(error: ReturnType<typeof normalizeRuntimeError>) {
  return error.retryable || FALLBACK_ERROR_CODES.has(error.code);
}

export class ModelFallbackChain {
  constructor(
    private readonly candidates: ModelCandidate[],
    private readonly hooks: ModelFallbackHooks = {},
  ) {
    if (candidates.length === 0) throw new Error('At least one model candidate is required.');
  }

  async generateStructured<T>(
    request: Omit<StructuredGenerateRequest<T>, 'model' | 'temperature' | 'maxOutputTokens'>,
  ): Promise<ModelFallbackResult<T>> {
    const attempts: ModelFallbackAttempt[] = [];
    let previous: ModelCandidate | null = null;
    let lastError: unknown;

    for (const candidate of this.candidates) {
      if (previous && lastError) {
        await this.hooks.onFallback?.({
          from: previous,
          to: candidate,
          error: normalizeRuntimeError(lastError, 'MODEL_GENERATION_FAILED'),
        });
      }
      try {
        const output = await candidate.adapter.generateStructured({
          ...request,
          model: candidate.config.model,
          temperature: candidate.config.temperature,
          maxOutputTokens: candidate.config.maxOutputTokens,
          timeoutMs: Math.min(
            request.timeoutMs || candidate.config.timeoutMs,
            candidate.config.timeoutMs,
          ),
        });
        attempts.push({
          model: candidate.config.model,
          provider: candidate.config.provider,
          status: 'selected',
        });
        return { output, selected: candidate, attempts };
      } catch (error) {
        lastError = error;
        const normalized = normalizeRuntimeError(error, 'MODEL_GENERATION_FAILED');
        attempts.push({
          model: candidate.config.model,
          provider: candidate.config.provider,
          status: 'failed',
          errorCode: normalized.code,
          errorMessage: normalized.message,
        });
        if (!isFallbackEligible(normalized)) throw error;
        previous = candidate;
      }
    }

    throw lastError || new Error('All model candidates failed.');
  }
}
