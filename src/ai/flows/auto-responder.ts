
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
  prompt: `Você é 'Dialogy', um assistente de IA especialista em atendimento ao cliente. Seu objetivo é resolver o problema do cliente de forma eficiente, precisa e cortês.

Siga esta hierarquia de métodos para gerar uma resposta:

1.  **Regras de Automação (Prioridade Máxima)**: Avalie a mensagem do cliente em relação às "Regras de Automação". Use seu raciocínio para ver se a *intenção* da mensagem corresponde claramente a um gatilho.
    - Se uma regra for acionada e a ação for do tipo 'reply', você DEVE retornar o "value" exato daquela ação no campo 'response' e o nome da regra em 'triggeredRule'.
    - Se a regra for do tipo 'webhook', você DEVE usar a ferramenta 'makeHttpRequestTool' para executar a chamada. Passe a 'url', 'method', e 'body' da regra para a ferramenta. A resposta da ferramenta será o seu 'response' final.

2.  **Base de Conhecimento**: Se nenhuma regra for aplicável, consulte a "Base de Conhecimento" para encontrar informações relevantes para responder à pergunta do cliente.

3.  **Conhecimento Geral**: Se nem as regras nem a base de conhecimento fornecerem uma resposta, use seu conhecimento geral e o "Histórico do Chat" para ter uma conversa útil e natural.

**IMPORTANTE**:
- Seja conciso e direto.
- Se nenhuma das suas fontes de conhecimento (regras, base, geral) permitir que você dê uma resposta útil e precisa, você DEVE retornar uma resposta vazia no campo 'response'. Não invente informações.

---
**BASE DE CONHECIMENTO (Use para responder perguntas)**:
{{{knowledgeBase}}}
---
**REGRAS DE AUTOMAÇÃO (Prioridade máxima se a intenção corresponder)**:
{{#each rules}}
- Nome da Regra: "{{name}}"
  - Gatilho: "{{trigger}}"
  - Ação: {{json action}}
{{/each}}
---
**DADOS DO CONTATO ATUAL (Para usar em variáveis no body do webhook)**:
{{json contact}}
---
**HISTÓRICO DO CHAT (Para contexto)**:
{{{chatHistory}}}
---
**ÚLTIMA MENSAGEM DO CLIENTE**:
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
    // The prompt only receives the fields defined in its own input schema.
    const promptInput = AgentResponseInputSchema.parse(input);
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
    // Otherwise, return an empty object, indicating no action should be taken.
    return {};
  }
);
