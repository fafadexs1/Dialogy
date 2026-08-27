import { describe, expect, it, vi } from 'vitest';

import { executeNexusMcpOperation } from '@/modules/nexus/services/mcp-executor';
import { createNexusToolRegistry } from '@/modules/nexus/services/tool-registry';
import { createWorkflowNode } from '@/services/workflow-runtime';

const server = {
  id: 'billing', name: 'Billing MCP', url: 'https://mcp.example.com', transport: 'streamable_http' as const,
  isActive: true,
  tools: [{
    qualifiedName: 'mcp:billing:get_invoice', serverId: 'billing', serverName: 'Billing MCP', name: 'get_invoice',
    description: 'Consulta uma fatura.', inputSchema: { type: 'object', properties: { invoiceId: { type: 'string' } }, required: ['invoiceId'] },
    annotations: { readOnlyHint: true },
  }],
};

describe('Nexus native MCP runtime', () => {
  it('validates and executes a synchronized Dialogy MCP tool', async () => {
    const callTool = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'paid' }] });
    const recordHealth = vi.fn().mockResolvedValue(undefined);
    const result = await executeNexusMcpOperation({
      workspaceId: 'workspace-1', qualifiedName: 'mcp:billing:get_invoice', arguments: { invoiceId: 42 },
      getConfig: async () => ({ servers: [server] }), callTool, recordHealth,
    });
    expect(callTool).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'get_invoice', arguments: { invoiceId: '42' } }));
    expect(result).toMatchObject({ qualifiedName: 'mcp:billing:get_invoice', riskLevel: 'low', result: { content: [{ text: 'paid' }] } });
    expect(recordHealth).toHaveBeenCalledWith(expect.objectContaining({ status: 'healthy', serverId: 'billing' }));
  });

  it('registers MCP attachments as real model-callable tools', () => {
    const node = createWorkflowNode('tool.mcp', {
      id: 'mcp-tool', name: 'Consultar fatura', position: { x: 0, y: 0 },
      config: {
        name: 'mcp:billing:get_invoice', description: 'Consulta uma fatura.', serverId: 'billing',
        allowedTools: ['get_invoice'], inputSchema: server.tools[0].inputSchema, outputSchema: {},
        riskLevel: 'low', requiresConfirmation: false,
      },
    });
    const registry = createNexusToolRegistry({ workspaceId: 'workspace-1', toolNodes: [node], executeMcpOperation: vi.fn() });
    expect(registry.get('mcp:billing:get_invoice')).toMatchObject({ riskLevel: 'low', requiresConfirmation: false, cacheResult: false });
  });

  it('blocks medium-risk direct calls without explicit confirmation', async () => {
    const writeServer = {
      ...server,
      tools: [{ ...server.tools[0], qualifiedName: 'mcp:billing:create_invoice', name: 'create_invoice', description: 'Cria uma nova fatura.', annotations: null }],
    };
    await expect(executeNexusMcpOperation({
      workspaceId: 'workspace-1', qualifiedName: 'mcp:billing:create_invoice', arguments: { invoiceId: '42' },
      getConfig: async () => ({ servers: [writeServer] }), callTool: vi.fn(), recordHealth: vi.fn().mockResolvedValue(undefined),
    })).rejects.toThrow('exige confirmação explícita');
  });
});
