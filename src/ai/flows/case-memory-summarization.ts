import { requestPlatformJson } from '@/services/ai/platform-json';
import { toJsonSchema } from 'genkit/schema';
import { z } from 'genkit';
import { ai } from '@/ai/genkit';
import { logAutopilotUsage } from '@/actions/autopilot';
import { DEFAULT_AUTOPILOT_MODEL } from '@/lib/ai-models';
import {
  isLmStudioModel,
} from '@/services/ai/lm-studio';
import { requestLmStudioJson } from '@/services/ai/lm-studio-client';

const CaseMemoryInputSchema = z.object({
  workspaceId: z.string(),
  chatHistory: z.string(),
  closeReasonLabel: z.string().optional(),
  closeNotes: z.string().optional(),
  contactName: z.string().optional(),
  channel: z.string().optional(),
  model: z.string().optional(),
  apiKey: z.string().optional(),
  autopilotConfigId: z.string().optional(),
});

const CaseMemoryOutputSchema = z.object({
  shouldStore: z.boolean().describe('True when the case has enough signal to be reused in future support conversations.'),
  summary: z.string().describe('A concise summary of the case.'),
  problem: z.string().describe('The customer problem in one or two sentences.'),
  resolution: z.string().describe('How the issue was resolved or what procedure should be followed.'),
  outcome: z.string().describe('The final result of the case.'),
  keywords: z.array(z.string()).max(10).describe('Operational keywords for retrieval.'),
});

export type CaseMemoryInput = z.infer<typeof CaseMemoryInputSchema>;
export type CaseMemoryOutput = z.infer<typeof CaseMemoryOutputSchema>;


export async function summarizeCaseMemory(input: CaseMemoryInput): Promise<CaseMemoryOutput> {
  return requestPlatformJson({workspaceId:input.workspaceId,model:'',apiKey:'',schema:CaseMemoryOutputSchema,
    schemaName:'dialogy_case_memory',jsonSchema:toJsonSchema({schema:CaseMemoryOutputSchema})!,
    systemPrompt:'Condense um atendimento encerrado para memoria operacional reutilizavel. Use somente fatos presentes no historico. Remova dados pessoais desnecessarios. Se nao houver resolucao clara, use shouldStore=false.',
    userPrompt:JSON.stringify({history:input.chatHistory,channel:input.channel,closeReason:input.closeReasonLabel,closeNotes:input.closeNotes}),maxTokens:800,timeoutMs:20000});
}
