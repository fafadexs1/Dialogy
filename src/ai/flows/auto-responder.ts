
'use server';

/**
 * @fileOverview This file contains the Genkit flow for a rule-based autonomous agent
 * that can use tools to gather information and respond to users.
 *
 * - generateAgentResponse - A function that evaluates a customer message and generates a response.
 * - AgentResponseInput - The input type for the generateAgentResponse function.
 * - AgentResponseOutput - The return type for the generateAgentResponse function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import type { NexusFlowInstance, Action, AutopilotConfig } from '@/lib/types';
import { makeHttpRequestTool } from '../tools/webhook-tool';
import { logAutopilotUsage } from '@/actions/autopilot';

// Define a schema for a single automation rule
const ActionSchema = z.union([
  z.object({
    type: z.literal('reply'),
    value: z.string().describe('The text response to send to the user.'),
  }),
  z.object({
    type: z.literal('webhook'),
    url: z.string().url().describe('The URL to send the HTTP request to.'),
    method: z.enum(['GET', 'POST']).default('POST'),
    body: z.record(z.any()).optional().describe('The JSON body for the request. You can use Handlebars variables like {{contact.id}}.'),
  }),
]);


const AutomationRuleSchema = z.object({
  name: z.string().describe('The name of the automation rule.'),
  trigger: z.string().describe('The condition that triggers the automation.'),
  action: ActionSchema,
});

const KnowledgeDocumentSchema = z.object({
  id: z.string(),
  name: z.string(),
  content: z.string(),
  summary: z.string().optional(),
});

const AgentResponseInputSchema = z.object({
  chatId: z.string().describe("The unique identifier for the current chat."),
  customerMessage: z
    .string()
    .describe('The latest message from the customer in the chat.'),
  chatHistory: z
    .string()
    .optional()
    .describe('The history of the chat between the agent and customer.'),
  rules: z.array(AutomationRuleSchema).describe('A list of active automation rules to evaluate against.'),
  knowledgeBase: z
    .string()
    .optional()
    .describe('A collection of texts, examples, and instructions that the AI should use as a knowledge base to formulate its answers.'),
  knowledgeBaseDocuments: z
    .array(KnowledgeDocumentSchema)
    .optional()
    .describe('Structured knowledge base documents uploaded by the user.'),
  fallbackReply: z
    .string()
    .optional()
    .describe('Mensagem de contingência para quando nenhuma resposta segura puder ser gerada.'),
  model: z.string().optional().describe('The AI model to use for the response.'),
  contact: z.object({ id: z.string(), name: z.string(), email: z.string().optional() })
    .describe('The contact details of the customer.'),
});

export type AgentResponseInput = z.infer<typeof AgentResponseInputSchema>;

const AgentResponseOutputSchema = z.object({
  response: z
    .string()
    .optional()
    .nullable()
    .describe('The generated response to be sent to the customer. This could be a direct text reply or the result from a webhook.'),
  triggeredRule: z
    .string()
    .optional()
    .nullable()
    .describe('The name of the rule that was triggered.'),
});
export type AgentResponseOutput = z.infer<typeof AgentResponseOutputSchema>;

// We create a new input schema for the Flow that includes the config object.
const AutoResponderFlowInputSchema = AgentResponseInputSchema.extend({
  config: z.any().describe("The autopilot config object from the database."),
  workspaceGeminiApiKey: z.string().optional().describe('Workspace-level Gemini key (Integrações > Gemini) used when the agent has no key.'),
});

export async function generateAgentResponse(input: z.infer<typeof AutoResponderFlowInputSchema>): Promise<AgentResponseOutput> {
  // We pass the full input (including config) to the flow
  return autoResponderFlow(input);
}

function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getNameVariants(name: string): string[] {
  const trimmed = name.trim();
  if (!trimmed) return [];
  const parts = trimmed.split(/\s+/).filter(Boolean);
  const first = parts[0] || '';
  const variants = new Set<string>();
  [trimmed, normalizeText(trimmed), first, normalizeText(first)].forEach((variant) => {
    if (variant && variant.length >= 2) {
      variants.add(variant);
    }
  });
  return Array.from(variants);
}

function historyContainsName(chatHistory: string | undefined, variants: string[]): boolean {
  if (!chatHistory || variants.length === 0) return false;
  const normalizedHistory = normalizeText(chatHistory);
  return variants.some((variant) => {
    const normalizedVariant = normalizeText(variant);
    if (!normalizedVariant) return false;
    const pattern = new RegExp(`\\b${escapeRegExp(normalizedVariant)}\\b`, 'i');
    return pattern.test(normalizedHistory);
  });
}

function stripRepeatedName(response: string, contactName: string, chatHistory?: string): string {
  const variants = getNameVariants(contactName);
  if (variants.length === 0 || !historyContainsName(chatHistory, variants)) return response;

  const namePattern = variants.map(escapeRegExp).join('|');
  if (!namePattern) return response;

  let updated = response;
  const greetingPattern = new RegExp(
    `^(\\s*(?:Olá|Ola|Oi|Oiê|Oie|Hey|Bom dia|Boa tarde|Boa noite)\\s*[,!]?\\s*)(${namePattern})(\\b[!,.]?\\s*)`,
    'i'
  );
  updated = updated.replace(greetingPattern, '$1');

  const startNamePattern = new RegExp(`^(\\s*)(${namePattern})(\\b[,:!\\-–—]?\\s*)`, 'i');
  updated = updated.replace(startNamePattern, '$1');

  const commaWrappedPattern = new RegExp(`,\\s*(${namePattern})\\s*,`, 'gi');
  updated = updated.replace(commaWrappedPattern, ',');

  const leadingCommaPattern = new RegExp(`,\\s*(${namePattern})(\\b)`, 'gi');
  updated = updated.replace(leadingCommaPattern, '');

  const trailingCommaPattern = new RegExp(`(${namePattern})\\s*,`, 'gi');
  updated = updated.replace(trailingCommaPattern, '');

  updated = updated.replace(/\s{2,}/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();

  return updated;
}

const greetingTokenRegex = /\b(ola|oi|oie|oii|hey|bom dia|boa tarde|boa noite)\b/i;
const emojiRegex = /\p{Extended_Pictographic}/u;
const emojiGlobalRegex = /\p{Extended_Pictographic}/gu;

function historyContainsGreeting(chatHistory?: string): boolean {
  if (!chatHistory) return false;
  const normalized = normalizeText(chatHistory);
  return greetingTokenRegex.test(normalized);
}

function containsEmoji(value?: string): boolean {
  if (!value) return false;
  return emojiRegex.test(value);
}

function getEmojiBudget(chatHistory?: string, customerMessage?: string): number {
  if (containsEmoji(customerMessage) || containsEmoji(chatHistory)) return 1;
  return 0;
}

function limitEmojis(response: string, maxEmojis: number): string {
  if (!response) return response;

  if (maxEmojis <= 0) {
    const stripped = response.replace(emojiGlobalRegex, '');
    return stripped.replace(/\s{2,}/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
  }

  let count = 0;
  emojiGlobalRegex.lastIndex = 0;
  const updated = response.replace(emojiGlobalRegex, (match) => {
    if (count < maxEmojis) {
      count += 1;
      return match;
    }
    return '';
  });

  return updated.replace(/\s{2,}/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
}

function stripRepeatedGreeting(response: string, chatHistory?: string): string {
  if (!response || !historyContainsGreeting(chatHistory)) return response;

  let updated = response;
  const greetingPattern = new RegExp(
    `^(\\s*(?:Ola|Ol\\u00e1|Oi|Oie|Oii|Hey|Bom dia|Boa tarde|Boa noite)\\s*[,!]?\\s*)`,
    'i'
  );
  updated = updated.replace(greetingPattern, '');
  updated = updated.replace(/^,\\s*/, '');
  updated = updated.replace(/\\s{2,}/g, ' ').replace(/\\s+([,.!?])/g, '$1').trim();

  return updated;
}

