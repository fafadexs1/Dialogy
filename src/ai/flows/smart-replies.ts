

'use server';

/**
 * @fileOverview This file contains the Genkit flow for generating smart replies based on customer message content.
 *
 * - generateSmartReplies - A function that generates smart reply suggestions.
 * - SmartRepliesInput - The input type for the generateSmartReplies function.
 * - SmartRepliesOutput - The output type for the generateSmartReplies function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import { logAutopilotUsage } from '@/actions/autopilot';
import { db } from '@/lib/db';
import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';


const SmartRepliesInputSchema = z.object({
  customerMessage: z
    .string()
    .describe('The latest message from the customer in the chat.'),
  chatHistory: z
    .string()
    .optional()
    .describe('The history of the chat between the agent and customer.'),
  workspaceId: z.string().describe("The ID of the current workspace to find the config."),
});
export type SmartRepliesInput = z.infer<typeof SmartRepliesInputSchema>;

const SmartRepliesOutputSchema = z.object({
  suggestedReplies: z
    .array(z.string())
    .describe('An array of suggested reply messages for the agent to use.'),
});
export type SmartRepliesOutput = z.infer<typeof SmartRepliesOutputSchema>;

// Extend the input schema for the flow to include the config object.
const SmartRepliesFlowInputSchema = SmartRepliesInputSchema.extend({
  config: z.any(),
});


export async function generateSmartReplies(input: SmartRepliesInput): Promise<SmartRepliesOutput> {
  const cookieStore = cookies();
  const supabase = createClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("User not authenticated.");
  }
  const userId = user.id;

  const configRes = await db.query(
    'SELECT * FROM autopilot_configs WHERE workspace_id = $1 AND user_id = $2',
    [input.workspaceId, userId]
  );
  
  // Use a default config if none is found to avoid breaking smart replies
  const config = configRes.rows.length > 0 
    ? configRes.rows[0]
    : { id: 'default', ai_model: 'googleai/gemini-2.0-flash' };
  
  // Pass the full input including config to the flow
  const flowInput = { ...input, config };
  return generateSmartRepliesFlow(flowInput);
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
    inputSchema: SmartRepliesFlowInputSchema,
    outputSchema: SmartRepliesOutputSchema,
  },
  async (input) => {
    const model = input.config?.ai_model || 'googleai/gemini-2.0-flash';
    // The prompt only receives the fields defined in its own input schema.
    const promptInput = SmartRepliesInputSchema.parse(input);
    const result = await prompt(promptInput, { model });
    const output = result.output!;

    // Log usage
    if (result.usage && input.config?.id && input.config.id !== 'default') {
        await logAutopilotUsage({
            configId: input.config.id,
            flowName: 'generateSmartRepliesFlow',
            modelName: model,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            totalTokens: result.usage.totalTokens,
        });
    }

    return output;
  }
);
