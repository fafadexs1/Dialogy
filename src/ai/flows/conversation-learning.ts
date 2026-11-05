import { requestPlatformJson } from '@/services/ai/platform-json';
import { runPlatformModel } from '@/services/ai/platform-model-client';
import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { z } from 'zod';

import { ai } from '@/ai/genkit';
import { DEFAULT_AUTOPILOT_MODEL } from '@/lib/ai-models';
import { isLmStudioModel } from '@/services/ai/lm-studio';
import { requestLmStudioJson } from '@/services/ai/lm-studio-client';
import { isOpenAiCompatibleModel } from '@/services/ai/openai-compatible';
import {  type AiModelKeyCandidate } from '@/services/ai/model-client';

const ConversationLearningSchema = z.object({
  shouldStore: z.boolean(),
  reason: z.string(),
  name: z.string(),
  content: z.string(),
  summary: z.string(),
  category: z.string(),
  tags: z.array(z.string()).max(12),
  contextRole: z.enum(['fact', 'procedure', 'policy', 'persona']),
  canonicalAnswer: z.string(),
  workflowHints: z.array(z.string()).max(12),
  requiredTools: z.array(z.string()).max(12),
});

export type ConversationLearning = z.infer<typeof ConversationLearningSchema>;

const promptInputSchema = z.object({
  transcript: z.string(),
  closeContext: z.string(),
  existingKnowledge: z.string(),
});

const instructions = `Analise um atendimento real e proponha UMA nota canonica para a base de conhecimento do agente.

Regras obrigatorias:
- A conversa e apenas evidencia. Nunca copie o historico, falas, nomes, telefones ou outros dados pessoais para a nota.
- Extraia somente uma orientacao reutilizavel e confirmada pelo desfecho do atendimento.
- Se nao houver resolucao clara, se o atendente aparentar ter errado, ou se a orientacao depender de dados exclusivos desse cliente, use shouldStore=false.
- Nao invente prazos, politicas, precos, ferramentas, causas ou passos ausentes.
- Se houver conflito com a base atual, use shouldStore=false e explique em reason.
- content deve ser Markdown operacional completo com: Quando usar, Como reagir, O que evitar e Resultado esperado.
- canonicalAnswer deve ser uma resposta curta sugerida ao cliente, sem dados especificos do caso.
- requiredTools deve conter somente tools citadas explicitamente como @nome_da_tool.
- reason explica por que o aprendizado pode ou nao ser publicado.
- Quando shouldStore=false, ainda devolva strings validas, mas nao fabrique uma nota.

Responda somente JSON valido.`;

const promptConfig = {
  name: 'conversationLearningPrompt',
  input: { schema: promptInputSchema },
  output: { schema: ConversationLearningSchema },
  prompt: `${instructions}

Contexto de encerramento:
{{{closeContext}}}

Base atual resumida (use para evitar contradicoes e duplicidade):
{{{existingKnowledge}}}

Historico do atendimento:
{{{transcript}}}`,
};

const defaultPrompt = ai.definePrompt(promptConfig);

const jsonSchema = {
  type: 'object',
  properties: {
    shouldStore: { type: 'boolean' },
    reason: { type: 'string' },
    name: { type: 'string' },
    content: { type: 'string' },
    summary: { type: 'string' },
    category: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' }, maxItems: 12 },
    contextRole: { type: 'string', enum: ['fact', 'procedure', 'policy', 'persona'] },
    canonicalAnswer: { type: 'string' },
    workflowHints: { type: 'array', items: { type: 'string' }, maxItems: 12 },
    requiredTools: { type: 'array', items: { type: 'string' }, maxItems: 12 },
  },
  required: ['shouldStore', 'reason', 'name', 'content', 'summary', 'category', 'tags', 'contextRole', 'canonicalAnswer', 'workflowHints', 'requiredTools'],
  additionalProperties: false,
};

const fallbackModels = [
  DEFAULT_AUTOPILOT_MODEL,
  'googleai/gemini-2.5-flash',
  'openai/gpt-5.4-mini',
  'deepseek/deepseek-chat',
];

export async function learnFromConversation(input: {
  workspaceId?: string;
  transcript: string;
  closeContext?: string;
  existingKnowledge?: string;
  model: string;
  apiKeyCandidates: AiModelKeyCandidate[];
}): Promise<ConversationLearning> {
  const promptInput = {
    transcript: input.transcript.slice(0, 24000),
    closeContext: input.closeContext?.slice(0, 2000) || 'Nao informado.',
    existingKnowledge: input.existingKnowledge?.slice(0, 8000) || 'Nenhuma nota existente.',
  };

  const execute = async (model: string, apiKey: string) => {
    const common = {
      schema: ConversationLearningSchema,
      schemaName: 'dialogy_conversation_learning',
      jsonSchema,
      systemPrompt: instructions,
      userPrompt: [
        `Contexto de encerramento:\n${promptInput.closeContext}`,
        `Base atual resumida:\n${promptInput.existingKnowledge}`,
        `Historico:\n${promptInput.transcript}`,
      ].join('\n\n'),
      timeoutMs: 30000,
      maxTokens: 2200,
    };

    if (isLmStudioModel(model)) return requestLmStudioJson({ model, ...common });
    if (!isLmStudioModel(model)) return requestPlatformJson({ model, apiKey, ...common });

    const defaultKey = process.env.GOOGLE_GENAI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim();
    const prompt = apiKey === defaultKey
      ? defaultPrompt
      : genkit({ plugins: [googleAI({ apiKey })], model }).definePrompt(promptConfig);
    const result = await prompt(promptInput, { model });
    if (!result.output) throw new Error('A IA nao retornou um aprendizado estruturado.');
    return ConversationLearningSchema.parse(result.output);
  };

  const run = await runPlatformModel({
    workspaceId: input.workspaceId,
    label: 'conversationLearning',
    modelCandidates: [input.model, ...fallbackModels],
    apiKeyCandidates: input.apiKeyCandidates,
    maxAttemptsPerCandidate: 1,
    execute: ({ model, apiKey }) => execute(model, apiKey),
  });

  return run.result;
}