// --- Agent Prompt ---

// --- Agent Prompt Config ---
const promptConfig = {
  name: 'autoResponderPrompt',
  // tools: [makeHttpRequestTool],
  input: { schema: AgentResponseInputSchema },
  output: { schema: AgentResponseOutputSchema },
  prompt: `Você é um agente de atendimento virtual inteligente e empático.
Abaixo está a sua **DEFINIÇÃO DE PERSONA**. Você DEVE assumir esta identidade, tom de voz e nome.

---
**SUA IDENTIDADE (PERSONA)**:
{{{knowledgeBase}}}
---

Se a definição acima estiver vazia, assuma que você é 'Dialogy', um assistente virtual útil e profissional.

**ANÁLISE DE CONTEXTO E EMOÇÃO**:
1. **Intenção**: Identifique o que o usuário quer AGORA. Use o histórico (até 15 msgs) para entender o fluxo.
2. **Emoção**: Sinta a emoção do usuário (frustração, dúvida, gratidão, raiva).
   - Se o usuário estiver frustrado/irritado: Peça desculpas, seja objetivo e resolva rápido. NÃO use piadas.
   - Se o usuário estiver confuso: Seja extremamente didático, "explique como se eu tivesse 5 anos".
   - Se o usuário estiver neutro/feliz: Mantenha o tom cordial e eficiente.
3. **Tom de Voz**: Seja sempre educado, paciente e inteligente.
   - Explique termos técnicos se necessário.
   - Nunca seja arrogante ou robótico.
   - **NÃO repita o nome do usuário**. Use no máximo 1x por conversa e apenas na primeira resposta ou se for realmente necessário.
   - Se o nome já aparecer no histórico ou em uma mensagem anterior sua, **não use novamente**.
   - Prefira saudações sem nome (ex: "Olá!") ou comece direto com a resposta.
   - Evite repeticao: nao repita saudacoes, frases prontas ou a mesma pergunta em respostas seguidas.
   - Se ja cumprimentou ou ofereceu ajuda no historico recente, va direto ao ponto.
   - Emojis: use com moderacao. No maximo 1 por mensagem e apenas se o usuario usar emojis ou o tom for informal.
   - Evite emojis em temas serios ou quando o usuario estiver frustrado/irritado.

**DIRETRIZES DE RESPOSTA**:
1. **Prioridade Máxima (Regras)**:
    - Verifique **REGRAS DE AUTOMAÇÃO**. Se o gatilho for acionado, siga a regra cegamente.
2. **Base de Conhecimento**:
    - Use os **DOCUMENTOS CARREGADOS** para fatos e procedimentos.
3. **Resposta Natural**:
    - Se não houver regra, construa uma resposta baseada na sua persona + documentos + análise emocional.

---\n
**DOCUMENTOS CARREGADOS (Base de Conhecimento)**:
{{#each knowledgeBaseDocuments}}
### {{name}}
{{{content}}}
{{/each}}

---
**REGRAS DE AUTOMAÇÃO**:
{{#each rules}}
- Nome: "{{name}}"
  - Gatilho: "{{trigger}}"
  - Ação: {{json action}}
{{/each}}
---
**DADOS DO CONTATO**:
{{json contact}}
---
**HISTÓRICO DO CHAT (Contexto Recente)**:
{{#if chatHistory}}
{{{chatHistory}}}
{{else}}
(Sem histórico anterior)
{{/if}}
---
**RESPOSTA DE CONTINGÊNCIA**:
{{{fallbackReply}}}
---
**ÚLTIMA MENSAGEM DO CLIENTE**:
{{{customerMessage}}}

Com base na sua persona, nos documentos e na emoção identificada, responda ao cliente.`,
};

