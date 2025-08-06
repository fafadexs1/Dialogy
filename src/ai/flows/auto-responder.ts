'use server';

/**
 * @fileOverview This file contains the Genkit flow for generating autonomous agent responses.
 *
 * - generateAgentResponse - A function that generates a complete response to a customer message.
 * - AgentResponseInput - The input type for the generateAgentResponse function.
 * - AgentResponseOutput - The output type for the generateAgentResponse function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const AgentResponseInputSchema = z.object({
  customerMessage: z
    .string()
    .describe('The latest message from the customer in the chat.'),
  chatHistory: z
    .string()
    .optional()
    .describe('The history of the chat between the agent and customer.'),
});
export type AgentResponseInput = z.infer<typeof AgentResponseInputSchema>;

const AgentResponseOutputSchema = z.object({
  response: z
    .string()
    .describe('The generated response to be sent to the customer.'),
});
export type AgentResponseOutput = z.infer<typeof AgentResponseOutputSchema>;

export async function generateAgentResponse(input: AgentResponseInput): Promise<AgentResponseOutput> {
  return autoResponderFlow(input);
}

const prompt = ai.definePrompt({
  name: 'autoResponderPrompt',
  input: {schema: AgentResponseInputSchema},
  output: {schema: AgentResponseOutputSchema},
  prompt: `You are an expert customer support agent acting as an "autopilot" for a human agent. 
  Your goal is to autonomously handle the conversation based on the provided history.
  
  Analyze the customer's last message in the context of the entire chat history and provide a complete, helpful, and concise response.
  Address the customer directly and professionally. Your response should fully resolve their query or move the conversation forward meaningfully.

  Chat History:
  {{{chatHistory}}}
  
  Customer's Latest Message:
  {{{customerMessage}}}
  
  Generate the appropriate response to be sent to the customer.`,
});

const autoResponderFlow = ai.defineFlow(
  {
    name: 'autoResponderFlow',
    inputSchema: AgentResponseInputSchema,
    outputSchema: AgentResponseOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
