'use server';

/**
 * @fileOverview This file contains the Genkit flow for a rule-based autonomous agent.
 *
 * - generateAgentResponse - A function that evaluates a customer message against a set of rules and generates a response if a rule is triggered.
 * - AgentResponseInput - The input type for the generateAgentResponse function.
 * - AgentResponseOutput - The output type for the generateAgentResponse function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import type { NexusFlowInstance } from '@/lib/types';

// Define a schema for a single automation rule
const AutomationRuleSchema = z.object({
  name: z.string().describe('The name of the automation rule.'),
  trigger: z.string().describe('The condition that triggers the automation.'),
  action: z.string().describe('The response to be sent if the trigger condition is met.'),
});

const AgentResponseInputSchema = z.object({
  customerMessage: z
    .string()
    .describe('The latest message from the customer in the chat.'),
  chatHistory: z
    .string()
    .optional()
    .describe('The history of the chat between the agent and customer.'),
  rules: z.array(AutomationRuleSchema).describe('A list of active automation rules to evaluate against.'),
});
export type AgentResponseInput = z.infer<typeof AgentResponseInputSchema>;

const AgentResponseOutputSchema = z.object({
  response: z
    .string()
    .optional()
    .describe('The generated response to be sent to the customer. This should only be present if a rule was triggered.'),
  triggeredRule: z
    .string()
    .optional()
    .describe('The name of the rule that was triggered.'),
});
export type AgentResponseOutput = z.infer<typeof AgentResponseOutputSchema>;


// We need to pass the rules in a format that the prompt can use.
// The input to the flow will be slightly different from the input to the prompt.
interface AutoResponderFlowInput {
    customerMessage: string;
    chatHistory?: string;
    rules: NexusFlowInstance[];
}

export async function generateAgentResponse(input: AutoResponderFlowInput): Promise<AgentResponseOutput> {
  // Convert the NexusFlowInstance[] to a format that matches AutomationRuleSchema[]
  const promptInput = {
      ...input,
      rules: input.rules.map(r => ({ name: r.name, trigger: r.trigger, action: r.action }))
  };
  return autoResponderFlow(promptInput);
}

const prompt = ai.definePrompt({
  name: 'autoResponderPrompt',
  input: { schema: AgentResponseInputSchema },
  output: { schema: AgentResponseOutputSchema },
  prompt: `You are an AI assistant that evaluates a customer support conversation against a set of automation rules.
  Your task is to determine if the customer's latest message triggers any of the provided rules.

  - Carefully analyze the "Customer's Latest Message" in the context of the "Chat History".
  - Compare the message against each rule's "trigger" description.
  - If you find a clear match, your output must be the exact "action" text from the matched rule.
  - If a rule is triggered, set the 'triggeredRule' field to the name of the rule.
  - If NO rule is triggered, you MUST return an empty 'response' field. Do not try to answer the customer's question yourself.

  Rules to evaluate:
  {{#each rules}}
  - Rule Name: "{{name}}"
    - Trigger: "{{trigger}}"
    - Action: "{{action}}"
  {{/each}}

  Chat History:
  {{{chatHistory}}}
  
  Customer's Latest Message:
  {{{customerMessage}}}
  
  Now, evaluate and generate the response if a rule is triggered.`,
});


const autoResponderFlow = ai.defineFlow(
  {
    name: 'autoResponderFlow',
    inputSchema: AgentResponseInputSchema,
    outputSchema: AgentResponseOutputSchema,
  },
  async (input) => {
    const { output } = await prompt(input);
    // Only return a response if the AI decided a rule was triggered.
    if (output?.response && output.response.trim() !== '') {
        return output;
    }
    // Otherwise, return an empty object, indicating no action should be taken.
    return {};
  }
);
