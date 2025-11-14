
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
});

export async function generateAgentResponse(input: z.infer<typeof AutoResponderFlowInputSchema>): Promise<AgentResponseOutput> {
    // We pass the full input (including config) to the flow
    return autoResponderFlow(input);
}

// --- Agent Prompt ---

const prompt = ai.definePrompt({
  name: 'autoResponderPrompt',
  tools: [makeHttpRequestTool],
  input: { schema: AgentResponseInputSchema },
  output: { schema: AgentResponseOutputSchema },
  prompt: `VocǦ Ǹ 'Dialogy', um copiloto autônomo especialista em atendimento ao cliente. VocǦ interpreta arquivos treinados, segue regras rígidas e pode acionar integra����es externas para resolver o que o cliente precisa. Seja proativo, didático e transparente ao usar dados externos.

Siga esta hierarquia de mǸtodos para gerar uma resposta:

1.  **Regras de Automa��ǜo (Prioridade Mǭxima)**: Avalie a mensagem do cliente em rela��ǜo ��s "Regras de Automa��ǜo". Use seu racioc��nio para ver se a inten��ǜo corresponde claramente a um gatilho.
    - Se a regra for do tipo 'reply', retorne exatamente o value daquela a��ǜo em 'response' e informe 'triggeredRule'.
    - Se a regra for do tipo 'webhook', use a ferramenta 'makeHttpRequestTool' passando url, method e body previstos (placeholders como {{contact.id}} podem ser usados). Resuma ao cliente o resultado dessa chamada.

2.  **Base de Conhecimento**: Se nenhuma regra for aplicǭvel, consulte os textos e DOCUMENTOS carregados para responder com dados oficiais. Nunca invente informa����es.

3.  **Conhecimento Geral + Hist��rico**: Se ainda assim faltar algo, use o contexto da conversa e descreva claramente o pr��ximo passo (coletar dados, escalar para humano, etc.).

**IMPORTANTE**:
- Seja conciso e direto.
- Se nenhuma fonte (regras/base/conhecimento geral) permitir uma resposta segura, retorne vazio em 'response' ou use a resposta de contingência abaixo.

---
**BASE DE CONHECIMENTO (Use para responder perguntas)**:
{{{knowledgeBase}}}

---
**DOCUMENTOS CARREGADOS (conhecimento treinado)**:
{{#each knowledgeBaseDocuments}}
### {{name}}
{{{content}}}
{{/each}}

---
**REGRAS DE AUTOMA��ǟO (prioridade mǭxima)**:
{{#each rules}}
- Nome da Regra: "{{name}}"
  - Gatilho: "{{trigger}}"
  - A��ǜo: {{json action}}
{{/each}}
---
**DADOS DO CONTATO ATUAL (para interpolar nos webhooks)**:
{{json contact}}
---
**HIST�"RICO DO CHAT (Para contexto)**:
{{{chatHistory}}}
---
**RESPOSTA PADRǕO DE CONTING�NCIA (use somente se nada funcionar)**:
{{{fallbackReply}}}
---
**�sLTIMA MENSAGEM DO CLIENTE**:
{{{customerMessage}}}

Agora, avalie e responda.`,
});

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
    const result = await prompt(promptInput, { model });
    const output = result.output;
    
    // Log usage in the background without awaiting it.
    // This allows the flow to return faster.
    if (result.usage && input.config?.id) {
        logAutopilotUsage({
            configId: input.config.id,
            flowName: 'autoResponderFlow',
            modelName: model,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            totalTokens: result.usage.totalTokens,
            ruleName: output?.triggeredRule ?? undefined,
        }).catch(err => {
            // Log the error but don't block the main flow.
            console.error("[AUTOPILOT_USAGE_LOG_ERROR]", err);
        });
    }

    // Only return a response if the AI decided a rule was triggered or it could answer.
    // This also prevents returning `null` values which would violate the Zod schema.
    if (output?.response && output.response.trim() !== '') {
        return output;
    }
    const fallback = input.config?.default_fallback_reply?.trim();
    if (fallback) {
        return {
            response: fallback,
            triggeredRule: output?.triggeredRule ?? null,
        };
    }
    // Otherwise, return an empty object, indicating no action should be taken.
    return {};
  }
);
