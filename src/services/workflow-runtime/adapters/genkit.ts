import type { Genkit } from 'genkit';
import type {
  GenerateRequest,
  GenerateResult,
  ModelAdapter,
  ModelHealth,
  ModelInfo,
  ModelStreamEvent,
  StructuredGenerateRequest,
} from '../model-adapter';
import type { ModelCapabilityProfile } from '../types';
import { withTimeout } from '../utils';

export type GenkitModelAdapterOptions = {
  ai: Genkit;
  models: Array<{
    id: string;
    capabilities: ModelCapabilityProfile;
  }>;
  defaultTimeoutMs?: number;
};

function buildPrompt(request: GenerateRequest): string {
  return request.messages
    .map((message) => `${message.role.toUpperCase()}\n${message.content}`)
    .join('\n\n');
}

function adapterError(message: string, code: string, retryable: boolean) {
  const error = new Error(message) as Error & { code?: string; retryable?: boolean };
  error.code = code;
  error.retryable = retryable;
  return error;
}

export class GenkitModelAdapter implements ModelAdapter {
  private readonly capabilities = new Map<string, ModelCapabilityProfile>();
  private readonly defaultTimeoutMs: number;

  constructor(private readonly options: GenkitModelAdapterOptions) {
    this.defaultTimeoutMs = options.defaultTimeoutMs || 60_000;
    for (const model of options.models) {
      this.capabilities.set(model.id, model.capabilities);
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    return [...this.capabilities].map(([id, capabilities]) => ({
      id,
      capabilities,
    }));
  }

  async healthCheck(): Promise<ModelHealth> {
    return {
      ok: this.capabilities.size > 0,
      latencyMs: 0,
      models: [...this.capabilities.keys()],
      error: this.capabilities.size > 0 ? undefined : 'No Genkit models configured.',
    };
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const response = await withTimeout(
      () => this.options.ai.generate({
        model: request.model,
        prompt: buildPrompt(request),
        config: {
          temperature: request.temperature,
          maxOutputTokens: request.maxOutputTokens,
        },
      }),
      request.timeoutMs || this.defaultTimeoutMs,
      request.signal,
      'MODEL_TIMEOUT',
    );
    return {
      model: request.model,
      text: response.text,
      toolRequests: [],
      usage: response.usage
        ? {
            inputTokens: response.usage.inputTokens,
            outputTokens: response.usage.outputTokens,
            totalTokens: response.usage.totalTokens,
          }
        : undefined,
      finishReason: response.finishReason,
    };
  }

  async generateStructured<T>(request: StructuredGenerateRequest<T>): Promise<T> {
    if (!(await this.supportsStructuredOutput(request.model))) {
      throw adapterError(
        `Model ${request.model} is not approved for structured output.`,
        'MODEL_CAPABILITY_MISMATCH',
        false,
      );
    }
    const response = await withTimeout(
      () => this.options.ai.generate({
        model: request.model,
        prompt: buildPrompt(request),
        config: {
          temperature: request.temperature,
          maxOutputTokens: request.maxOutputTokens,
        },
        output: { schema: request.schema },
      }),
      request.timeoutMs || this.defaultTimeoutMs,
      request.signal,
      'MODEL_TIMEOUT',
    );
    if (response.output === null || response.output === undefined) {
      throw adapterError('Genkit returned no structured output.', 'INVALID_STRUCTURED_OUTPUT', true);
    }
    const parsed = request.schema.safeParse(response.output);
    if (!parsed.success) {
      throw adapterError(
        `Genkit output failed schema validation: ${parsed.error.message}`,
        'MODEL_SCHEMA_VALIDATION_FAILED',
        true,
      );
    }
    return parsed.data;
  }

  async *stream(request: GenerateRequest): AsyncIterable<ModelStreamEvent> {
    yield { type: 'started', model: request.model };
    const { response, stream } = this.options.ai.generateStream({
      model: request.model,
      prompt: buildPrompt(request),
      config: {
        temperature: request.temperature,
        maxOutputTokens: request.maxOutputTokens,
      },
    });
    for await (const chunk of stream) {
      if (chunk.text) {
        yield { type: 'text_delta', model: request.model, text: chunk.text };
      }
    }
    const final = await response;
    yield {
      type: 'completed',
      model: request.model,
      usage: final.usage
        ? {
            inputTokens: final.usage.inputTokens,
            outputTokens: final.usage.outputTokens,
            totalTokens: final.usage.totalTokens,
          }
        : undefined,
    };
  }

  async supportsTools(model: string): Promise<boolean> {
    const capability = this.capabilities.get(model);
    return Boolean(capability && capability.toolCalling !== 'unsupported');
  }

  async supportsStructuredOutput(model: string): Promise<boolean> {
    return this.capabilities.get(model)?.structuredOutput === true;
  }
}
