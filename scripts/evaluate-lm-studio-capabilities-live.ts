import 'dotenv/config';
import { z } from 'zod';
import { db } from '../src/lib/db';
import {
  getGlobalLmStudioConfig,
  normalizeLmStudioConfig,
} from '../src/services/ai/lm-studio';
import {
  LmStudioModelAdapter,
  ModelCapabilityStore,
  type ModelCapabilityProfile,
} from '../src/services/workflow-runtime';

type ListedModel = {
  id?: string;
  loaded?: boolean;
  max_context_length?: number;
};

type ToolCallingGrade = ModelCapabilityProfile['toolCalling'];

const timeoutMs = 60_000;

function baseV1Url(value: string) {
  const normalized = value.replace(/\/+$/, '');
  return normalized.endsWith('/v1') ? normalized : `${normalized}/v1`;
}

async function request(
  url: string,
  init: RequestInit,
  timeout = timeoutMs,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      const cause = error && typeof error === 'object' && 'cause' in error
        ? (error as { cause?: { code?: string; message?: string } }).cause
        : undefined;
      const endpoint = new URL(url);
      throw new Error(
        `LM Studio request to ${endpoint.protocol}//${endpoint.host} failed`
        + `${cause?.code ? ` (${cause.code})` : ''}`
        + `${cause?.message ? `: ${cause.message}` : '.'}`,
      );
    }
  } finally {
    clearTimeout(timer);
  }
}

function headers(apiToken: string) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiToken || 'lm-studio'}`,
  };
}

async function evaluateStructuredOutput(input: {
  baseUrl: string;
  apiToken: string;
  model: string;
}) {
  const response = await request(`${input.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: headers(input.apiToken),
    body: JSON.stringify({
      model: input.model,
      messages: [{
        role: 'user',
        content: 'Return status "ok" and value "capability-check". Return only the requested object.',
      }],
      temperature: 0,
      max_tokens: 128,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'capability_check',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['ok'] },
              value: { type: 'string', enum: ['capability-check'] },
            },
            required: ['status', 'value'],
            additionalProperties: false,
          },
        },
      },
    }),
  });
  if (!response.ok) {
    return { supported: false, status: response.status, reason: 'http_error' };
  }
  const body = await response.json() as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = body.choices?.[0]?.message?.content || '';
  try {
    const parsed = JSON.parse(content);
    return {
      supported: parsed?.status === 'ok' && parsed?.value === 'capability-check',
      status: response.status,
      reason: 'validated',
    };
  } catch {
    return { supported: false, status: response.status, reason: 'invalid_json' };
  }
}

async function evaluateToolCalling(input: {
  baseUrl: string;
  apiToken: string;
  model: string;
}): Promise<{ grade: ToolCallingGrade; status: number; reason: string }> {
  const response = await request(`${input.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: headers(input.apiToken),
    body: JSON.stringify({
      model: input.model,
      messages: [{
        role: 'user',
        content: 'Call the capability_echo tool exactly once with value "ping". Do not answer directly.',
      }],
      temperature: 0,
      max_tokens: 128,
      tools: [{
        type: 'function',
        function: {
          name: 'capability_echo',
          description: 'Echoes one value for a capability test.',
          parameters: {
            type: 'object',
            properties: {
              value: { type: 'string', enum: ['ping'] },
            },
            required: ['value'],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: 'auto',
    }),
  });
  if (!response.ok) {
    return { grade: 'unsupported', status: response.status, reason: 'http_error' };
  }
  const body = await response.json() as {
    choices?: Array<{
      message?: {
        tool_calls?: Array<{
          function?: { name?: string; arguments?: string | Record<string, unknown> };
        }>;
      };
    }>;
  };
  const calls = body.choices?.[0]?.message?.tool_calls || [];
  const call = calls[0];
  if (!call || call.function?.name !== 'capability_echo') {
    return { grade: 'unsupported', status: response.status, reason: 'no_valid_tool_request' };
  }
  let argumentsValue: Record<string, unknown> = {};
  try {
    argumentsValue = typeof call.function.arguments === 'string'
      ? JSON.parse(call.function.arguments)
      : call.function.arguments || {};
  } catch {
    return { grade: 'weak', status: response.status, reason: 'invalid_arguments_json' };
  }
  if (calls.length === 1 && argumentsValue.value === 'ping') {
    return { grade: 'supported', status: response.status, reason: 'validated_single_call' };
  }
  return { grade: 'weak', status: response.status, reason: 'arguments_or_cardinality_mismatch' };
}

async function evaluateStreaming(input: {
  baseUrl: string;
  apiToken: string;
  model: string;
}) {
  const response = await request(`${input.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: headers(input.apiToken),
    body: JSON.stringify({
      model: input.model,
      messages: [{ role: 'user', content: 'Reply with exactly: stream-ok' }],
      temperature: 0,
      max_tokens: 32,
      stream: true,
      stream_options: { include_usage: true },
    }),
  });
  if (!response.ok || !response.body) {
    return { supported: false, status: response.status, reason: 'http_error' };
  }
  const text = await response.text();
  const hasData = text.split('\n').some((line) => line.trim().startsWith('data:'));
  const completed = text.includes('[DONE]');
  return {
    supported: hasData && completed,
    status: response.status,
    reason: hasData && completed ? 'validated_sse' : 'incomplete_sse',
  };
}

