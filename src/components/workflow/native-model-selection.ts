import { getAiModelRuntimeProvider, type AiModelCatalogEntry } from '@/lib/ai-models';
import type { WorkflowNode } from '@/services/workflow-runtime/types';

export type WorkflowModelOption = AiModelCatalogEntry & { legacy?: boolean };

export function getWorkflowModelOptions(
  configuredModels: AiModelCatalogEntry[],
  currentModel: string,
): WorkflowModelOption[] {
  if (!currentModel || configuredModels.some((model) => model.id === currentModel)) {
    return configuredModels;
  }

  return [{
    id: currentModel,
    label: currentModel,
    provider: 'other',
    enabled: false,
    legacy: true,
  }, ...configuredModels];
}

export function applyWorkflowModelSelection(node: WorkflowNode, modelId: string): WorkflowNode {
  return {
    ...node,
    config: {
      ...node.config,
      model: modelId,
      provider: getAiModelRuntimeProvider(modelId),
    },
  };
}
