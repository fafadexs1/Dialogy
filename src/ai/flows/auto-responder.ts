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

// --- Agent Tools ---

const getCustomerDetailsTool = ai.defineTool(
    {
        name: 'getCustomerDetails',
        description: 'Get details about the customer, such as their name, email, and company, using the chat ID.',
        inputSchema: z.object({ chatId: z.string() }),
        outputSchema: z.object({
            name: z.string(),
            email: z.string().optional(),
            company: z.string().optional(),
        }),
    },
    async ({ chatId }) => {
        console.log(`[AUTOPILOT_TOOL] Executando getCustomerDetails para o chat: ${chatId}`);
        const chatRes = await db.query(
            `SELECT 
                ct.name, 
                ct.email,
                -- Mock company name for now, as it's not in the contacts table.
                'InnovateTech' as company
             FROM chats c
             JOIN contacts ct ON c.contact_id = ct.id
             WHERE c.id = $1`,
            [chatId]
        );

        if (chatRes.rowCount === 0) {
            console.log(`[AUTOPILOT_TOOL] Nenhum contato encontrado para o chat: ${chatId}`);
            return { name: 'Cliente não encontrado' };
        }
        
        console.log(`[AUTOPILOT_TOOL] Detalhes encontrados:`, chatRes.rows[0]);
        return chatRes.rows[0];
    }
);


// --- Agent Prompt ---

const prompt = ai.definePrompt({
  name: 'autoResponderPrompt',
  input: { schema: AgentResponseInputSchema },
  output: { schema: AgentResponseOutputSchema },
  tools: [getCustomerDetailsTool],
  prompt: `You are an AI customer service agent. Your goal is to resolve the customer's issue efficiently and courteously.

You have three methods to generate a response, in this order of priority:

1.  **Automation Rules**: First, evaluate the "Customer's Latest Message" against the "Automation Rules".
    - Use your reasoning to see if the customer's *intent* matches a rule's trigger. The match does not need to be literal.
    - If a rule is triggered, you MUST output the exact "action" text from that rule in the 'response' field and the rule's name in the 'triggeredRule' field.

2.  **Tools**: If no automation rule is triggered, consider if you need more information to give a good answer.
    - You have access to tools. If the user asks who they are, or you need their details to answer a question, use the 'getCustomerDetails' tool.
    - After using a tool, formulate a helpful response based on the information you received.

3.  **General Knowledge**: If no rules or tools are appropriate, use the "Chat History" for context and your general knowledge to provide a helpful, conversational response.

**IMPORTANT**:
- If you cannot help or no rule is triggered, you MUST return an empty response. Do not invent answers.
- Use the provided "Chat History" to understand the context of the conversation and avoid repeating questions.

**Automation Rules**:
{{#each rules}}
- Rule Name: "{{name}}"
  - Trigger: "{{trigger}}"
  - Action: "{{action}}"
{{/each}}

**Chat History (for context)**:
{{{chatHistory}}}

**Customer's Latest Message**:
{{{customerMessage}}}

Now, evaluate and respond.`,
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
