import { toJsonSchema } from 'genkit/schema';
import type {
  GenerateRequest,
  GenerateResult,
  ModelAdapter,
  ModelHealth,
  ModelInfo,
  ModelStreamEvent,
  ModelToolRequest,
  ModelUsage,
  StructuredGenerateRequest,
} from '../model-adapter';
import type { ModelCapabilityProfile } from '../types';
import { isRecord, withTimeout } from '../utils';

export type LmStudioAdapterOptions = {
  baseUrl: string;
  apiKey?: string;
  capabilities?: ModelCapabilityProfile[];
  defaultTimeoutMs?: number;
  fetch?: typeof fetch;
};

type ChatCompletionResponse = {
  model?: string;
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id?: string;
        function?: {
          name?: string;
          arguments?: string | Record<string, unknown>;
        };
      }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

function modelUsage(response: ChatCompletionResponse): ModelUsage | undefined {
  if (!response.usage) return undefined;
  return {
    inputTokens: response.usage.prompt_tokens,
    outputTokens: response.usage.completion_tokens,
    totalTokens: response.usage.total_tokens,
  };
}

function parseToolRequests(response: ChatCompletionResponse): ModelToolRequest[] {
  return (response.choices?.[0]?.message?.tool_calls || []).flatMap((call, index) => {
    const name = call.function?.name?.trim();
    if (!name) return [];
    let args = call.function?.arguments;
    if (typeof args === 'string') {
      try {
        args = JSON.parse(args);
      } catch {
        args = {};
      }
    }
    return [{
      id: call.id || `tool_call_${index + 1}`,
      name,
      arguments: isRecord(args) ? args : {},
    }];
  });
}

function adapterError(message: string, code: string, retryable: boolean) {
  const error = new Error(message) as Error & { code?: string; retryable?: boolean };
  error.code = code;
  error.retryable = retryable;
  return error;
}

export class LmStudioModelAdapter implements ModelAdapter {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly defaultTimeoutMs: number;
  private readonly fetchImplementation: typeof fetch;
  private readonly capabilities = new Map<string, ModelCapabilityProfile>();

