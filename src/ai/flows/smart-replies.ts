

'use server';

/**
 * @fileOverview This file contains the Genkit flow for generating smart replies based on customer message content.
 *
 * - generateSmartReplies - A function that generates smart reply suggestions.
 * - SmartRepliesInput - The input type for the generateSmartReplies function.
 * - SmartRepliesOutput - The output type for the generateSmartReplies function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { logAutopilotUsage } from '@/actions/autopilot';
import { DEFAULT_AUTOPILOT_MODEL } from '@/lib/ai-models';
import { db } from '@/lib/db';
import { createClient } from '@/lib/supabase/server';


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
  const supabase = await createClient();
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
    : { id: 'default', ai_model: DEFAULT_AUTOPILOT_MODEL };

  // Check if we have a custom Gemini API Key
  if (config.gemini_api_key) {
    try {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(config.gemini_api_key);
      const model = genAI.getGenerativeModel({ model: config.ai_model || DEFAULT_AUTOPILOT_MODEL.replace(/^googleai\//, '') });

      const prompt = `You are an AI assistant helping support agents by suggesting quick replies to customer messages.
      
      Given the customer's message and the chat history, suggest 3 possible replies that the agent can use.
      The replies should be concise and relevant to the customer's message.
      Return ONLY a JSON array of strings, like this: ["Reply 1", "Reply 2", "Reply 3"]. Do not include markdown formatting like \`\`\`json.

      Chat History: ${input.chatHistory || ''}
      Customer Message: ${input.customerMessage}`;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      // Clean up potential markdown code blocks if the model ignores the instruction
      const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();

      let suggestedReplies: string[] = [];
      try {
        suggestedReplies = JSON.parse(cleanText);
      } catch (e) {
        console.error('Failed to parse JSON from Gemini response:', text);
        // Fallback: split by newlines if it's not JSON
        suggestedReplies = cleanText.split('\n').filter(line => line.trim().length > 0).slice(0, 3);
      }

      // Log usage manually since we are bypassing Genkit
      if (config.id && config.id !== 'default') {
        // Note: GoogleGenerativeAI doesn't always return token usage in the same format.
        // We'll estimate or skip for now, or check usageMetadata if available.
        const usageMetadata = response.usageMetadata;
        if (usageMetadata) {
          await logAutopilotUsage({
            configId: config.id,
            flowName: 'generateSmartRepliesFlow (Custom Key)',
            modelName: config.ai_model || DEFAULT_AUTOPILOT_MODEL,
            inputTokens: usageMetadata.promptTokenCount,
            outputTokens: usageMetadata.candidatesTokenCount,
            totalTokens: usageMetadata.totalTokenCount,
          });
        }
      }

      return { suggestedReplies };

    } catch (error) {
      console.error('Error using custom Gemini API Key:', error);
      // Fallback to default flow if custom key fails? 
      // Or throw error? Let's fall back to default flow as a safety net, 
      // but maybe the user wants to know it failed. 
      // For now, let's log and fall back.
    }
  }

  // Pass the full input including config to the flow
  const flowInput = { ...input, config };
  return generateSmartRepliesFlow(flowInput);
}


const prompt = ai.definePrompt({
  name: 'smartRepliesPrompt',
  input: { schema: SmartRepliesInputSchema },
  output: { schema: SmartRepliesOutputSchema },
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
    const model = input.config?.ai_model || DEFAULT_AUTOPILOT_MODEL;
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
        inputTokens: result.usage.inputTokens || 0,
        outputTokens: result.usage.outputTokens || 0,
        totalTokens: result.usage.totalTokens || 0,
      });
    }

    return output;
  }
);
