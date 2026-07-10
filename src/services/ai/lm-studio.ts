import type { Genkit } from 'genkit';
import { z } from 'zod';
import { db } from '@/lib/db';
import { listModelCallableAgentToolDefinitions } from '@/services/agent-tools/catalog';

export const LM_STUDIO_MODEL_PREFIX = 'lmstudio/';
export const LM_STUDIO_CONFIG_KEY = 'lm_studio_config';

export type LmStudioConfig = {
  baseUrl: string;
  apiToken: string;
};

export type LmStudioOutputKind = 'agent' | 'procedure';

function getActionSchema() {
  return {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: listModelCallableAgentToolDefinitions().map((definition) => definition.name),
      },
      reason: { type: 'string' },
      payload: { type: 'object', additionalProperties: true },
    },
    required: ['type', 'reason', 'payload'],
    additionalProperties: false,
  };
}

function getLmStudioResponseSchema(outputKind: LmStudioOutputKind) {
  if (outputKind === 'procedure') {
    return {
      type: 'object',
      properties: {
        decision: { type: 'string' },
        response: { type: 'string' },
      },
      required: ['decision', 'response'],
      additionalProperties: false,
    };
  }

  return {
    type: 'object',
    properties: {
      response: { type: 'string' },
      messageBlocks: {
        type: 'array',
        items: { type: 'string' },
      },
      triggeredRule: { type: 'string' },
      actions: {
        type: 'array',
        items: getActionSchema(),
      },
    },
    required: ['response', 'messageBlocks', 'triggeredRule', 'actions'],
    additionalProperties: false,
  };
}

const lmStudioActionZodSchema = z.object({
  type: z.string(),
  reason: z.string().optional().nullable(),
  payload: z.record(z.any()).optional().nullable(),
});

export function getLmStudioZodSchema(outputKind: LmStudioOutputKind) {
  if (outputKind === 'procedure') {
    return z.object({
      decision: z.string().optional().nullable(),
      response: z.string().optional().nullable(),
    });
  }

  return z.object({
    response: z.string().optional().nullable(),
    messageBlocks: z.array(z.string()).optional().nullable(),
    triggeredRule: z.string().optional().nullable(),
    actions: z.array(lmStudioActionZodSchema).optional().nullable(),
  });
}

export function isLmStudioModel(model?: string | null): boolean {
  return Boolean(model?.startsWith(LM_STUDIO_MODEL_PREFIX));
}

export function getLmStudioModelId(model: string): string {
  if (!isLmStudioModel(model)) {
    throw new Error(`Invalid LM Studio model id: "${model}".`);
  }

  return model.slice(LM_STUDIO_MODEL_PREFIX.length);
}

export function normalizeLmStudioConfig(value?: Partial<LmStudioConfig> | null): LmStudioConfig {
  return {
    baseUrl: value?.baseUrl?.trim().replace(/\/+$/, '') || '',
    apiToken: value?.apiToken?.trim() || '',
  };
}

export function parseLmStudioConfig(value?: string | null): LmStudioConfig {
  if (!value) return normalizeLmStudioConfig();

  try {
    return normalizeLmStudioConfig(JSON.parse(value) as Partial<LmStudioConfig>);
  } catch {
    return normalizeLmStudioConfig();
  }
}

export async function getGlobalLmStudioConfig(): Promise<LmStudioConfig> {
  const result = await db.query(
    'SELECT value FROM public.system_settings WHERE key = $1 LIMIT 1',
    [LM_STUDIO_CONFIG_KEY],
  );
  return parseLmStudioConfig(result.rows[0]?.value || null);
}

export function parseLmStudioStructuredText(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string' || !value.trim()) return null;

  let cleaned = value;
  if (value.includes('<think>')) {
    cleaned = value.replace(/<think>[\s\S]*?<\/think>/gi, '');
  }

  const trimmed = cleaned.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const candidates = [fenced, trimmed, trimmed.match(/\{[\s\S]*\}/)?.[0]].filter(
    (candidate): candidate is string => Boolean(candidate),
  );

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Try the next representation.
    }
  }

  return null;
}

export function getLmStudioMessageText(message?: {
  content?: unknown;
  reasoning_content?: unknown;
} | null): string {
  if (typeof message?.content === 'string' && message.content.trim()) {
    return message.content.trim();
  }
  if (typeof message?.reasoning_content === 'string' && message.reasoning_content.trim()) {
    return message.reasoning_content.trim();
  }
  return '';
}