  constructor(options: LmStudioAdapterOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.apiKey = options.apiKey?.trim() || 'lm-studio';
    this.defaultTimeoutMs = options.defaultTimeoutMs || 60_000;
    this.fetchImplementation = options.fetch || fetch;
    for (const profile of options.capabilities || []) {
      this.capabilities.set(profile.model, profile);
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const response = await withTimeout(
      (signal) => this.fetchImplementation(`${this.baseUrl}/models`, {
        headers: this.headers(),
        signal,
      }),
      this.defaultTimeoutMs,
      undefined,
      'MODEL_TIMEOUT',
    );
    if (!response.ok) {
      throw adapterError(`LM Studio models request failed (${response.status}).`, 'MODEL_UNAVAILABLE', true);
    }
    const body = await response.json() as {
      data?: Array<{ id?: string; owned_by?: string; loaded?: boolean; max_context_length?: number }>;
    };
    return (body.data || []).flatMap((model) => {
      if (!model.id) return [];
      return [{
        id: model.id,
        ownedBy: model.owned_by,
        loaded: model.loaded,
        contextWindow: model.max_context_length,
        capabilities: this.capabilities.get(model.id),
      }];
    });
  }

  async healthCheck(): Promise<ModelHealth> {
    const startedAt = Date.now();
    try {
      const models = await this.listModels();
      return {
        ok: true,
        latencyMs: Date.now() - startedAt,
        models: models.map((model) => model.id),
      };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const body = await this.chatCompletion(request);
    const choice = body.choices?.[0];
    return {
      model: body.model || request.model,
      text: choice?.message?.content?.trim() || '',
      toolRequests: parseToolRequests(body),
      usage: modelUsage(body),
      finishReason: choice?.finish_reason,
      raw: body,
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
    const jsonSchema = request.jsonSchema || toJsonSchema({ schema: request.schema });
    if (!jsonSchema) {
      throw adapterError('Unable to convert structured output schema.', 'MODEL_SCHEMA_INVALID', false);
    }
    const body = await this.chatCompletion(request, {
      type: 'json_schema',
      json_schema: {
        name: request.schemaName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64),
        strict: true,
        schema: jsonSchema,
      },
    });
    const text = body.choices?.[0]?.message?.content?.trim() || '';
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw adapterError('LM Studio returned invalid JSON.', 'INVALID_STRUCTURED_OUTPUT', true);
    }
    const validated = request.schema.safeParse(parsed);
    if (!validated.success) {
      throw adapterError(
        `LM Studio output failed schema validation: ${validated.error.message}`,
        'MODEL_SCHEMA_VALIDATION_FAILED',
        true,
      );
    }
    return validated.data;
  }

  async *stream(request: GenerateRequest): AsyncIterable<ModelStreamEvent> {
    yield { type: 'started', model: request.model };
    const response = await withTimeout(
      (signal) => this.fetchImplementation(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        signal,
        body: JSON.stringify({
          ...this.requestBody(request),
          stream: true,
          stream_options: { include_usage: true },
        }),
      }),
      request.timeoutMs || this.defaultTimeoutMs,
      request.signal,
      'MODEL_TIMEOUT',
    );
    if (!response.ok || !response.body) {
      const message = `LM Studio stream failed (${response.status}).`;
      yield { type: 'error', model: request.model, error: message };
      throw adapterError(message, 'MODEL_UNAVAILABLE', response.status >= 500);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalUsage: ModelUsage | undefined;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const event = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string } }>;
            usage?: {
              prompt_tokens?: number;
              completion_tokens?: number;
              total_tokens?: number;
            };
          };
          const text = event.choices?.[0]?.delta?.content;
          if (text) yield { type: 'text_delta', model: request.model, text };
          if (event.usage) {
            finalUsage = {
              inputTokens: event.usage.prompt_tokens,
              outputTokens: event.usage.completion_tokens,
              totalTokens: event.usage.total_tokens,
            };
          }
        } catch {
          // Ignore malformed non-data lines and continue the SSE stream.
        }
      }
    }
    yield { type: 'completed', model: request.model, usage: finalUsage };
  }

  async supportsTools(model: string): Promise<boolean> {
    const profile = this.capabilities.get(model);
    return Boolean(profile && profile.toolCalling !== 'unsupported');
  }

  async supportsStructuredOutput(model: string): Promise<boolean> {
    return this.capabilities.get(model)?.structuredOutput === true;
  }

  private headers() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  private requestBody(request: GenerateRequest) {
    return {
      model: request.model,
      messages: request.messages.map((message) => ({
        role: message.role,
        content: message.content,
        ...(message.name ? { name: message.name } : {}),
        ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
      })),
      temperature: request.temperature,
      max_tokens: request.maxOutputTokens,
      tools: request.tools?.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      })),
      tool_choice: request.tools?.length ? 'auto' : undefined,
      stream: false,
    };
  }

  private async chatCompletion(
    request: GenerateRequest,
    responseFormat?: Record<string, unknown>,
  ): Promise<ChatCompletionResponse> {
    const response = await withTimeout(
      (signal) => this.fetchImplementation(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        signal,
        body: JSON.stringify({
          ...this.requestBody(request),
          response_format: responseFormat,
        }),
      }),
      request.timeoutMs || this.defaultTimeoutMs,
      request.signal,
      'MODEL_TIMEOUT',
    );
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw adapterError(
        `LM Studio generation failed (${response.status}): ${text.slice(0, 500)}`,
        response.status === 429 ? 'RATE_LIMITED' : 'MODEL_UNAVAILABLE',
        response.status === 408 || response.status === 429 || response.status >= 500,
      );
    }
    return response.json() as Promise<ChatCompletionResponse>;
  }
}