// Default prompt with global AI
const globalPrompt = ai.definePrompt(promptConfig);

const autoResponderFlow = ai.defineFlow(
  {
    name: 'autoResponderFlow',
    inputSchema: AutoResponderFlowInputSchema,
    outputSchema: AgentResponseOutputSchema,
  },
  async (input) => {
    const model = input.model || 'googleai/gemini-2.0-flash';
    const promptInput = AgentResponseInputSchema.parse({
      ...input,
      knowledgeBaseDocuments: input.knowledgeBaseDocuments ?? input.config?.knowledge_base_documents ?? [],
      fallbackReply: input.fallbackReply ?? input.config?.default_fallback_reply ?? '',
    });

    // 1. Resolve Gemini API key (agent -> workspace integration -> env)
    const configKey = input.config?.gemini_api_key?.trim();
    const workspaceKey = input.workspaceGeminiApiKey?.trim();
    const envKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_GENAI_API_KEY?.trim();
    const apiKey = configKey || workspaceKey || (envKey && envKey !== 'no-key-configured' ? envKey : '');

    if (!apiKey) {
      console.error('[AUTORESPONDER_FLOW_ERROR] Nenhuma chave de API encontrada (Config, Integrações ou ENV).');
      throw new Error('Chave Gemini não configurada. Configure em Integrações > Google Gemini.');
    }

    let effectivePrompt = globalPrompt;

    // Use a dynamic Genkit instance when we are overriding the default env key
    const defaultEnvKey = process.env.GOOGLE_GENAI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim();
    if (!defaultEnvKey || defaultEnvKey !== apiKey) {
      const { genkit } = require('genkit');
      const { googleAI } = require('@genkit-ai/googleai');

      const dynamicAi = genkit({
        plugins: [googleAI({ apiKey })],
        model: model,
        // tools: [makeHttpRequestTool],
      });
      effectivePrompt = dynamicAi.definePrompt(promptConfig);
    }
    let output: AgentResponseOutput | null = null;
    try {
      const result = await effectivePrompt(promptInput, { model });
      output = result.output;

      // Log usage in the background without awaiting it.
      // This allows the flow to return faster.
      if (result.usage && input.config?.id) {
        logAutopilotUsage({
          configId: input.config.id,
          flowName: 'autoResponderFlow',
          modelName: model,
          inputTokens: result.usage.inputTokens ?? 0,
          outputTokens: result.usage.outputTokens ?? 0,
          totalTokens: result.usage.totalTokens ?? 0,
          ruleName: output?.triggeredRule ?? undefined,
        }).catch(err => {
          // Log the error but don't block the main flow.
          console.error("[AUTOPILOT_USAGE_LOG_ERROR]", err);
        });
      }
    } catch (error) {
      console.error('[AUTORESPONDER_FLOW_ERROR] Error calling prompt:', error);
      // Do not re-throw; allow the flow to proceed to fallback logic.
      output = null;
    }

    // Only return a response if the AI decided a rule was triggered or it could answer.
    // This also prevents returning `null` values which would violate the Zod schema.
    if (output?.response && output.response.trim() !== '') {
      const emojiBudget = getEmojiBudget(input.chatHistory, input.customerMessage);
      const sanitized = limitEmojis(
        stripRepeatedGreeting(
          stripRepeatedName(output.response, input.contact?.name ?? '', input.chatHistory),
          input.chatHistory
        ),
        emojiBudget
      );
      const response = sanitized.trim() ? sanitized : output.response;
      return { ...output, response };
    }
    const fallback = input.config?.default_fallback_reply?.trim();
    if (fallback) {
      const emojiBudget = getEmojiBudget(input.chatHistory, input.customerMessage);
      const sanitized = limitEmojis(
        stripRepeatedGreeting(
          stripRepeatedName(fallback, input.contact?.name ?? '', input.chatHistory),
          input.chatHistory
        ),
        emojiBudget
      );
      const response = sanitized.trim() ? sanitized : fallback;
      return {
        response,
        triggeredRule: output?.triggeredRule ?? null,
      };
    }
    // Otherwise, return an empty object, indicating no action should be taken.
    return {};
  }
);
