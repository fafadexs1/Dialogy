import { describe, expect, it } from 'vitest';

import { importLegacyNexusFlow } from '@/modules/nexus/services/legacy-import';
import { createNexusToolRegistry } from '@/modules/nexus/services/tool-registry';
import {
  WorkflowExecutionSchema,
  createWorkflowNode,
  type ModelConfiguration,
} from '@/services/workflow-runtime';
import { workflowDefinition } from './workflow-runtime-fixtures';

const dialogyModel: ModelConfiguration = {
  provider: 'google',
  model: 'gemini-2.5-flash',
  temperature: 0.2,
  maxOutputTokens: 2048,
  supportsTools: true,
  supportsStructuredOutput: true,
  supportsStreaming: true,
  timeoutMs: 60_000,
  maxRetries: 2,
};

describe('Nexus HTTP agent tool', () => {
  it('registers an HTTPS tool with typed arguments and delegates through the protected executor', async () => {
    const node = createWorkflowNode('tool.http', {
      id: 'http-tool',
      position: { x: 0, y: 0 },
      config: {
        name: 'consultar_pedido',
        description: 'Consulta um pedido pelo identificador.',
        method: 'GET',
        url: 'https://api.example.com/orders/{{current.id}}',
        query: { locale: '{{current.locale}}' },
        headers: {},
        bodyType: 'none',
        credentialId: 'credential-1',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' }, locale: { type: 'string' } },
          required: ['id'],
          additionalProperties: false,
        },
        requiresConfirmation: false,
      },
    });
    const calls: Array<Record<string, unknown>> = [];
    const registry = createNexusToolRegistry({
      workspaceId: 'workspace-1',
      toolNodes: [node],
      executeHttpOperation: async (input) => {
        calls.push(input as unknown as Record<string, unknown>);
        return { status: 200, data: { ok: true }, selected: { ok: true } };
      },
    });
    const definition = registry.get('consultar_pedido')!;
    const workflow = workflowDefinition([node], [], { workspaceId: 'workspace-1' });
    const execution = WorkflowExecutionSchema.parse({
      executionId: 'execution-1', workflowId: workflow.id, workflowVersion: workflow.version,
      status: 'running', currentNodeId: node.id, previousNodeId: null, pendingNodeIds: [],
      input: {}, variables: {}, context: {}, nodeResults: {}, executionPath: [],
      startedAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z',
      totalSteps: 0, totalModelCalls: 0, totalToolCalls: 0, totalInputTokens: 0, totalOutputTokens: 0, version: 0,
    });
    const output = await definition.execute({ id: '42', locale: 'pt-BR' }, {
      execution,
      workflow,
      node,
      signal: new AbortController().signal,
      idempotencyKey: 'key-1',
    });
    expect(definition).toMatchObject({ riskLevel: 'low', permissionScope: 'integrations:http', idempotent: true });
    expect(definition.inputJsonSchema).toMatchObject({ required: ['id'] });
    expect(output).toMatchObject({ status: 200, selected: { ok: true } });
    expect(calls[0]).toMatchObject({
      workspaceId: 'workspace-1',
      runtimeSource: { current: { id: '42', locale: 'pt-BR' } },
    });
  });

  it('imports legacy form-data arguments without retaining authentication secrets', () => {
    const result = importLegacyNexusFlow({
      raw: {
        nodes: [
          { id: 'start', type: 'start' },
          { id: 'agent', type: 'intelligent-agent', agentName: 'Consultor', agentSystemPrompt: 'Envie o cadastro.' },
          {
            id: 'http-tool',
            type: 'http-tool',
            httpToolName: 'enviar_cadastro',
            httpToolDescription: 'Envia o cadastro concluído.',
            httpToolMethod: 'POST',
            httpToolUrl: 'https://api.example.com/send',
            httpToolAuthType: 'bearer',
            httpToolAuthToken: 'legacy-secret-token',
            httpToolHeaders: [
              { key: 'Content-Type', value: 'multipart/form-data' },
              { key: 'Authorization', value: 'Bearer another-secret' },
            ],
            httpToolBodyType: 'form-data',
            httpToolFormData: [{ key: 'message', value: '{{INFORMACOES_CLIENTE}}' }],
          },
          { id: 'end', type: 'end-flow' },
        ],
        connections: [
          { from: 'start', to: 'agent' },
          { from: 'http-tool', to: 'agent', targetHandle: 'tools' },
          { from: 'agent', to: 'end', sourceHandle: 'completed' },
        ],
      },
      workspaceId: 'workspace-1',
      configId: 'config-1',
      name: 'Ferramenta HTTP importada',
      model: dialogyModel,
    });
    const tool = result.workflow.nodes.find((node) => node.type === 'tool.http');
    expect(tool?.config).toMatchObject({
      name: 'enviar_cadastro',
      method: 'POST',
      credentialId: '',
      bodyType: 'form-data',
      body: { message: '{{current.INFORMACOES_CLIENTE}}' },
      requiresConfirmation: true,
      inputSchema: {
        required: ['INFORMACOES_CLIENTE'],
        properties: { INFORMACOES_CLIENTE: { type: 'string' } },
      },
    });
    expect(JSON.stringify(result.workflow)).not.toContain('legacy-secret-token');
    expect(JSON.stringify(result.workflow)).not.toContain('another-secret');
    expect(result.workflow.connections).toContainEqual(expect.objectContaining({
      sourceNodeId: tool?.id,
      sourcePortId: 'tool',
      targetPortId: 'tools',
      connectionType: 'tool',
    }));
  });
});
