import 'server-only';
import { getAiModelRuntimeProvider } from '@/lib/ai-models';
import { runAiModelWithFallback, type RunAiModelWithFallbackInput } from './model-client';
import { platformModel,platformApiKey } from './platform-config';
import { meteredAiCall } from './metered-call';

export async function runPlatformModel<T>(input:RunAiModelWithFallbackInput<T> & {
  workspaceId?:string|null;inputTokenBudget?:number;outputTokenBudget?:number;
}) {
  const model=await platformModel();
  const key=await platformApiKey(model.id);
  return runAiModelWithFallback({...input,modelCandidates:[model.id],
    apiKeyCandidates:[{source:'platform',provider:getAiModelRuntimeProvider(model.id),key}],
    execute:context=>meteredAiCall({workspaceId:input.workspaceId,model:model.id,source:input.label,
      inputTokenBudget:input.inputTokenBudget,outputTokenBudget:input.outputTokenBudget,
      execute:async recordUsage=>{
        const result=await input.execute(context);
        const usage=(result as {usage?:{inputTokens?:number;outputTokens?:number}})?.usage;
        if(usage?.inputTokens!=null && usage.outputTokens!=null)await recordUsage({inputTokens:usage.inputTokens,outputTokens:usage.outputTokens});
        return result;
      }}),
  });
}
