import { describe, expect, it } from 'vitest';
import {
  applyWorkflowModelSelection,
  getWorkflowModelOptions,
} from '@/components/workflow/native-model-selection';
import type { AiModelCatalogEntry } from '@/lib/ai-models';
import {
  createNativeWorkflowTemplate,
  createWorkflowNode,
  type ModelConfiguration,
} from '@/services/workflow-runtime';
import { getPrimaryWorkflowModelId } from '@/services/workflow-runtime/model-selection';

const configuredModels: AiModelCatalogEntry[] = [{
  id: 'openai/gpt-workspace',
  label: 'GPT Workspace',
  provider: 'openai',
  enabled: true,
}];

describe('native workflow model selection', () => {
  it('offers only workspace-configured models to a new block', () => {
    expect(getWorkflowModelOptions(configuredModels, '')).toEqual(configuredModels);
  });

  it('keeps an existing legacy model visible without marking it configured', () => {
    const options = getWorkflowModelOptions(configuredModels, 'googleai/legacy-model');

    expect(options.map((model) => model.id)).toEqual([
      'googleai/legacy-model',
      'openai/gpt-workspace',
    ]);
    expect(options[0]).toMatchObject({ enabled: false, legacy: true });
  });

  it('updates model and provider atomically while preserving the model settings', () => {
    const node = createWorkflowNode('ai.model', {
      id: 'model-1',
      position: { x: 0, y: 0 },
      config: {
        temperature: 0.4,
        maxOutputTokens: 4096,
        model: 'googleai/legacy-model',
        provider: 'googleai',
      },
    });

    const updated = applyWorkflowModelSelection(node, 'openai/gpt-workspace');

    expect(updated.config).toMatchObject({
      model: 'openai/gpt-workspace',
      provider: 'openai',
      temperature: 0.4,
      maxOutputTokens: 4096,
    });
  });

  it('resolves the model attached to the primary agent for card and publication synchronization', () => {
    const model: ModelConfiguration = {
      provider: 'deepseek',
      model: 'deepseek/deepseek-v4-flash',
      temperature: 0.2,
      maxOutputTokens: 2048,
      supportsTools: true,
      supportsStructuredOutput: true,
      supportsStreaming: true,
      timeoutMs: 60_000,
      maxRetries: 2,
    };
    const workflow = createNativeWorkflowTemplate({
      configId: 'config-model-sync',
      workspaceId: 'workspace-model-sync',
      name: 'Agente DeepSeek',
      model,
      persona: '',
      template: 'single_agent',
    });
    workflow.nodes.unshift(createWorkflowNode('ai.model', {
      id: 'unconnected-gemma',
      position: { x: -500, y: -500 },
      config: { ...model, provider: 'lmstudio', model: 'lmstudio/google/gemma-4' },
    }));

    expect(getPrimaryWorkflowModelId(workflow)).toBe('deepseek/deepseek-v4-flash');
  });
});
