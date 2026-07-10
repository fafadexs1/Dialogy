import { genkit } from 'genkit';
import { toJsonSchema } from 'genkit/schema';
import { googleAI } from '@genkit-ai/googleai';

import { getAiModelRuntimeProvider } from '@/lib/ai-models';
import { requestOpenAiCompatibleJson } from '@/services/ai/openai-compatible';
import type {
  GenerateRequest,
  GenerateResult,
  ModelAdapter,
  ModelHealth,
  ModelInfo,
  ModelStreamEvent,
  StructuredGenerateRequest,
} from '../model-adapter';

export type RuntimeProviderModelAdapterOptions = {
  model: string;
  apiKey: string;
  timeoutMs?: number;
};

function promptText(request: GenerateRequest) {
  return request.messages.map((message) => `${message.role.toUpperCase()}\n${message.content}`).join('\n\n');
}

function unsupported(message: string) {
  const error = new Error(message) as Error & { code?: string; retryable?: boolean };
  error.code = 'MODEL_CAPABILITY_MISMATCH';
  error.retryable = false;
  return error;
}

export class RuntimeProviderModelAdapter implements ModelAdapter {
  private readonly provider;
  private readonly timeoutMs;

  constructor(private readonly options: RuntimeProviderModelAdapterOptions) {
    this.provider = getAiModelRuntimeProvider(options.model);
    this.timeoutMs = options.timeoutMs || 60_000;
  }

  async listModels(): Promise<ModelInfo[]> {
    return [{ id: this.options.model }];
  }

  async healthCheck(): Promise<ModelHealth> {
    return { ok: Boolean(this.options.apiKey), latencyMs: 0, models: [this.options.model] };
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    if (this.provider !== 'googleai') {
      throw unsupported(`Text generation is not configured for provider ${this.provider}.`);
    }
    const ai = genkit({
      plugins: [googleAI({ apiKey: this.options.apiKey })],
      model: this.options.model,
    });
    const response = await ai.generate({
      model: this.options.model,
      prompt: promptText(request),
      config: {
        temperature: request.temperature,
        maxOutputTokens: request.maxOutputTokens,
      },
    });
    return {
      model: this.options.model,
      text: response.text,
      toolRequests: [],
      usage: response.usage ? {
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        totalTokens: response.usage.totalTokens,
      } : undefined,
      finishReason: response.finishReason,
    };
  }

  async generateStructured<T>(request: StructuredGenerateRequest<T>): Promise<T> {
    const jsonSchema = request.jsonSchema || toJsonSchema({ schema: request.schema }) || {};
    if (this.provider === 'openai' || this.provider === 'deepseek') {
      return requestOpenAiCompatibleJson({
        model: this.options.model,
        apiKey: this.options.apiKey,
        schema: request.schema,
        schemaName: request.schemaName,
        jsonSchema,
        systemPrompt: request.messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n'),
        userPrompt: request.messages.filter((message) => message.role !== 'system').map((message) => message.content).join('\n\n'),
        timeoutMs: Math.min(request.timeoutMs || this.timeoutMs, this.timeoutMs),
        maxTokens: request.maxOutputTokens,
      });
    }
    if (this.provider !== 'googleai') {
      throw unsupported(`Structured generation is not configured for provider ${this.provider}.`);
    }
    const ai = genkit({
      plugins: [googleAI({ apiKey: this.options.apiKey })],
      model: this.options.model,
    });
    const response = await ai.generate({
      model: this.options.model,
      prompt: promptText(request),
      config: {
        temperature: request.temperature,
        maxOutputTokens: request.maxOutputTokens,
      },
      output: { schema: request.schema },
    });
    const parsed = request.schema.safeParse(response.output);
    if (!parsed.success) {
      const error = new Error(`Model output failed ${request.schemaName} validation.`) as Error & { code?: string; retryable?: boolean };
      error.code = 'MODEL_SCHEMA_VALIDATION_FAILED';
      error.retryable = true;
      throw error;
    }
    return parsed.data;
  }

  async *stream(request: GenerateRequest): AsyncIterable<ModelStreamEvent> {
    yield { type: 'started', model: this.options.model };
    try {
      const result = await this.generate(request);
      if (result.text) yield { type: 'text_delta', model: this.options.model, text: result.text };
      yield { type: 'completed', model: this.options.model, usage: result.usage };
    } catch (error) {
      yield { type: 'error', model: this.options.model, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async supportsTools(): Promise<boolean> {
    return true;
  }

  async supportsStructuredOutput(): Promise<boolean> {
    return ['googleai', 'openai', 'deepseek'].includes(this.provider);
  }
}
