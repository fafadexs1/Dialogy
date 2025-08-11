'use server';

/**
 * @fileOverview This file contains the Genkit flow for a rule-based autonomous agent
 * that can use tools to gather information and respond to users.
 *
 * - generateAgentResponse - A function that evaluates a customer message and generates a response.
 * - AgentResponseInput - The input type for the generateAgentResponse function.
 * - AgentResponseOutput - The output type for the generateAgentResponse function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import type { NexusFlowInstance } from '@/lib/types';
import { db } from '@/lib/db';

// Define a schema for a single automation rule
const AutomationRuleSchema = z.object({
  name: z.string().describe('The name of the automation rule.'),
  trigger: z.string().describe('The condition that triggers the automation.'),
  action: z.string().describe('The response to be sent if the trigger condition is met.'),
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
});
export type AgentResponseInput = z.infer<typeof AgentResponseInputSchema>;

const AgentResponseOutputSchema = z.object({
  response: z
    .string()
    .optional()
    .describe('The generated response to be sent to the customer. This should only be present if a rule was triggered or the AI generated a response.'),
  triggeredRule: z
    .string()
    .optional()
    .describe('The name of the rule that was triggered.'),
});
export type AgentResponseOutput = z.infer<typeof AgentResponseOutputSchema>;


// We need to pass the rules in a format that the prompt can use.
// The input to the flow will be slightly different from the input to the prompt.
interface AutoResponderFlowInput {
    chatId: string;
    customerMessage: string;
    chatHistory?: string;
    rules: NexusFlowInstance[];
    knowledgeBase?: string;
    model?: string;
}

export async function generateAgentResponse(input: AutoResponderFlowInput): Promise<AgentResponseOutput> {
  const promptInput = {
      ...input,
      rules: input.rules.map(r => ({ name: r.name, trigger: r.trigger, action: r.action }))
  };
  return autoResponderFlow(promptInput);
}

// --- Agent Prompt ---

const prompt = ai.definePrompt({
  name: 'autoResponderPrompt',
  input: { schema: AgentResponseInputSchema },
  output: { schema: AgentResponseOutputSchema },
  prompt: `Você é 'Dialogy', um assistente de IA prestativo. Seu objetivo é resolver o problema do cliente de forma eficiente e cortês.

Você tem uma hierarquia de métodos para gerar uma resposta. Siga esta ordem estritamente:

1.  **Regras de Automação**: Primeiro, avalie a mensagem do cliente em relação às "Regras de Automação".
    - Use seu raciocínio para ver se a *intenção* da mensagem do cliente corresponde ao gatilho de uma regra. A correspondência não precisa ser literal.
    - Se uma regra for acionada, você DEVE retornar a "ação" exata daquela regra no campo 'response' e o nome da regra no campo 'triggeredRule'.

2.  **Conhecimento Geral**: Se nenhuma regra for apropriada, use seu conhecimento geral e o "Histórico do Chat" para fornecer uma resposta útil e conversacional. Isso inclui responder a perguntas simples como "qual o seu nome?".

**IMPORTANTE**:
- Se você não puder ajudar ou nenhuma regra for acionada, você DEVE retornar uma resposta vazia. Não invente respostas.
- Use o "Histórico do Chat" fornecido para entender o contexto da conversa e evitar repetir perguntas.

**Regras de Automação**:
{{#each rules}}
- Nome da Regra: "{{name}}"
  - Gatilho: "{{trigger}}"
  - Ação: "{{action}}"
{{/each}}

**Histórico do Chat (para contexto)**:
{{{chatHistory}}}

**Última Mensagem do Cliente**:
{{{customerMessage}}}

Agora, avalie e responda.`,
});


const autoResponderFlow = ai.defineFlow(
  {
    name: 'autoResponderFlow',
    inputSchema: AgentResponseInputSchema,
    outputSchema: AgentResponseOutputSchema,
  },
  async (input) => {
    // The model is passed directly in the options object to the prompt.
    const { output } = await prompt(input, { model: input.model });
    
    // Only return a response if the AI decided a rule was triggered or it could answer.
    if (output?.response && output.response.trim() !== '') {
        return output;
    }
    // Otherwise, return an empty object, indicating no action should be taken.
    return {};
  }
);
