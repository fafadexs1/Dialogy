import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';

import {
  getAiModelRuntimeProvider,
  normalizeGoogleAiModelId,
  type AiModelRuntimeProvider,
} from '@/lib/ai-models';
import { classifyAiModelError, type AiModelErrorCode } from '@/services/ai/model-errors';
import { requestOpenAiCompatibleJson } from '@/services/ai/openai-compatible';

export type AiProviderConnectionProvider = 'gemini' | 'openai' | 'deepseek';

export type AiProviderHealthResult = {
  ok: boolean;
  provider: AiProviderConnectionProvider;
  model: string;
  runtimeProvider: AiModelRuntimeProvider;
  durationMs: number;
  checkedAt: string;
  message: string;
  errorCode?: AiModelErrorCode | 'missing_key' | 'invalid_model';
  status?: number | null;
};

const HealthResponseSchema = z.object({
  ok: z.boolean(),
  provider: z.enum(['gemini', 'openai', 'deepseek']),
  message: z.string().default('ok'),
});

const HEALTH_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    provider: { type: 'string', enum: ['gemini', 'openai', 'deepseek'] },
    message: { type: 'string' },
  },
  required: ['ok', 'provider', 'message'],
  additionalProperties: false,
};

function clean(value?: string | null): string {
  return value?.trim() || '';
}

function runtimeProviderForConnectionProvider(
  provider: AiProviderConnectionProvider
): AiModelRuntimeProvider {
  if (provider === 'gemini') return 'googleai';
  if (provider === 'deepseek') return 'deepseek';
  return 'openai';
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[redacted-google-key]')
    .replace(/sk-[0-9A-Za-z_-]{20,}/g, '[redacted-openai-key]')
    .replace(/Bearer\s+[0-9A-Za-z._-]+/gi, 'Bearer [redacted]')
    .slice(0, 420);
}

export function normalizeAiProviderHealthModel(input: {
  provider: AiProviderConnectionProvider;
  model?: string | null;
}): { model: string; runtimeProvider: AiModelRuntimeProvider; error?: string } {
  const rawModel = clean(input.model);
  if (!rawModel) {
    return {
      model: '',
      runtimeProvider: runtimeProviderForConnectionProvider(input.provider),
      error: 'Modelo nao informado.',
    };
  }

  if (input.provider === 'gemini') {
    const model = normalizeGoogleAiModelId(rawModel);
    if (!model) {
      return {
        model: rawModel,
        runtimeProvider: getAiModelRuntimeProvider(rawModel),
        error: 'Modelo Gemini invalido.',
      };
    }
    return { model, runtimeProvider: 'googleai' };
  }

  if (input.provider === 'deepseek') {
    const model = rawModel.startsWith('deepseek/')
      ? rawModel
      : rawModel.includes('/')
        ? rawModel
        : `deepseek/${rawModel}`;
    const runtimeProvider = getAiModelRuntimeProvider(model);
    return {
      model,
      runtimeProvider,
      error: runtimeProvider === 'deepseek' ? undefined : 'Modelo DeepSeek invalido.',
    };
  }

  const model = rawModel.startsWith('openai/') || rawModel.startsWith('codex/')
    ? rawModel
    : rawModel.includes('/')
      ? rawModel
      : `openai/${rawModel}`;
  const runtimeProvider = getAiModelRuntimeProvider(model);
  return {
    model,
    runtimeProvider,
    error: runtimeProvider === 'openai' ? undefined : 'Modelo OpenAI/Codex invalido.',
  };
}

function withDeadline<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });

  return Promise.race([promise, deadline]).finally(() => {
    if (timeout) clearTimeout(timeout);
  }) as Promise<T>;
}

async function testGeminiConnection(input: {
  provider: AiProviderConnectionProvider;
  model: string;
  apiKey: string;
  timeoutMs: number;
}) {
  const modelName = input.model.replace(/^googleai\//, '');
  const genAI = new GoogleGenerativeAI(input.apiKey);
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 80,
      responseMimeType: 'application/json',
    },
  });

  const prompt = [
    'Responda somente JSON valido.',
    `Use exatamente: {"ok":true,"provider":"${input.provider}","message":"ok"}`,
  ].join('\n');

  const response = await withDeadline(
    model.generateContent(prompt),
    input.timeoutMs,
    'Gemini health check',
  );
  const text = response.response.text();
  const parsed = HealthResponseSchema.safeParse(JSON.parse(text));
  if (!parsed.success || parsed.data.provider !== input.provider || !parsed.data.ok) {
    throw new Error('Gemini returned an invalid health check payload.');
  }
}

async function testOpenAiCompatibleConnection(input: {
  provider: Exclude<AiProviderConnectionProvider, 'gemini'>;
  model: string;
  apiKey: string;
  timeoutMs: number;
}) {
  const response = await requestOpenAiCompatibleJson({
    model: input.model,
    apiKey: input.apiKey,
    schema: HealthResponseSchema,
    schemaName: 'dialogy_ai_provider_health',
    jsonSchema: HEALTH_RESPONSE_JSON_SCHEMA,
    systemPrompt: 'Voce verifica uma conexao de IA. Responda somente o JSON solicitado.',
    userPrompt: `Responda exatamente este JSON: {"ok":true,"provider":"${input.provider}","message":"ok"}`,
    timeoutMs: input.timeoutMs,
    maxTokens: 300,
  });

  if (!response.ok || response.provider !== input.provider) {
    throw new Error(`${input.provider} returned an invalid health check payload.`);
  }
}

export async function testAiProviderConnection(input: {
  provider: AiProviderConnectionProvider;
  model?: string | null;
  apiKey?: string | null;
  timeoutMs?: number;
}): Promise<AiProviderHealthResult> {
  const timeoutMs = input.timeoutMs ?? 12000;
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();
  const normalized = normalizeAiProviderHealthModel({
    provider: input.provider,
    model: input.model,
  });

  if (normalized.error) {
    return {
      ok: false,
      provider: input.provider,
      model: normalized.model,
      runtimeProvider: normalized.runtimeProvider,
      durationMs: Date.now() - startedAt,
      checkedAt,
      message: normalized.error,
      errorCode: 'invalid_model',
    };
  }

  const apiKey = clean(input.apiKey);
  if (!apiKey) {
    return {
      ok: false,
      provider: input.provider,
      model: normalized.model,
      runtimeProvider: normalized.runtimeProvider,
      durationMs: Date.now() - startedAt,
      checkedAt,
      message: 'Nenhuma chave de API configurada para este provedor.',
      errorCode: 'missing_key',
    };
  }

  try {
    if (input.provider === 'gemini') {
      await testGeminiConnection({
        provider: input.provider,
        model: normalized.model,
        apiKey,
        timeoutMs,
      });
    } else {
      await testOpenAiCompatibleConnection({
        provider: input.provider,
        model: normalized.model,
        apiKey,
        timeoutMs,
      });
    }

    return {
      ok: true,
      provider: input.provider,
      model: normalized.model,
      runtimeProvider: normalized.runtimeProvider,
      durationMs: Date.now() - startedAt,
      checkedAt,
      message: 'Conexao validada com resposta JSON real do modelo.',
    };
  } catch (error) {
    const classification = classifyAiModelError(error);
    return {
      ok: false,
      provider: input.provider,
      model: normalized.model,
      runtimeProvider: normalized.runtimeProvider,
      durationMs: Date.now() - startedAt,
      checkedAt,
      message: redactSensitiveText(classification.message),
      errorCode: classification.code,
      status: classification.status,
    };
  }
}
