import { describe, expect, it } from 'vitest';

import {
  analyzeWorkflowBlockTest,
  createWorkflowBlockTestSideEffectAdapters,
  prepareWorkflowBlockTest,
} from '@/services/workflow-runtime/block-test';
import { createNativeWorkflowTemplate } from '@/services/workflow-runtime/native-templates';
import type { ModelConfiguration } from '@/services/workflow-runtime/types';
import { validateWorkflowDefinition } from '@/services/workflow-runtime/validator';

const model: ModelConfiguration = {
  provider: 'fake',
  model: 'structured-model',
  temperature: 0.2,
  maxOutputTokens: 2048,
  supportsTools: true,
  supportsStructuredOutput: true,
  supportsStreaming: false,
  timeoutMs: 60_000,
  maxRetries: 2,
};

function workflow() {
  return createNativeWorkflowTemplate({
    template: 'single_agent',
    configId: 'config-1',
    workspaceId: 'workspace-1',
    name: 'Teste por bloco',
    model,
    persona: 'Objetivo e seguro.',
    language: 'pt-BR',
  });
}

describe('workflow block test preparation', () => {
  it('requires a simulation fixture for every immediate execution dependency', () => {
    const definition = workflow();
    const analysis = analyzeWorkflowBlockTest(definition, 'primary_agent');

    expect(analysis.canRun).toBe(false);
    expect(analysis.boundaryNodeIds).toEqual(['message_received']);
    expect(analysis.upstreamNodeIds).toEqual(['message_received']);
    expect(analysis.blockers).toContainEqual(expect.objectContaining({
      code: 'missing_upstream_fixture',
      nodeId: 'message_received',
    }));
  });

  it('builds an isolated valid workflow without upstream side effects', () => {
    const definition = workflow();
    const prepared = prepareWorkflowBlockTest({
      definition,
      nodeId: 'primary_agent',
      fixtures: {
        message_received: {
          output: { message: 'Preciso de ajuda' },
          statePatch: { customer: { tier: 'gold' } },
        },
      },
      executionId: 'sandbox-test-1',
    });

    expect(prepared.analysis.canRun).toBe(true);
    expect(prepared.workflow.nodes.some((node) => node.id === 'message_received')).toBe(false);
    expect(prepared.workflow.nodes.some((node) => node.id === '__block_test_trigger_primary_agent')).toBe(true);
    expect(prepared.workflow.metadata).toMatchObject({
      sandbox: true,
      blockTest: {
        sourceNodeId: 'primary_agent',
        toolCalls: 'deny',
        messageDelivery: 'simulate',
        handoff: 'simulate',
      },
    });
    expect(prepared.startInput.input).toEqual({ message: 'Preciso de ajuda' });
    expect(prepared.startInput.variables).toEqual({ customer: { tier: 'gold' } });
    expect(prepared.startInput.context).toMatchObject({ sandbox: true, blockTestSourceNodeId: 'primary_agent' });
    expect(validateWorkflowDefinition(prepared.workflow).valid).toBe(true);
  });

  it('rejects attachment nodes because they are not execution entry points', () => {
    const analysis = analyzeWorkflowBlockTest(workflow(), 'shared_model');
    expect(analysis.canRun).toBe(false);
    expect(analysis.blockers).toContainEqual(expect.objectContaining({ code: 'attachment_not_executable' }));
  });

  it('does not require fixtures when testing from the original trigger', () => {
    const definition = workflow();
    const prepared = prepareWorkflowBlockTest({
      definition,
      nodeId: 'message_received',
      input: { message: 'Teste completo' },
    });
    expect(prepared.analysis.canRun).toBe(true);
    expect(prepared.startInput.input).toEqual({ message: 'Teste completo' });
    expect(prepared.workflow.nodes.some((node) => node.id.startsWith('__block_test_trigger'))).toBe(false);
  });

  it('provides adapters that deny tools and simulate delivery without retaining message content', async () => {
    const sandbox = createWorkflowBlockTestSideEffectAdapters();
    const registry = await sandbox.dependencies.resolveToolRegistry({} as never);
    expect(registry.list()).toEqual([]);

    const response = await sandbox.dependencies.sendResponse('conteúdo privado', {
      node: { id: 'respond' },
    } as never);
    expect(response).toEqual({ sandbox: true, delivered: false, characterCount: 16 });
    expect(sandbox.records).toEqual([{
      kind: 'message_delivery',
      nodeId: 'respond',
      simulated: true,
      characterCount: 16,
    }]);
    expect(JSON.stringify(sandbox.records)).not.toContain('conteúdo privado');
  });
});
