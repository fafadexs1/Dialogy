'use server';

/**
 * @fileOverview A Genkit tool for making HTTP requests (webhooks).
 */
import { ai } from '@/ai/genkit';
import { z } from 'genkit';

// Define the input schema for the tool
const WebhookInputSchema = z.object({
  url: z.string().url().describe('The URL to send the request to.'),
  method: z.enum(['GET', 'POST']).default('POST').describe('The HTTP method to use.'),
  body: z.record(z.any()).optional().describe('The JSON payload to send with a POST request.'),
});

export const makeHttpRequestTool = ai.defineTool(
  {
    name: 'makeHttpRequest',
    description: 'Makes an HTTP request to a specified URL (webhook) and returns the response.',
    input: { schema: WebhookInputSchema },
    output: { schema: z.string().describe('The stringified JSON response from the webhook.') },
  },
  async (input) => {
    console.log('[WEBHOOK_TOOL] Executing webhook request:', input);
    try {
      const response = await fetch(input.url, {
        method: input.method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: input.body ? JSON.stringify(input.body) : undefined,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[WEBHOOK_TOOL] HTTP Error ${response.status}: ${errorText}`);
        throw new Error(`Request failed with status ${response.status}: ${errorText}`);
      }
      
      const responseData = await response.json();
      console.log('[WEBHOOK_TOOL] Received response:', responseData);

      // Return the response as a string, as required by the output schema.
      return JSON.stringify(responseData);
    } catch (error: any) {
      console.error('[WEBHOOK_TOOL] Failed to execute webhook:', error);
      return `Error: ${error.message}`;
    }
  }
);
