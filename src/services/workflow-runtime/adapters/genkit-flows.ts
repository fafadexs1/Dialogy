import type { Genkit } from 'genkit';
import { z } from 'zod';
import { AgentDecisionSchema } from '../schemas';

export const WorkflowAgentDecisionFlowInputSchema = z.object({
  model: z.string().min(1),
  systemPrompt: z.string().min(1),
  conversation: z.array(z.object({
    role: z.enum(['user', 'assistant', 'tool']),
    content: z.string(),
  })),
  temperature: z.number().min(0).max(2).default(0.2),
  maxOutputTokens: z.number().int().positive().default(2_048),
});

export function defineWorkflowAgentDecisionFlow(ai: Genkit) {
  return ai.defineFlow(
    {
      name: 'workflowAgentDecision',
      inputSchema: WorkflowAgentDecisionFlowInputSchema,
      outputSchema: AgentDecisionSchema,
    },
    async (input) => {
      const { output } = await ai.generate({
        model: input.model,
        prompt: [
          `SYSTEM\n${input.systemPrompt}`,
          ...input.conversation.map((message) => `${message.role.toUpperCase()}\n${message.content}`),
        ].join('\n\n'),
        config: {
          temperature: input.temperature,
          maxOutputTokens: input.maxOutputTokens,
        },
        output: {
          schema: AgentDecisionSchema,
        },
      });
      if (!output) {
        const error = new Error('Genkit returned no structured agent decision.') as Error & {
          code?: string;
          retryable?: boolean;
        };
        error.code = 'INVALID_STRUCTURED_OUTPUT';
        error.retryable = true;
        throw error;
      }
      return AgentDecisionSchema.parse(output);
    },
  );
}

