import { describe, expect, it } from 'vitest';

import { importLegacyNexusFlow } from '@/modules/nexus/services/legacy-import';
import { createNexusToolRegistry } from '@/modules/nexus/services/tool-registry';
import { createWorkflowNode, type ModelConfiguration } from '@/services/workflow-runtime';

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

describe('Nexus database agent tool', () => {
  it.each(['insert', 'update', 'delete'])('requires approval for %s even if configuration disables confirmation', (operation) => {
    const node = createWorkflowNode('tool.database', { id: 'db-write', position: { x: 0, y: 0 }, config: { name: 'db_write', description: 'Altera dados', credentialId: 'cred', operation, table: 'orders', requiresConfirmation: false } });
    expect(createNexusToolRegistry({ workspaceId: 'workspace-1', toolNodes: [node] }).get('db_write')?.requiresConfirmation).toBe(true);
  });
  it('rejects a write through the generic registry instead of bypassing human approval', async () => {
    const node = createWorkflowNode('tool.database', { id: 'db-write', position: { x: 0, y: 0 }, config: { name: 'db_write', description: 'Altera dados', credentialId: 'cred', operation: 'delete', table: 'orders', requiresConfirmation: false } });
    const registry = createNexusToolRegistry({ workspaceId: 'workspace-1', toolNodes: [node] });
    const result = await registry.executeSafely({ toolName: 'db_write', arguments: { filter_column: 'id', filter_value: '1' }, execution: { executionId: 'execution' } as never, workflow: { id: 'workflow' } as never, node, signal: new AbortController().signal, emit: async () => {} });
    expect(result.record).toMatchObject({ status: 'rejected', error: { code: 'TOOL_PERMISSION_DENIED' } });
  });
  it('registers only the declarative operation exposed by the attachment', () => {
    const node = createWorkflowNode('tool.database', {
      id: 'database-tool',
      position: { x: 0, y: 0 },
      config: {
        name: 'atualizar_cliente',
        description: 'Atualiza o e-mail de um cliente identificado pelo ID.',
        credentialId: 'credential-1',
        operation: 'update',
        table: 'public.clientes',
        values: { email: '{{current.email}}' },
        filters: [{ column: 'id', operator: 'eq', value: '{{current.id}}' }],
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' }, email: { type: 'string' } },
          required: ['id', 'email'],
          additionalProperties: false,
        },
        outputSchema: { type: 'object', additionalProperties: true },
        requiresConfirmation: true,
        permissionScope: 'database:execute',
      },
    });
    const registry = createNexusToolRegistry({ workspaceId: 'workspace-1', toolNodes: [node] });
    const definition = registry.get('atualizar_cliente');
    expect(registry.list()).toHaveLength(1);
    expect(definition).toMatchObject({
      name: 'atualizar_cliente',
      riskLevel: 'high',
      requiresConfirmation: true,
      permissionScope: 'database:execute',
      cacheResult: false,
    });
    expect(definition?.inputJsonSchema).toMatchObject({ required: ['id', 'email'] });
  });

  it('imports the legacy DB tool as a native agent attachment without retaining a connection secret', () => {
    const result = importLegacyNexusFlow({
      raw: {
        nodes: [
          { id: 'start', type: 'start' },
          { id: 'agent', type: 'intelligent-agent', agentName: 'Consultor', agentSystemPrompt: 'Consulte o cadastro.' },
          {
            id: 'db-tool',
            type: 'db-tool',
            dbToolName: 'consultar_cliente',
            dbToolDescription: 'Consulta o cliente pelo documento.',
            dbConnectionId: 'legacy-secret-reference',
            dbOperation: 'select',
            dbTableName: 'clientes',
            dbColumnsToSelect: 'id,nome,email',
            dbFilters: [{ column: 'ativo', operator: '=', value: true }],
          },
          { id: 'end', type: 'end-flow' },
        ],
        connections: [
          { from: 'start', to: 'agent' },
          { from: 'db-tool', to: 'agent', targetHandle: 'tools' },
          { from: 'agent', to: 'end', sourceHandle: 'completed' },
        ],
      },
      workspaceId: 'workspace-1',
      configId: 'config-1',
      name: 'Agente com banco',
      model: dialogyModel,
    });
    const tool = result.workflow.nodes.find((node) => node.type === 'tool.database');
    expect(tool?.config).toMatchObject({
      name: 'consultar_cliente',
      credentialId: '',
      operation: 'select',
      table: 'clientes',
      columns: ['id', 'nome', 'email'],
      filters: [{ column: 'ativo', operator: 'eq', value: true }],
      allowRawSql: false,
    });
    expect(result.workflow.connections).toContainEqual(expect.objectContaining({
      sourceNodeId: tool?.id,
      sourcePortId: 'tool',
      targetPortId: 'tools',
      connectionType: 'tool',
    }));
    expect(JSON.stringify(result.workflow)).not.toContain('legacy-secret-reference');
    expect(result.report.placeholders).toBe(0);
  });
});
