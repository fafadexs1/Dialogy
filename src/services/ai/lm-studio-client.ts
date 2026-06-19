import { z } from 'zod';
import {
  getGlobalLmStudioConfig,
  getLmStudioModelId,
  getLmStudioMessageText,
  normalizeLmStudioConfig,
  parseLmStudioStructuredText,
} from './lm-studio';

type LmStudioMessageContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
    >;

type LmStudioMessage = {
  role: 'system' | 'user' | 'assistant';
  content: LmStudioMessageContent;
};

type LmStudioCompletionInput = {
  model: string;
  messages: LmStudioMessage[];
  timeoutMs?: number;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: Record<string, unknown>;
  allowReasoningContentFallback?: boolean;
};

async function requestLmStudioCompletion(input: LmStudioCompletionInput): Promise<string> {
  const config = normalizeLmStudioConfig(await getGlobalLmStudioConfig());
  if (!config.baseUrl) {
    throw new Error('LM Studio endpoint is not configured in superadmin.');
  }

  const timeoutMs = input.timeoutMs ?? 4000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiToken ? { Authorization: `Bearer ${config.apiToken}` } : {}),
      },
      body: JSON.stringify({
        model: getLmStudioModelId(input.model),
        messages: input.messages,
        temperature: input.temperature ?? 0,
        max_tokens: input.maxTokens ?? 240,
        ...(input.responseFormat ? { response_format: input.responseFormat } : {}),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = (await response.text()).slice(0, 500);
      throw new Error(`LM Studio request failed (${response.status}): ${body}`);
    }

    const body = await response.json() as {
      choices?: Array<{ message?: { content?: unknown; reasoning_content?: unknown } }>;
    };
    const message = body.choices?.[0]?.message;
    const content = input.allowReasoningContentFallback
      ? getLmStudioMessageText(message)
      : typeof message?.content === 'string'
        ? message.content.trim()
        : '';
    if (!content) {
      throw new Error('LM Studio returned an empty response.');
    }
    return content;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`LM Studio request timed out after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function requestLmStudioJson<TSchema extends z.ZodTypeAny>(input: {
  model: string;
  schema: TSchema;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  systemPrompt: string;
  userPrompt: string;
  timeoutMs?: number;
  maxTokens?: number;
}): Promise<z.output<TSchema>> {
  const text = await requestLmStudioCompletion({
    model: input.model,
    messages: [
      { role: 'system', content: input.systemPrompt },
      { role: 'user', content: input.userPrompt },
    ],
    timeoutMs: input.timeoutMs,
    maxTokens: input.maxTokens,
    responseFormat: {
      type: 'json_schema',
      json_schema: {
        name: input.schemaName,
        strict: true,
        schema: input.jsonSchema,
      },
    },
    allowReasoningContentFallback: true,
  });
  const parsed = parseLmStudioStructuredText(text);
  if (!parsed) {
    throw new Error(
      `LM Studio returned invalid JSON for ${input.schemaName}. ` +
      'The response may be truncated or incompatible with the requested schema.'
    );
  }

  const result = input.schema.safeParse(parsed);
  if (!result.success) {
    const issueSummary = result.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`LM Studio returned JSON that does not match ${input.schemaName}: ${issueSummary}`);
  }
  return result.data;
}

export function requestLmStudioText(input: {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  timeoutMs?: number;
  maxTokens?: number;
}) {
  return requestLmStudioCompletion({
    model: input.model,
    messages: [
      { role: 'system', content: input.systemPrompt },
      { role: 'user', content: input.userPrompt },
    ],
    timeoutMs: input.timeoutMs,
    maxTokens: input.maxTokens,
  });
}

export async function requestLmStudioVisionText(input: {
  model: string;
  prompt: string;
  mediaUrl: string;
  timeoutMs?: number;
  maxTokens?: number;
}) {
  const response = await fetch(input.mediaUrl);
  if (!response.ok) {
    throw new Error(`Failed to download image for LM Studio vision (${response.status}).`);
  }
  const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg';
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
    throw new Error(`LM Studio vision does not support image type "${mimeType}".`);
  }
  const imageBase64 = Buffer.from(await response.arrayBuffer()).toString('base64');
  const config = normalizeLmStudioConfig(await getGlobalLmStudioConfig());
  if (!config.baseUrl) {
    throw new Error('LM Studio endpoint is not configured in superadmin.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 12000);
  try {
    const visionResponse = await fetch(`${config.baseUrl.replace(/\/v1$/, '')}/api/v1/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiToken ? { Authorization: `Bearer ${config.apiToken}` } : {}),
      },
      body: JSON.stringify({
        model: getLmStudioModelId(input.model),
        input: [
          { type: 'image', data_url: `data:${mimeType};base64,${imageBase64}` },
          { type: 'text', content: input.prompt },
        ],
        system_prompt: 'Responda somente com a analise final objetiva. Nao exponha raciocinio interno, passos ou deliberacao.',
        temperature: 0,
        max_output_tokens: input.maxTokens ?? 320,
        reasoning: 'off',
        store: false,
      }),
      signal: controller.signal,
    });

    if (!visionResponse.ok) {
      const body = (await visionResponse.text()).slice(0, 500);
      throw new Error(`LM Studio vision request failed (${visionResponse.status}): ${body}`);
    }

    const body = await visionResponse.json() as {
      output?: Array<{ type?: string; content?: unknown }>;
    };
    const text = (body.output || [])
      .filter((item) => item.type === 'message' && typeof item.content === 'string')
      .map((item) => String(item.content))
      .join('\n')
      .trim();
    if (!text) {
      throw new Error('LM Studio vision returned an empty response.');
    }
    return text;
  } finally {
    clearTimeout(timeout);
  }
}
