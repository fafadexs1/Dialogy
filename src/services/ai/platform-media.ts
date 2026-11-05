import 'server-only';
import { platformModel,platformApiKey } from './platform-config';
import { meteredAiCall } from './metered-call';
import { getAiModelRuntimeProvider } from '@/lib/ai-models';
import { getGlobalLmStudioConfig,getLmStudioModelId } from './lm-studio';

export async function requestPlatformMedia(input:{workspaceId:string;prompt:string;data:Buffer;mimeType:string;requireDeclaredCapability?:boolean}) {
  const selected=await platformModel();
  if(input.requireDeclaredCapability && !selected.supportedMediaTypes?.includes(input.mimeType==='application/pdf'?'pdf':'image')) throw new Error('Este formato ainda não foi habilitado para o modelo principal na IA Global.');
  if(input.requireDeclaredCapability && input.mimeType==='application/pdf' && getAiModelRuntimeProvider(selected.id)!=='googleai') throw new Error('O adaptador do modelo principal não aceita PDFs multimodais. Use a leitura de texto do PDF.');
  const apiKey=await platformApiKey(selected.id);
  const provider=getAiModelRuntimeProvider(selected.id);
  return meteredAiCall({workspaceId:input.workspaceId,model:selected.id,source:'media_analysis',inputTokenBudget:65536,outputTokenBudget:2048,
    execute:async recordUsage=>{
      if(provider==='googleai') {
        const {GoogleGenerativeAI}=await import('@google/generative-ai');
        const model=new GoogleGenerativeAI(apiKey).getGenerativeModel({model:selected.id.slice('googleai/'.length),generationConfig:{maxOutputTokens:2048}});
        const result=await model.generateContent([{inlineData:{mimeType:input.mimeType,data:input.data.toString('base64')}},{text:input.prompt}],{timeout:60000});
        const usage=result.response.usageMetadata;
        if(usage)await recordUsage({inputTokens:usage.promptTokenCount,outputTokens:Math.max(usage.candidatesTokenCount,usage.totalTokenCount-usage.promptTokenCount)});
        return result.response.text();
      }
      if(!input.mimeType.startsWith('image/'))throw Object.assign(new Error('O modelo da plataforma nao suporta este tipo de midia.'),{status:400});
      const {default:OpenAI}=await import('openai');
      const local=provider==='lmstudio'?await getGlobalLmStudioConfig():null;
      const client=new OpenAI({apiKey,baseURL:local?.baseUrl||(provider==='deepseek'?'https://api.deepseek.com':undefined),timeout:60000,maxRetries:0});
      const result=await client.chat.completions.create({model:local?getLmStudioModelId(selected.id):selected.id.replace(/^[^/]+\//,''),
        messages:[{role:'user',content:[{type:'text',text:input.prompt},{type:'image_url',image_url:{url:`data:${input.mimeType};base64,${input.data.toString('base64')}`}}]}],
        ...(provider==='openai'?{max_completion_tokens:2048}:{max_tokens:2048}),
      });
      if(result.usage)await recordUsage({inputTokens:result.usage.prompt_tokens,outputTokens:result.usage.completion_tokens});
      const text=result.choices[0]?.message.content;
      if(!text)throw new Error('O provedor retornou uma analise vazia.');
      return text;
    }});
}
