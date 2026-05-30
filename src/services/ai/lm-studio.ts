import type { Genkit } from 'genkit';
import { db } from '@/lib/db';

export const LM_STUDIO_MODEL_PREFIX = 'lmstudio/';
export const LM_STUDIO_CONFIG_KEY = 'lm_studio_config';

export type LmStudioConfig = {
  baseUrl: string;
  apiToken: string;
};

export type LmStudioOutputKind = 'agent' | 'procedure';

const actionSchema = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      enum: [
        'transfer_chat',
        'close_chat',
        'add_internal_note',
        'crm_update_contact_custom_fields',
        'sgp_fetch_contracts',
        'sgp_fetch_contact_panel_data',
        'sgp_generate_invoice_pix',
        'sgp_create_payment_promise',
        'sgp_open_support_ticket',
        'mcp_call_tool',
      ],
    },
    reason: { type: ['string', 'null'] },
    payload: { type: ['object', 'null'], additionalProperties: true },
  },
  required: ['type', 'reason', 'payload'],
  additionalProperties: false,
};

function getLmStudioResponseSchema(outputKind: LmStudioOutputKind) {
  if (outputKind === 'procedure') {
    return {
      type: 'object',
      properties: {
        decision: { type: ['string', 'null'] },
        response: { type: ['string', 'null'] },
      },
      required: ['decision', 'response'],
      additionalProperties: false,
    };
  }

  return {
    type: 'object',
    properties: {
      response: { type: ['string', 'null'] },
      messageBlocks: {
        type: ['array', 'null'],
        items: { type: 'string' },
      },
      triggeredRule: { type: ['string', 'null'] },
      actions: {
        type: ['array', 'null'],
        items: actionSchema,
      },
    },
    required: ['response', 'messageBlocks', 'triggeredRule', 'actions'],
    additionalProperties: false,
  };
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
    [LM_STUDIO_CONFIG_KEY]
  );
  return parseLmStudioConfig(result.rows[0]?.value || null);
}

export function parseLmStudioStructuredText(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string' || !value.trim()) return null;

  const trimmed = value.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const candidates = [fenced, trimmed, trimmed.match(/\{[\s\S]*\}/)?.[0]].filter(
    (candidate): candidate is string => Boolean(candidate)
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

export function tryParseJsonResponse(text: string): {
  response?: string | null;
  messageBlocks?: string[] | null;
  triggeredRule?: string | null;
  actions?: any[] | null;
} | null {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();

  // Guard: never parse error messages as valid responses
  if (/\b(INVALID_ARGUMENT|Schema validation|Parse Error|stack trace|TypeError|SyntaxError)\b/i.test(trimmed)) {
    return null;
  }

  const attempts: string[] = [];

  // 1. Try markdown-wrapped JSON: ```json ... ```
  const mdMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (mdMatch?.[1]) attempts.push(mdMatch[1].trim());

  // 2. Try the raw text as-is (most common: LM Studio returns pure JSON string)
  attempts.push(trimmed);

  // 3. Try extracting the first JSON object from the text
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
    } catch (_) {}
  }

  return null;
}


export function coerceLmStudioPromptOutput<T extends Record<string, unknown>>(
  output: unknown,
  text?: unknown
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
  outputKind: LmStudioOutputKind = 'agent'
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
    const modelRef = compatOaiModelRef({ name: model });
    defineCompatOpenAIModel({
      ai,
      name: modelRef.name,
      client,
      modelRef,
      requestBuilder: (_request, body) => {
        // LM Studio identifiers may contain slashes. Preserve the complete id.
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

  return dynamicAi.definePrompt(promptConfig as Parameters<typeof dynamicAi.definePrompt>[0]);
}