export function tryParseJsonResponse(text: string): {
  response?: string | null;
  messageBlocks?: string[] | null;
  triggeredRule?: string | null;
  actions?: any[] | null;
} | null {
  if (!text || typeof text !== 'string') return null;

  let cleaned = text;
  if (text.includes('<think>')) {
    cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  }
  const trimmed = cleaned.trim();

  if (/\b(INVALID_ARGUMENT|Schema validation|Parse Error|stack trace|TypeError|SyntaxError)\b/i.test(trimmed)) {
    return null;
  }

  const attempts: string[] = [];
  const markdownMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (markdownMatch?.[1]) attempts.push(markdownMatch[1].trim());
  attempts.push(trimmed);
  const braceMatch = trimmed.match(/\{[\s\S]*\}/);
  if (braceMatch?.[0] && braceMatch[0] !== trimmed) attempts.push(braceMatch[0]);

  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && typeof parsed.response === 'string' && parsed.response.trim()) {
        return {
          response: parsed.response,
          messageBlocks: Array.isArray(parsed.messageBlocks) ? parsed.messageBlocks : null,
          triggeredRule: typeof parsed.triggeredRule === 'string' ? parsed.triggeredRule : null,
          actions: Array.isArray(parsed.actions) ? parsed.actions : [],
        };
      }
    } catch {
      // Try the next representation.
    }
  }

  return null;
}

export function coerceLmStudioPromptOutput<T extends Record<string, unknown>>(
  output: unknown,
  text?: unknown,
): T | null {
  if (output && typeof output === 'object' && !Array.isArray(output)) {
    return output as T;
  }

  return (parseLmStudioStructuredText(output) || parseLmStudioStructuredText(text)) as T | null;
}

export function defineLmStudioPrompt(
  promptConfig: unknown,
  model: string,
  config: LmStudioConfig,
  outputKind: LmStudioOutputKind = 'agent',
) {
  const { baseUrl: baseURL, apiToken } = normalizeLmStudioConfig(config);
  if (!baseURL) {
    throw new Error('LM Studio endpoint is not configured in superadmin.');
  }

  const modelId = getLmStudioModelId(model);
  const { genkit } = require('genkit') as typeof import('genkit');
  const {
    compatOaiModelRef,
    defineCompatOpenAIModel,
    openAICompatible,
  } = require('@genkit-ai/compat-oai') as typeof import('@genkit-ai/compat-oai');

  const defineModel = (ai: Genkit, client: InstanceType<typeof import('openai').OpenAI>) => {
    const originalCreate = client.chat.completions.create.bind(client.chat.completions);
    client.chat.completions.create = async function (body: any, options?: any) {
      const response = await originalCreate(body, options);
      if (response && Array.isArray(response.choices)) {
        for (const choice of response.choices) {
          const messageText = getLmStudioMessageText(choice.message);
          if (choice.message && !choice.message.content && messageText) {
            choice.message.content = messageText;
          }
          if (choice.message && Array.isArray(choice.message.tool_calls) && choice.message.tool_calls.length === 0) {
            delete choice.message.tool_calls;
          }
        }
      }
      return response;
    } as any;

    const modelRef = compatOaiModelRef({ name: model });
    defineCompatOpenAIModel({
      ai,
      name: modelRef.name,
      client,
      modelRef,
      requestBuilder: (_request, body) => {
        body.model = modelId;
        body.response_format = {
          type: 'json_schema',
          json_schema: {
            name: 'dialogy_response',
            strict: true,
            schema: getLmStudioResponseSchema(outputKind),
          },
        };
      },
    });
  };

  const dynamicAi = genkit({
    plugins: [
      openAICompatible({
        name: 'lmstudio',
        apiKey: apiToken || 'lm-studio',
        baseURL,
        initializer: async (ai, client) => defineModel(ai, client),
      }),
    ],
    model,
  });

  const originalSchema = (promptConfig as any)?.output?.schema;
  const isTest = (promptConfig as any)?.name === 'lmStudioTestPrompt';
  const originalPrompt = (promptConfig as any)?.prompt;
  const customPrompt = typeof originalPrompt === 'string' && !isTest
    ? [
        'Analise internamente a mensagem, o historico, as regras e as ferramentas habilitadas.',
        'Nao exponha raciocinio interno, deliberacao, chain-of-thought ou blocos <think>.',
        'Nao invente resultados de ferramentas. Solicite uma ferramenta somente quando ela for semanticamente necessaria para o pedido atual.',
        'Responda somente com o JSON final exigido pelo schema.',
        originalPrompt,
      ].join('\n\n')
    : originalPrompt;

  const clonedConfig = {
    ...(promptConfig as Record<string, any>),
    prompt: customPrompt,
    output: isTest && originalSchema ? { schema: originalSchema } : undefined,
  };

  return dynamicAi.definePrompt(clonedConfig as Parameters<typeof dynamicAi.definePrompt>[0]);
}
