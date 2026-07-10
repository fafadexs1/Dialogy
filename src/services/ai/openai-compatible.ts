import type { Genkit } from 'genkit';
import { z } from 'zod';
import { getAiModelRuntimeProvider, type AiModelRuntimeProvider } from '@/lib/ai-models';
import { listModelCallableAgentToolDefinitions } from '@/services/agent-tools/catalog';
import { parseLmStudioStructuredText } from './lm-studio';

export type OpenAiCompatibleOutputKind = 'agent' | 'procedure';

type OpenAiCompatibleProvider = Extract<AiModelRuntimeProvider, 'openai' | 'deepseek'>;

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

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

function getStructuredResponseSchema(outputKind: OpenAiCompatibleOutputKind) {
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

function getJsonOnlyInstruction(outputKind: OpenAiCompatibleOutputKind): string {
  const schema = JSON.stringify(getStructuredResponseSchema(outputKind));
  return [
    'Responda somente com JSON valido.',
    'Nao use Markdown, comentarios, texto antes/depois do JSON, nem exponha raciocinio interno.',
    'Use exatamente este JSON Schema como contrato de saida:',
    schema,
    'Quando um campo nao se aplicar, use string vazia ou array vazio.',
  ].join('\n');
}

export function isOpenAiCompatibleModel(model?: string | null): boolean {
  const provider = getAiModelRuntimeProvider(model);
  return provider === 'openai' || provider === 'deepseek';
}

function getOpenAiCompatibleProvider(model: string): OpenAiCompatibleProvider {
  const provider = getAiModelRuntimeProvider(model);
  if (provider === 'openai' || provider === 'deepseek') return provider;
  throw new Error(`Model "${model}" is not OpenAI-compatible in Dialogy runtime.`);
}

export function getOpenAiCompatibleModelId(model: string): string {
  const normalized = model.trim();
  if (normalized.startsWith('openai/')) return normalized.slice('openai/'.length);
  if (normalized.startsWith('codex/')) return normalized.slice('codex/'.length);
  if (normalized.startsWith('deepseek/')) return normalized.slice('deepseek/'.length);
  throw new Error(`Invalid OpenAI-compatible model id: "${model}".`);
}

function providerBaseUrl(provider: OpenAiCompatibleProvider): string | undefined {
  if (provider === 'deepseek') return DEEPSEEK_BASE_URL;
  return undefined;
}

function providerResponseFormat(provider: OpenAiCompatibleProvider, outputKind: OpenAiCompatibleOutputKind): any {
  if (provider === 'deepseek') {
    return { type: 'json_object' };
  }

  return {
    type: 'json_schema',
    json_schema: {
      name: outputKind === 'procedure' ? 'dialogy_procedure_response' : 'dialogy_agent_response',
      strict: true,
      schema: getStructuredResponseSchema(outputKind),
    },
  };
}

export function buildOpenAiCompatibleJsonSystemPrompt(input: {
  provider: OpenAiCompatibleProvider;
  systemPrompt: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
}): string {
  if (input.provider !== 'deepseek') {
    return input.systemPrompt;
  }

  return [
    input.systemPrompt,
    '',
    'Contrato obrigatorio de saida:',
    `- Retorne somente um objeto JSON que valide contra o schema "${input.schemaName}".`,
    '- Nao use Markdown, comentarios, texto antes/depois do JSON, nem embrulhe o objeto em outra chave.',
    '- Inclua todas as propriedades marcadas em "required".',
    '- Use arrays vazios ou strings vazias quando nao houver conteudo opcional.',
    `JSON Schema: ${JSON.stringify(input.jsonSchema)}`,
  ].join('\n');
}

function patchChatCompletionClient(
  client: InstanceType<typeof import('openai').OpenAI>,
  provider: OpenAiCompatibleProvider,
  modelId: string,
  outputKind: OpenAiCompatibleOutputKind,
) {
  const originalCreate = client.chat.completions.create.bind(client.chat.completions);

  client.chat.completions.create = async function (body: any, options?: any) {
    body.model = modelId;
    body.response_format = providerResponseFormat(provider, outputKind);
    body.stream = false;

    if (provider === 'deepseek' && /^deepseek-v4/i.test(modelId)) {
      body.thinking = {
        type: process.env.AI_DEEPSEEK_THINKING === 'enabled' ? 'enabled' : 'disabled',
      };
    }

    const response = await originalCreate(body, options);
    if (response && Array.isArray(response.choices)) {
      for (const choice of response.choices) {
        if (choice.message && Array.isArray(choice.message.tool_calls) && choice.message.tool_calls.length === 0) {
          delete choice.message.tool_calls;
        }
      }
    }
    return response;
  } as any;
}

export function coerceOpenAiCompatiblePromptOutput<T extends Record<string, unknown>>(
  output: unknown,
  text?: unknown,
): T | null {
  if (output && typeof output === 'object' && !Array.isArray(output)) {
    return output as T;
  }

  return (parseLmStudioStructuredText(output) || parseLmStudioStructuredText(text)) as T | null;
}

export function defineOpenAiCompatiblePrompt(
  promptConfig: unknown,
  model: string,
  apiKey: string,
  outputKind: OpenAiCompatibleOutputKind,
) {
  const provider = getOpenAiCompatibleProvider(model);
  const modelId = getOpenAiCompatibleModelId(model);
  const { genkit } = require('genkit') as typeof import('genkit');
  const {
    compatOaiModelRef,
    defineCompatOpenAIModel,
    openAICompatible,
  } = require('@genkit-ai/compat-oai') as typeof import('@genkit-ai/compat-oai');

  const defineModel = (ai: Genkit, client: InstanceType<typeof import('openai').OpenAI>) => {
    patchChatCompletionClient(client, provider, modelId, outputKind);
    const modelRef = compatOaiModelRef({ name: model });
    defineCompatOpenAIModel({
      ai,
      name: modelRef.name,
      client,
      modelRef,
      requestBuilder: (_request, body) => {
        body.model = modelId;
        body.response_format = providerResponseFormat(provider, outputKind);
      },
    });
  };

  const pluginOptions = {
    name: provider === 'deepseek' ? 'deepseek' : 'openai',
    apiKey,
    ...(providerBaseUrl(provider) ? { baseURL: providerBaseUrl(provider) } : {}),
    initializer: async (ai: Genkit, client: InstanceType<typeof import('openai').OpenAI>) => defineModel(ai, client),
  };

  const dynamicAi = genkit({
    plugins: [openAICompatible(pluginOptions)],
    model,
  });

  const originalPrompt = (promptConfig as any)?.prompt;
  const customPrompt = typeof originalPrompt === 'string'
    ? [getJsonOnlyInstruction(outputKind), originalPrompt].join('\n\n')
    : originalPrompt;

  const clonedConfig = {
    ...(promptConfig as Record<string, any>),
    prompt: customPrompt,
    output: undefined,
  };

  return dynamicAi.definePrompt(clonedConfig as Parameters<typeof dynamicAi.definePrompt>[0]);
}

export async function requestOpenAiCompatibleJson<TSchema extends z.ZodTypeAny>(input: {
  model: string;
  apiKey: string;
  schema: TSchema;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  systemPrompt: string;
  userPrompt: string;
  timeoutMs?: number;
  maxTokens?: number;
}): Promise<z.output<TSchema>> {
  const provider = getOpenAiCompatibleProvider(input.model);
  const modelId = getOpenAiCompatibleModelId(input.model);
  const { default: OpenAI } = require('openai') as typeof import('openai');
  const client = new OpenAI({
    apiKey: input.apiKey,
    ...(providerBaseUrl(provider) ? { baseURL: providerBaseUrl(provider) } : {}),
    timeout: input.timeoutMs ?? 4000,
  });

  const body: Record<string, unknown> = {
    model: modelId,
    messages: [
      {
        role: 'system',
        content: buildOpenAiCompatibleJsonSystemPrompt({
          provider,
          systemPrompt: input.systemPrompt,
          schemaName: input.schemaName,
          jsonSchema: input.jsonSchema,
        }),
      },
      { role: 'user', content: input.userPrompt },
    ],
    temperature: 0,
    max_tokens: input.maxTokens ?? 160,
    response_format: provider === 'deepseek'
      ? { type: 'json_object' }
      : {
          type: 'json_schema',
          json_schema: {
            name: input.schemaName,
            strict: true,
            schema: input.jsonSchema,
          },
        },
  };

  if (provider === 'deepseek' && /^deepseek-v4/i.test(modelId)) {
    body.thinking = {
      type: process.env.AI_DEEPSEEK_THINKING === 'enabled' ? 'enabled' : 'disabled',
    };
  }

  const response = await client.chat.completions.create(body as any);
  const content = response.choices?.[0]?.message?.content;
  const text = typeof content === 'string' ? content.trim() : '';
  const parsed = parseLmStudioStructuredText(text);
  if (!parsed) {
    throw new Error(`${provider} returned invalid JSON for ${input.schemaName}.`);
  }

  const result = input.schema.safeParse(parsed);
  if (!result.success) {
    const issueSummary = result.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`${provider} returned JSON that does not match ${input.schemaName}: ${issueSummary}`);
  }

  return result.data;
}
