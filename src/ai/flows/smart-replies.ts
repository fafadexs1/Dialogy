// use server'

/**
 * @fileOverview This file contains the Genkit flow for generating smart replies based on customer message content.
 *
 * - generateSmartReplies - A function that generates smart reply suggestions.
 * - SmartRepliesInput - The input type for the generateSmartReplies function.
 * - SmartRepliesOutput - The output type for the generateSmartReplies function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const SmartRepliesInputSchema = z.object({
  customerMessage: z
    .string()
    .describe('The latest message from the customer in the chat.'),
  chatHistory: z
    .string()
    .optional()
    .describe('The history of the chat between the agent and customer.'),
});
export type SmartRepliesInput = z.infer<typeof SmartRepliesInputSchema>;

const SmartRepliesOutputSchema = z.object({
  suggestedReplies: z
    .array(z.string())
    .describe('An array of suggested reply messages for the agent to use.'),
});
export type SmartRepliesOutput = z.infer<typeof SmartRepliesOutputSchema>;

export async function generateSmartReplies(input: SmartRepliesInput): Promise<SmartRepliesOutput> {
  return generateSmartRepliesFlow(input);
}

const prompt = ai.definePrompt({
  name: 'smartRepliesPrompt',
  input: {schema: SmartRepliesInputSchema},
  output: {schema: SmartRepliesOutputSchema},
  prompt: `You are an AI assistant helping support agents by suggesting quick replies to customer messages.

  Given the customer's message and the chat history, suggest 3 possible replies that the agent can use.
  The replies should be concise and relevant to the customer's message.
  Format the replies as a numbered list in the suggestedReplies array.

  Chat History: {{{chatHistory}}}
  Customer Message: {{{customerMessage}}}
  `,
});

const generateSmartRepliesFlow = ai.defineFlow(
  {
    name: 'generateSmartRepliesFlow',
    inputSchema: SmartRepliesInputSchema,
    outputSchema: SmartRepliesOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
