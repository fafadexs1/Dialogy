import { createWorkflowNode } from '@/services/workflow-runtime/catalog';
import type { WorkflowDefinition } from '@/services/workflow-runtime/types';

/** Nexus routes into the Studio; the published Studio agent owns the conversation. */
export function auroraConversationalWorkflow(previous: WorkflowDefinition, agentId: string, releaseId: string): WorkflowDefinition {
  const start = createWorkflowNode('trigger.received_message', { id: 'aurora_conversation_start', name: 'Iniciar conversa de vendas fictícias', position: { x: 80, y: 160 }, config: { matchMode: 'any_keyword', keywords: ['demo aurora'], defaultOutput: 'message', sessionTimeoutMs: 86400000 } });
  const nina = createWorkflowNode('ai.published_agent', { id: 'aurora_nina_studio', name: 'Nina · vendedora conversacional do Studio', position: { x: 540, y: 160 }, config: { agentId, releaseId, inputMappings: [], outputKeys: [] } });
  nina.outputPorts = [];
  return { ...previous, name: 'Aurora Work · Vendedora IA (Nina)', status: 'draft', version: 'draft', updatedAt: new Date().toISOString(),
    nodes: [start, nina], connections: [{ id: 'aurora_start_nina', sourceNodeId: start.id, sourcePortId: 'message', targetNodeId: nina.id, targetPortId: 'main', connectionType: 'main' }],
    settings: { ...previous.settings, executionTimeoutMs: 86400000, maxSteps: 100, maxModelCalls: 200, maxToolCalls: 40, maxTotalInputTokens: 500000, maxTotalOutputTokens: 64000 },
    metadata: { ...previous.metadata, template: 'sales_conversation', demoVersion: 2, pendingConfiguration: [], fictionalCommerce: true, realProviderHomologated: false, flowBuilderUi: { version: 1, groups: [{ id: 'aurora-conversation', title: 'Conversa livre · identidade e habilidades no IA Studio', nodeIds: [start.id, nina.id] }] } },
  };
}
