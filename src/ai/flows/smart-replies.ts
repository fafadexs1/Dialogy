'use server';
import { requestPlatformJson } from '@/services/ai/platform-json';

import { z } from 'genkit';
import { getCurrentUser } from '@/actions/user';
import { hasWorkspacePermission } from '@/lib/workspace-permissions';
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


export async function generateSmartReplies(input: SmartRepliesInput): Promise<SmartRepliesOutput> {
  const user = await getCurrentUser();
  if (!user || !await hasWorkspacePermission(user.id,input.workspaceId,'inbox:access')) throw new Error('Acesso negado ao workspace.');
  return requestPlatformJson({ workspaceId:input.workspaceId, model:'',apiKey:'', schema:SmartRepliesOutputSchema,
    schemaName:'dialogy_smart_replies',jsonSchema:{ type:'object',properties:{suggestedReplies:{type:'array',items:{type:'string'}}},required:['suggestedReplies'],additionalProperties:false },
    systemPrompt:'Sugira tres respostas curtas e relevantes para um atendente humano, com base somente na conversa.',
    userPrompt:JSON.stringify({history:input.chatHistory,message:input.customerMessage}),maxTokens:500,timeoutMs:15000 });
}
