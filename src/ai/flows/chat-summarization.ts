
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
  if (configRes.rowCount === 0) {
    throw new Error("Autopilot config not found for this user and workspace.");
  }
  const config = configRes.rows[0];

  const flowInput = { ...input, config };
  return summarizeChatFlow(flowInput);
}

const SummarizeChatFlowInputSchema = SummarizeChatInputSchema.extend({
  config: z.any(),
});

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
    const result = await summarizeChatPrompt({ chatHistory: input.chatHistory }, { model });
    const output = result.output!;

     // Log usage
    if (result.usage && input.config) {
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

    