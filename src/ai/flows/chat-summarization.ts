
'use server';

/**
 * @fileOverview This file implements the chat summarization flow.
 *
 * - summarizeChat - A function that summarizes a chat history into key points.
 * - SummarizeChatInput - The input type for the summarizeChat function.
 * - SummarizeChatOutput - The return type for the summarizeChat function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import { logAutopilotUsage } from '@/actions/autopilot';
import type { AutopilotConfig } from '@/lib/types';
import { db } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

const SummarizeChatInputSchema = z.object({
  chatHistory: z.string().describe('The complete chat history to summarize.'),
  workspaceId: z.string().describe("The ID of the current workspace to find the config."),
});

export type SummarizeChatInput = z.infer<typeof SummarizeChatInputSchema>;

const SummarizeChatOutputSchema = z.object({
  summary: z.string().describe('A concise summary of the chat history.'),
});

export type SummarizeChatOutput = z.infer<typeof SummarizeChatOutputSchema>;

// Extend the input schema for the flow to include the config object.
const SummarizeChatFlowInputSchema = SummarizeChatInputSchema.extend({
  config: z.any(),
});


export async function summarizeChat(input: SummarizeChatInput): Promise<SummarizeChatOutput> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error("User not authenticated.");
  }
  const userId = session.user.id;

  const configRes = await db.query(
    'SELECT * FROM autopilot_configs WHERE workspace_id = $1 AND user_id = $2',
    [input.workspaceId, userId]
  );
  
  // Use a default config if none is found to avoid breaking summarization
  const config = configRes.rows.length > 0 
    ? configRes.rows[0]
    : { id: 'default', ai_model: 'googleai/gemini-2.0-flash' };

  // Pass the full input including config to the flow
  const flowInput = { ...input, config };
  return summarizeChatFlow(flowInput);
}


const summarizeChatPrompt = ai.definePrompt({
  name: 'summarizeChatPrompt',
  input: {schema: SummarizeChatInputSchema},
  output: {schema: SummarizeChatOutputSchema},
  prompt: `Summarize the following chat history into key points, focusing on the main issues discussed and the resolutions provided.  The summary should be concise and easy to understand for a support agent who needs to quickly grasp the context of the conversation.\n\nChat History:\n{{{chatHistory}}}`,
});

const summarizeChatFlow = ai.defineFlow(
  {
    name: 'summarizeChatFlow',
    inputSchema: SummarizeChatFlowInputSchema,
    outputSchema: SummarizeChatOutputSchema,
  },
  async (input) => {
    const model = input.config?.ai_model || 'googleai/gemini-2.0-flash';
    // The prompt only receives the fields defined in its own input schema.
    const promptInput = SummarizeChatInputSchema.parse(input);
    const result = await summarizeChatPrompt(promptInput, { model });
    const output = result.output!;

     // Log usage
    if (result.usage && input.config && input.config.id !== 'default') {
        await logAutopilotUsage({
            configId: input.config.id,
            flowName: 'summarizeChatFlow',
            modelName: model,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            totalTokens: result.usage.totalTokens,
        });
    }

    return output;
  }
);
