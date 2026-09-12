import 'server-only';
import type { z } from 'zod';
import { platformModel,platformApiKey } from './platform-config';
import { meteredAiCall } from './metered-call';
import { requestOpenAiCompatibleJson } from './openai-compatible';
import { getGlobalAiDecisionModelConfig } from './decision-model-config';
import type { AiDecisionModelRole } from '@/lib/ai-decision-models';

type JsonRequest<T extends z.ZodTypeAny> = Parameters<typeof requestOpenAiCompatibleJson<T>>[0];

export async function requestPlatformJson<T extends z.ZodTypeAny>(input:Parameters<typeof requestOpenAiCompatibleJson<T>>[0]):Promise<z.output<T>> {
  const selected=await platformModel();
  return executeJson(input, selected.id);
}

export async function requestDecisionJson<T extends z.ZodTypeAny>(
  role: AiDecisionModelRole,
  input: Omit<JsonRequest<T>, 'model' | 'apiKey' | 'timeoutMs'>,
): Promise<z.output<T>> {
  const settings = (await getGlobalAiDecisionModelConfig())[role];
  if (!settings) throw new Error('Etapa de decisao invalida.');
  return executeJson({...input, model: settings.model, apiKey: '', timeoutMs: settings.timeoutMs}, settings.model, true);
}

async function executeJson<T extends z.ZodTypeAny>(input: JsonRequest<T>, model: string, independent = false): Promise<z.output<T>> {
  const apiKey=await platformApiKey(model);
  return meteredAiCall({workspaceId:input.workspaceId,model,source:input.schemaName,independent,
    inputTokenBudget:Buffer.byteLength(input.systemPrompt+input.userPrompt+JSON.stringify(input.jsonSchema),'utf8')+4096,
    outputTokenBudget:input.maxTokens??4096,
    execute:recordUsage=>requestOpenAiCompatibleJson({...input,model,apiKey,
      onUsage:async usage=>{await recordUsage(usage);await input.onUsage?.(usage);},
    }),
  });
}
