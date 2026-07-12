import { describe, expect, it } from 'vitest';

import { createWorkflowNode, getWorkflowNodeManifest } from '@/services/workflow-runtime/catalog';
import {
  createPrivateAgentResourceBundle,
  deleteWorkflowNodesAndPrivateAttachments,
  detachWorkflowConnectionsAndPrune,
} from '@/services/workflow-runtime/native-agent-attachments';
import { buildNativeAgentToolConfig } from '@/services/workflow-runtime/native-agent-tools';
import { createNativeWorkflowTemplate } from '@/services/workflow-runtime/native-templates';
import type { ModelConfiguration, WorkflowConnection, WorkflowNode } from '@/services/workflow-runtime/types';
import { validateWorkflowDefinition } from '@/services/workflow-runtime/validator';

function model(modelId: string): ModelConfiguration {
  return {
    provider: 'fake',
    model: modelId,
    temperature: 0.2,
    maxOutputTokens: 2_048,
    supportsTools: true,
    supportsStructuredOutput: true,
    supportsStreaming: false,
    timeoutMs: 60_000,
    maxRetries: 2,
  };
}

function agent(id: string, x: number): WorkflowNode {
  return createWorkflowNode('ai.agent', {
    id,
    name: id,
    position: { x, y: 200 },
    config: {
      name: id,
      role: 'especialista',
      objective: 'Atender com segurança.',
      completionCriteria: ['Responder ou encaminhar.'],
    },
  });
}

function sequentialIds(prefix: string) {
  let index = 0;
  return () => `${prefix}-${++index}`;
}

describe('native agent private attachment lifecycle', () => {
  it('creates independent resources for agents that use different models', () => {
    const agentA = agent('agent-a', 400);
    const agentB = agent('agent-b', 900);
    const bundleA = createPrivateAgentResourceBundle({
      agent: agentA,
      position: agentA.position,
      model: model('deepseek-r1'),
      createId: sequentialIds('a'),
    });
    const bundleB = createPrivateAgentResourceBundle({
      agent: agentB,
      position: agentB.position,
      model: model('gemma-4'),
      createId: sequentialIds('b'),
    });
    const modelA = bundleA.nodes.find((node) => node.type === 'ai.model')!;
    const modelB = bundleB.nodes.find((node) => node.type === 'ai.model')!;

    expect(modelA.id).not.toBe(modelB.id);
    expect(modelA.config.model).toBe('deepseek-r1');
    expect(modelB.config.model).toBe('gemma-4');
    expect(bundleA.connections.every((connection) => connection.targetNodeId === agentA.id)).toBe(true);
    expect(bundleB.connections.every((connection) => connection.targetNodeId === agentB.id)).toBe(true);
  });

  it('removes a private attachment after detach but preserves an explicitly shared attachment', () => {
    const agentA = agent('agent-a', 400);
    const agentB = agent('agent-b', 900);
    const sharedTool = createWorkflowNode('tool.internal', {
      id: 'shared-note',
      name: 'Adicionar nota interna',
      position: { x: 100, y: 400 },
      config: buildNativeAgentToolConfig({
        name: 'add_internal_note',
        displayName: 'Adicionar nota interna',
        description: 'Registra contexto operacional.',
        source: 'dialogy',
        riskLevel: 'low',
      }),
    });
    const connections: WorkflowConnection[] = [agentA, agentB].map((target) => ({
      id: `shared-${target.id}`,
      sourceNodeId: sharedTool.id,
      sourcePortId: 'tool',
      targetNodeId: target.id,
      targetPortId: 'tools',
      connectionType: 'tool',
    }));

    const afterFirstDetach = detachWorkflowConnectionsAndPrune({
      nodes: [agentA, agentB, sharedTool],
      connections,
      shouldDetach: (connection) => connection.targetNodeId === agentA.id,
    });
    expect(afterFirstDetach.nodes.some((node) => node.id === sharedTool.id)).toBe(true);
    expect(afterFirstDetach.connections).toHaveLength(1);

    const afterSecondDetach = detachWorkflowConnectionsAndPrune({
      ...afterFirstDetach,
      shouldDetach: (connection) => connection.targetNodeId === agentB.id,
    });
    expect(afterSecondDetach.nodes.some((node) => node.id === sharedTool.id)).toBe(false);
    expect(afterSecondDetach.connections).toHaveLength(0);
  });

  it('deleting one agent collects only its private resources', () => {
    const agentA = agent('agent-a', 400);
    const agentB = agent('agent-b', 900);
    const bundleA = createPrivateAgentResourceBundle({ agent: agentA, position: agentA.position, model: model('deepseek-r1'), createId: sequentialIds('a') });
    const bundleB = createPrivateAgentResourceBundle({ agent: agentB, position: agentB.position, model: model('gemma-4'), createId: sequentialIds('b') });
    const graph = deleteWorkflowNodesAndPrivateAttachments({
      nodes: [agentA, agentB, ...bundleA.nodes, ...bundleB.nodes],
      connections: [...bundleA.connections, ...bundleB.connections],
      nodeIds: [agentA.id],
    });

    expect(graph.nodes.some((node) => node.id === agentA.id)).toBe(false);
    expect(bundleA.nodes.every((node) => !graph.nodes.some((remaining) => remaining.id === node.id))).toBe(true);
    expect(graph.nodes.some((node) => node.id === agentB.id)).toBe(true);
    expect(bundleB.nodes.every((node) => graph.nodes.some((remaining) => remaining.id === node.id))).toBe(true);
  });

  it('toggle off leaves no disconnected attachment and no disconnected_node validation error', () => {
    const workflow = createNativeWorkflowTemplate({
      configId: 'toggle-config',
      workspaceId: 'toggle-workspace',
      name: 'Toggle seguro',
      model: model('deepseek-r1'),
      persona: 'Objetivo.',
      template: 'single_agent',
    });
    const targetAgent = workflow.nodes.find((node) => node.type === 'ai.agent')!;
    const tool = createWorkflowNode('tool.internal', {
      id: 'temporary-tool',
      name: 'Adicionar nota interna',
      position: { x: 100, y: 500 },
      config: buildNativeAgentToolConfig({
        name: 'add_internal_note',
        description: 'Registra contexto operacional.',
        source: 'dialogy',
        riskLevel: 'low',
      }),
    });
    workflow.nodes.push(tool);
    workflow.connections.push({
      id: 'temporary-tool-attachment',
      sourceNodeId: tool.id,
      sourcePortId: 'tool',
      targetNodeId: targetAgent.id,
      targetPortId: 'tools',
      connectionType: 'tool',
    });

    const toggledOff = detachWorkflowConnectionsAndPrune({
      nodes: workflow.nodes,
      connections: workflow.connections,
      shouldDetach: (connection) => connection.id === 'temporary-tool-attachment',
    });
    const orphanAttachments = toggledOff.nodes.filter((node) => (
      getWorkflowNodeManifest(node.type)?.attachment
      && !toggledOff.connections.some((connection) => connection.sourceNodeId === node.id)
    ));
    const validation = validateWorkflowDefinition({ ...workflow, ...toggledOff });

    expect(orphanAttachments).toEqual([]);
    expect(validation.errors.some((issue) => issue.code === 'disconnected_node')).toBe(false);
  });
});
