import { describe, expect, it } from 'vitest';
import type { AutopilotConfigDraftSnapshot } from '@/lib/types';
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
import {
  getPrimaryWorkflowAgentId,
  getPrimaryWorkflowModelId,
  resolveWorkflowAwareModelId,
  synchronizeWorkflowModelState,
} from '@/services/workflow-runtime/model-selection';

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

  it('keeps multi-agent card synchronization tied to the reachable or explicitly primary agent', () => {
    const baseModel: ModelConfiguration = {
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
      configId: 'multi-agent',
      workspaceId: 'workspace',
      name: 'Agente principal',
      model: baseModel,
      persona: '',
      template: 'single_agent',
    });
    const reachableAgent = workflow.nodes.find((node) => node.type === 'ai.agent')!;
    const auxiliaryAgent = createWorkflowNode('ai.agent', {
      id: 'agent-auxiliary',
      position: { x: -1000, y: -1000 },
    });
    const auxiliaryModel = createWorkflowNode('ai.model', {
      id: 'model-auxiliary',
      position: { x: -1200, y: -1000 },
      config: { ...baseModel, provider: 'lmstudio', model: 'lmstudio/google/gemma-4' },
    });
    workflow.nodes.unshift(auxiliaryAgent, auxiliaryModel);
    workflow.connections.unshift({
      id: 'model-auxiliary-connection',
      sourceNodeId: auxiliaryModel.id,
      sourcePortId: auxiliaryModel.outputPorts.find((port) => port.connectionType === 'model')!.id,
      targetNodeId: auxiliaryAgent.id,
      targetPortId: auxiliaryAgent.inputPorts.find((port) => port.connectionType === 'model')!.id,
      connectionType: 'model',
    });

    expect(getPrimaryWorkflowAgentId(workflow)).toBe(reachableAgent.id);
    expect(getPrimaryWorkflowModelId(workflow)).toBe('deepseek/deepseek-v4-flash');

    workflow.metadata = { ...workflow.metadata, primaryAgentId: auxiliaryAgent.id };
    expect(getPrimaryWorkflowAgentId(workflow)).toBe(auxiliaryAgent.id);
    expect(getPrimaryWorkflowModelId(workflow)).toBe('lmstudio/google/gemma-4');
  });

  it('keeps DeepSeek through save, reload, publish and card display even when the old column says Gemma', () => {
    const gemmaModel: ModelConfiguration = {
      provider: 'lmstudio',
      model: 'lmstudio/google/gemma-4-e4b',
      temperature: 0.2,
      maxOutputTokens: 2048,
      supportsTools: true,
      supportsStructuredOutput: true,
      supportsStreaming: true,
      timeoutMs: 60_000,
      maxRetries: 2,
    };
    const initialWorkflow = createNativeWorkflowTemplate({
      configId: 'config-model-lifecycle',
      workspaceId: 'workspace-model-lifecycle',
      name: 'Isabelle',
      model: gemmaModel,
      persona: '',
      template: 'single_agent',
    });
    const connectedModelId = initialWorkflow.connections.find((connection) => (
      connection.connectionType === 'model'
      && initialWorkflow.nodes.some((node) => node.id === connection.targetNodeId && node.type === 'ai.agent')
    ))?.sourceNodeId;
    expect(connectedModelId).toBeTruthy();

    const selectedWorkflow = {
      ...initialWorkflow,
      nodes: initialWorkflow.nodes.map((node) => node.id === connectedModelId
        ? applyWorkflowModelSelection(node, 'deepseek/deepseek-v4-flash')
        : node),
    };
    const editorSnapshot: AutopilotConfigDraftSnapshot = {
      name: 'Isabelle',
      gemini_api_key: null,
      ai_model: 'lmstudio/google/gemma-4-e4b',
      knowledge_base: null,
      knowledge_base_documents: [],
      knowledge_collections: [],
      is_active: true,
      is_private: false,
      default_fallback_reply: null,
      escalation_policy: null,
      closing_policy: null,
      enabled_tool_names: [],
      workflow_runtime_v2_mode: 'shadow',
      workflow_builder_mode: 'native_v2',
      workflow_definition: selectedWorkflow,
    };

    // Save boundary: the native workflow is authoritative over the stale form field.
    const savedDraft = synchronizeWorkflowModelState(editorSnapshot);
    expect(savedDraft.ai_model).toBe('deepseek/deepseek-v4-flash');

    // Reload boundary: reproduce the JSONB round-trip used by the draft table.
    const reloadedDraft = synchronizeWorkflowModelState(
      JSON.parse(JSON.stringify(savedDraft)) as AutopilotConfigDraftSnapshot,
    );
    expect(reloadedDraft.ai_model).toBe('deepseek/deepseek-v4-flash');

    // Publish boundary: version/status metadata changes must not reintroduce Gemma.
    const publishedSnapshot = synchronizeWorkflowModelState({
      ...reloadedDraft,
      workflow_definition: {
        ...selectedWorkflow,
        version: 'v7',
        status: 'published' as const,
      },
    });
    expect(publishedSnapshot.ai_model).toBe('deepseek/deepseek-v4-flash');

    // List/card hydration repairs even historical rows whose denormalized column is stale.
    const displayedModel = resolveWorkflowAwareModelId({
      ai_model: 'lmstudio/google/gemma-4-e4b',
      workflow_builder_mode: 'native_v2',
      workflow_definition: publishedSnapshot.workflow_definition,
    });
    expect(displayedModel).toBe('deepseek/deepseek-v4-flash');
  });

  it('does not override the stored model when no native workflow is authoritative', () => {
    expect(resolveWorkflowAwareModelId({
      ai_model: 'lmstudio/google/gemma-4-e4b',
      workflow_builder_mode: 'legacy',
      workflow_definition: null,
    })).toBe('lmstudio/google/gemma-4-e4b');
  });
});
