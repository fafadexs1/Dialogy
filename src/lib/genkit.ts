import { requestPlatformJson } from '@/services/ai/platform-json';
import { z } from 'zod';
export async function generateSummary(conversationText:string, apiKey?:string, modelName?:string, workspaceId?:string):Promise<string> {
  const result = await requestPlatformJson({workspaceId,model:'',apiKey:'',schema:z.object({summary:z.string()}),
    schemaName:'dialogy_summary',jsonSchema:{type:'object',properties:{summary:{type:'string'}},required:['summary'],additionalProperties:false},
    systemPrompt:'Resuma este atendimento para notas internas, em no maximo 500 caracteres. Destaque o problema e a resolucao ou estado atual. Nao invente informacoes.',
    userPrompt:conversationText,maxTokens:500,timeoutMs:20000});
  return result.summary;
}
