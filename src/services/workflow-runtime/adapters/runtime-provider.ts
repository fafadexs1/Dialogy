import { requestPlatformJson } from '@/services/ai/platform-json';
import { z } from 'zod';
import { platformModel } from '@/services/ai/platform-config';
import { genkit } from 'genkit';
import { toJsonSchema } from 'genkit/schema';
import { googleAI } from '@genkit-ai/google-genai';

import { getAiModelRuntimeProvider } from '@/lib/ai-models';
import { withTimeout } from '../utils';
import type {
  GenerateRequest,
  GenerateResult,
  ModelAdapter,
  ModelHealth,
  ModelInfo,
  ModelStreamEvent,
  StructuredGenerateRequest,
} from '../model-adapter';

export type RuntimeProviderModelAdapterOptions = {
  workspaceId?: string;
  model: string;
  apiKey: string;
  timeoutMs?: number;
};

function promptText(request: GenerateRequest) {
  return request.messages.map((message) => `${message.role.toUpperCase()}\n${message.content}`).join('\n\n');
}

function unsupported(message: string) {
  const error = new Error(message) as Error & { code?: string; retryable?: boolean };
  error.code = 'MODEL_CAPABILITY_MISMATCH';
  error.retryable = false;
  return error;
}

export class RuntimeProviderModelAdapter implements ModelAdapter {
  private readonly provider;
  private readonly timeoutMs;

  constructor(private readonly options: RuntimeProviderModelAdapterOptions) {
    this.provider = getAiModelRuntimeProvider(options.model);
    this.timeoutMs = options.timeoutMs || 60_000;
  }

  async listModels(): Promise<ModelInfo[]> {
    return [{ id: this.options.model }];
  }

  async healthCheck(): Promise<ModelHealth> {
    return { ok: Boolean(this.options.apiKey), latencyMs: 0, models: [this.options.model] };
  }

  async generate(request:GenerateRequest):Promise<GenerateResult> {
    const selected=await platformModel();
    const result=await this.generateStructured({...request,schema:z.object({text:z.string()}),schemaName:'dialogy_workflow_text'});
    return {model:selected.id,text:result.text,toolRequests:[]};
  }
  async generateStructured<T>(request:StructuredGenerateRequest<T>):Promise<T> {
    return requestPlatformJson({workspaceId:this.options.workspaceId,model:'',apiKey:'',schema:request.schema,
      schemaName:request.schemaName,jsonSchema:request.jsonSchema||toJsonSchema({schema:request.schema})||{},
      systemPrompt:request.messages.filter(m=>m.role==='system').map(m=>m.content).join('\n'),
      userPrompt:request.messages.filter(m=>m.role!=='system').map(m=>m.content).join('\n'),
      timeoutMs:Math.min(request.timeoutMs||this.timeoutMs,this.timeoutMs),maxTokens:request.maxOutputTokens,signal:request.signal});
  }

  async *stream(request: GenerateRequest): AsyncIterable<ModelStreamEvent> {
    yield { type: 'started', model: this.options.model };
    try {
      const result = await this.generate(request);
      if (result.text) yield { type: 'text_delta', model: this.options.model, text: result.text };
      yield { type: 'completed', model: this.options.model, usage: result.usage };
    } catch (error) {
      yield { type: 'error', model: this.options.model, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async supportsTools(): Promise<boolean> {
    return true;
  }

  async supportsStructuredOutput(): Promise<boolean> {
    return ['googleai', 'openai', 'deepseek'].includes(this.provider);
  }
}