async function verifyProductionAdapter(input: {
  baseUrl: string;
  apiToken: string;
  profile: ModelCapabilityProfile;
}) {
  const adapter = new LmStudioModelAdapter({
    baseUrl: input.baseUrl,
    apiKey: input.apiToken,
    capabilities: [input.profile],
    defaultTimeoutMs: timeoutMs,
  });
  const health = await adapter.healthCheck();
  if (!health.ok || !health.models?.includes(input.profile.model)) {
    throw new Error(`Production LM Studio adapter could not list ${input.profile.model}.`);
  }
  if (input.profile.structuredOutput) {
    const schema = z.object({
      status: z.literal('ok'),
      value: z.literal('adapter-check'),
    });
    const result = await adapter.generateStructured({
      model: input.profile.model,
      messages: [{
        role: 'user',
        content: 'Return status "ok" and value "adapter-check". Return only the requested object.',
      }],
      schema,
      schemaName: 'adapter_capability_check',
      temperature: 0,
      maxOutputTokens: 128,
    });
    schema.parse(result);
  }
  return {
    health: health.ok,
    structuredPathVerified: input.profile.structuredOutput,
  };
}

async function main() {
  const rawConfig = await getGlobalLmStudioConfig();
  const config = normalizeLmStudioConfig(rawConfig);
  if (!config.baseUrl) {
    throw new Error('LM Studio is not configured in system_settings.');
  }
  const baseUrl = baseV1Url(config.baseUrl);
  const modelsResponse = await request(`${baseUrl}/models`, {
    headers: headers(config.apiToken),
  });
  if (!modelsResponse.ok) {
    throw new Error(`LM Studio model discovery failed with HTTP ${modelsResponse.status}.`);
  }
  const modelsBody = await modelsResponse.json() as { data?: ListedModel[] };
  const models = (modelsBody.data || []).filter(
    (model): model is ListedModel & { id: string } => Boolean(model.id),
  );
  if (models.length === 0) throw new Error('LM Studio returned no models.');

  const store = new ModelCapabilityStore(db);
  const results = [];
  for (const model of models) {
    const evaluatedAt = new Date().toISOString();
    const [structured, toolCalling, streaming] = await Promise.all([
      evaluateStructuredOutput({ baseUrl, apiToken: config.apiToken, model: model.id }),
      evaluateToolCalling({ baseUrl, apiToken: config.apiToken, model: model.id }),
      evaluateStreaming({ baseUrl, apiToken: config.apiToken, model: model.id }),
    ]);
    const profile: ModelCapabilityProfile = {
      model: model.id,
      toolCalling: toolCalling.grade,
      structuredOutput: structured.supported,
      streaming: streaming.supported,
      recommendedMaxTools:
        toolCalling.grade === 'supported' || toolCalling.grade === 'excellent'
          ? 10
          : toolCalling.grade === 'weak'
            ? 3
            : 0,
      recommendedContextSize:
        typeof model.max_context_length === 'number' && model.max_context_length > 0
          ? model.max_context_length
          : 8_192,
      lastEvaluatedAt: evaluatedAt,
    };
    await store.upsert('lmstudio', profile, {
      mode: 'live_endpoint_evaluation',
      structured,
      toolCalling,
      streaming,
      loaded: model.loaded,
    });
    const adapterVerification = await verifyProductionAdapter({
      baseUrl: config.baseUrl,
      apiToken: config.apiToken,
      profile,
    });
    results.push({
      model: model.id,
      profile,
      adapterVerification,
    });
  }

  process.stdout.write(`${JSON.stringify({
    mode: 'live_lm_studio_endpoint_no_mocks',
    passed: true,
    endpointConfigured: true,
    evaluatedModels: results.length,
    results,
  }, null, 2)}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });
