'use server';
import { getCurrentUser } from '@/actions/user';
import { hasWorkspacePermission } from '@/lib/workspace-permissions';
import { generateSummary } from '@/lib/genkit';
export type SummarizeChatInput = {chatHistory:string;workspaceId:string};
export type SummarizeChatOutput = {summary:string};
export async function summarizeChat(input:SummarizeChatInput):Promise<SummarizeChatOutput> {
  const user = await getCurrentUser();
  if (!user || !await hasWorkspacePermission(user.id,input.workspaceId,'inbox:access')) throw new Error('Acesso negado ao workspace.');
  return {summary:await generateSummary(input.chatHistory,undefined,undefined,input.workspaceId)};
}
