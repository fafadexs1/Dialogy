import { describe, expect, it } from 'vitest';

import { listAgentToolCatalogItems } from '@/services/agent-tools/catalog';
import { createWorkflowNode } from '@/services/workflow-runtime/catalog';
import {
  attachNativeToolToPrimaryAgent,
  buildNativeAgentToolConfig,
  detachNativeToolFromWorkflow,
  getWorkflowToolName,
  getNativeAgentToolLabel,
  groupNativeAgentTools,
  isNativeAgentControlPlaneTool,
  isNativeAgentToolAttachable,
  isNativeAgentToolEligible,
  isNativeAgentToolRecommended,
  listAttachedWorkflowToolNames,
  nativeAgentToolTestId,
  reconcileNativeWorkflowTools,
  synchronizeNativeWorkflowToolState,
  type NativeAgentToolCatalogItem,
} from '@/services/workflow-runtime/native-agent-tools';
import { createNativeWorkflowTemplate } from '@/services/workflow-runtime/native-templates';
import type { ModelConfiguration } from '@/services/workflow-runtime/types';

const model: ModelConfiguration = {
  provider: 'fake',
  model: 'tool-model',
  temperature: 0.2,
  maxOutputTokens: 2_048,
  supportsTools: true,
  supportsStructuredOutput: true,
  supportsStreaming: false,
  timeoutMs: 60_000,
  maxRetries: 2,
};

function mcpTool(overrides: Partial<NativeAgentToolCatalogItem> = {}): NativeAgentToolCatalogItem {
  return {
    name: 'mcp:billing:create_invoice',
    description: 'Cria uma fatura após confirmação.',
    source: 'mcp',
    serverId: 'billing',
    serverName: 'Financeiro',
    version: 'mcp',
    class: 'write_non_idempotent',
    riskLevel: 'high',
    sideEffect: 'high',
    idempotent: false,
    timeoutMs: 45_000,
    maxAttempts: 2,
    requiresHumanApproval: false,
    customerVisible: true,
    allowedIntents: [],
    requiredSlots: ['invoice_or_payment_id'],
    fallbackAction: 'handoff',
    inputSchema: { type: 'object', properties: { amount: { type: 'number' } } },
    outputSchema: { type: 'object', properties: { invoiceId: { type: 'string' } } },
    ...overrides,
  };
}

describe('native workflow agent tool catalog', () => {
  it('provides friendly internal labels and keeps blocked operations visible but ineligible', () => {
    const tools = listAgentToolCatalogItems();
    const transfer = tools.find((tool) => tool.name === 'transfer_chat')!;
    const blockedTicket = tools.find((tool) => tool.name === 'sgp_open_support_ticket')!;

    expect(getNativeAgentToolLabel(transfer)).toBe('Transferir atendimento');
    expect(isNativeAgentToolEligible(transfer)).toBe(true);
    expect(getNativeAgentToolLabel(blockedTicket)).toBe('Abrir chamado no SGP');
    expect(isNativeAgentToolEligible(blockedTicket)).toBe(false);
    expect(isNativeAgentToolAttachable(transfer)).toBe(false);
    expect(isNativeAgentToolRecommended(transfer)).toBe(false);
    expect(isNativeAgentToolRecommended(blockedTicket)).toBe(false);
    expect(nativeAgentToolTestId('mcp:billing:create_invoice')).toBe('agent-tool-mcp-billing-create-invoice');
  });

  it('uses native blocks for conversation control while keeping audited note and CRM tools attachable', () => {
    const catalog = listAgentToolCatalogItems();
    for (const name of ['transfer_chat', 'close_chat']) {
      const tool = catalog.find((item) => item.name === name)!;
      expect(isNativeAgentControlPlaneTool(tool)).toBe(true);
      expect(isNativeAgentToolEligible(tool)).toBe(true);
      expect(isNativeAgentToolAttachable(tool)).toBe(false);
    }
    for (const name of ['add_internal_note', 'crm_update_contact_custom_fields']) {
      const tool = catalog.find((item) => item.name === name)!;
      expect(isNativeAgentControlPlaneTool(tool)).toBe(false);
      expect(isNativeAgentToolEligible(tool)).toBe(true);
      expect(isNativeAgentToolAttachable(tool)).toBe(true);
    }

    expect(isNativeAgentToolAttachable(mcpTool())).toBe(true);
    expect(isNativeAgentToolAttachable(catalog.find((tool) => tool.name === 'sgp_fetch_contracts')!)).toBe(true);
  });

  it('groups MCP tools by their server and humanizes qualified technical names', () => {
    const groups = groupNativeAgentTools([mcpTool({ displayName: undefined })]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ id: 'mcp:billing', label: 'Financeiro' });
    expect(getNativeAgentToolLabel(groups[0].tools[0])).toBe('Create invoice');
  });

  it('autofills complete executable metadata, confirms high risk and stores only the raw MCP tool in allowedTools', () => {
    const config = buildNativeAgentToolConfig(mcpTool());

    expect(config).toMatchObject({
      name: 'mcp:billing:create_invoice',
      displayName: 'Create invoice',
      serverId: 'billing',
      serverName: 'Financeiro',
      allowedTools: ['create_invoice'],
      riskLevel: 'high',
      sideEffect: 'high',
      idempotent: false,
      timeoutMs: 45_000,
      maxAttempts: 2,
      requiresConfirmation: true,
      permissionScope: 'automations:execute_sensitive_tool',
      audit: true,
    });
    expect(config.inputSchema).toEqual(mcpTool().inputSchema);
    expect(config.outputSchema).toEqual(mcpTool().outputSchema);
  });
});

describe('native workflow tool permission synchronization', () => {
  const workflowWithTools = () => {
    const workflow = createNativeWorkflowTemplate({
      configId: 'config-tools',
      workspaceId: 'workspace-tools',
      name: 'Agente com ferramentas',
      model,
      persona: 'Objetivo e seguro.',
      template: 'single_agent',
    });
    const agent = workflow.nodes.find((node) => node.type === 'ai.agent')!;
    const transfer = createWorkflowNode('tool.internal', {
      id: 'tool-transfer',
      name: 'Transferir atendimento',
      position: { x: 0, y: 500 },
      config: buildNativeAgentToolConfig({
        ...listAgentToolCatalogItems().find((tool) => tool.name === 'transfer_chat')!,
      }),
    });
    const mcp = createWorkflowNode('tool.mcp', {
      id: 'tool-mcp',
      name: 'Create invoice',
      position: { x: 200, y: 500 },
      config: buildNativeAgentToolConfig(mcpTool()),
    });
    const orphan = createWorkflowNode('tool.internal', {
      id: 'tool-orphan',
      name: 'Nota órfã',
      position: { x: 400, y: 500 },
      config: { name: 'add_internal_note', action: 'add_internal_note', description: 'Nota', inputSchema: {}, outputSchema: {} },
    });
    workflow.nodes.push(transfer, mcp, orphan);
    workflow.connections.push(
      {
        id: 'agent-transfer', sourceNodeId: transfer.id, sourcePortId: 'tool',
        targetNodeId: agent.id, targetPortId: 'tools', connectionType: 'tool',
      },
      {
        id: 'agent-mcp', sourceNodeId: mcp.id, sourcePortId: 'tool',
        targetNodeId: agent.id, targetPortId: 'tools', connectionType: 'tool',
      },
      {
        id: 'agent-mcp-duplicate', sourceNodeId: mcp.id, sourcePortId: 'tool',
        targetNodeId: agent.id, targetPortId: 'tools', connectionType: 'tool',
      },
    );
    return workflow;
  };

  it('derives exact permissions from attached tools, excluding orphan nodes and duplicates', () => {
    expect(listAttachedWorkflowToolNames(workflowWithTools())).toEqual([
      'transfer_chat',
      'mcp:billing:create_invoice',
    ]);
  });

  it('connects a tool enabled in the global panel to the primary workflow agent', () => {
    const workflow = createNativeWorkflowTemplate({
      configId: 'config-global-tools',
      workspaceId: 'workspace-global-tools',
      name: 'Agente com painel global',
      model,
      persona: 'Objetivo e seguro.',
      template: 'single_agent',
    });
    const tool = mcpTool();

    const attached = attachNativeToolToPrimaryAgent(workflow, tool);
    const attachedAgain = attachNativeToolToPrimaryAgent(attached.workflow, tool);

    expect(attached.status).toBe('attached');
    expect(listAttachedWorkflowToolNames(attached.workflow)).toContain(tool.name);
    expect(attached.workflow.nodes.filter((node) => getWorkflowToolName(node) === tool.name)).toHaveLength(1);
    expect(attachedAgain.status).toBe('already_attached');
    expect(attachedAgain.workflow.connections.filter((connection) => connection.connectionType === 'tool')).toHaveLength(1);
  });

  it('does not materialize control-plane tools from the global panel', () => {
    const workflow = createNativeWorkflowTemplate({
      configId: 'config-control-plane',
      workspaceId: 'workspace-control-plane',
      name: 'Agente seguro',
      model,
      persona: 'Objetivo e seguro.',
      template: 'single_agent',
    });
    const transfer = listAgentToolCatalogItems().find((tool) => tool.name === 'transfer_chat')!;

    const result = attachNativeToolToPrimaryAgent(workflow, transfer);

    expect(result.status).toBe('ineligible');
    expect(result.workflow).toBe(workflow);
  });

  it('removes the tool node and all of its connections when disabled globally', () => {
    const workflow = createNativeWorkflowTemplate({
      configId: 'config-disable-global-tool',
      workspaceId: 'workspace-disable-global-tool',
      name: 'Agente com remocao global',
      model,
      persona: 'Objetivo e seguro.',
      template: 'single_agent',
    });
    const tool = mcpTool();
    const attached = attachNativeToolToPrimaryAgent(workflow, tool);
    const toolNode = attached.workflow.nodes.find((node) => getWorkflowToolName(node) === tool.name)!;

    const detached = detachNativeToolFromWorkflow(attached.workflow, tool.name);
    const detachedAgain = detachNativeToolFromWorkflow(detached.workflow, tool.name);

    expect(detached.status).toBe('detached');
    expect(listAttachedWorkflowToolNames(detached.workflow)).not.toContain(tool.name);
    expect(detached.workflow.nodes.some((node) => node.id === toolNode.id)).toBe(false);
    expect(detached.workflow.connections.some((connection) => (
      connection.sourceNodeId === toolNode.id || connection.targetNodeId === toolNode.id
    ))).toBe(false);
    expect(detachedAgain.status).toBe('not_attached');
    expect(detachedAgain.workflow).toBe(detached.workflow);
  });

  it('repairs stale native permissions on load/save while preserving legacy selections', () => {
    const workflow = workflowWithTools();
    const native = synchronizeNativeWorkflowToolState({
      workflow_builder_mode: 'native_v2',
      workflow_definition: workflow,
      enabled_tool_names: ['stale_tool'],
    });
    const legacy = synchronizeNativeWorkflowToolState({
      workflow_builder_mode: 'legacy',
      workflow_definition: workflow,
      enabled_tool_names: ['legacy_tool'],
    });

    expect(native.enabled_tool_names).toEqual(['transfer_chat', 'mcp:billing:create_invoice']);
    expect(legacy.enabled_tool_names).toEqual(['legacy_tool']);
  });

  it('reimposes canonical schemas and confirmation before publication', () => {
    const workflow = workflowWithTools();
    const mcpNode = workflow.nodes.find((node) => node.id === 'tool-mcp')!;
    mcpNode.config = {
      ...mcpNode.config,
      requiresConfirmation: false,
      requiresHumanApproval: false,
      inputSchema: { tampered: true },
    };

    const reconciled = reconcileNativeWorkflowTools(workflow, [
      ...listAgentToolCatalogItems(),
      mcpTool(),
    ]);

    expect(reconciled.errors).toEqual([]);
    const canonicalMcp = reconciled.workflow.nodes.find((node) => node.id === 'tool-mcp')!;
    expect(canonicalMcp.config.requiresConfirmation).toBe(true);
    expect(canonicalMcp.config.requiresHumanApproval).toBe(true);
    expect(canonicalMcp.config.inputSchema).toEqual(mcpTool().inputSchema);
    expect(reconciled.workflow.nodes.some((node) => node.id === 'tool-transfer')).toBe(true);
  });

  it('blocks attached tools that disappeared from or are ineligible in the workspace catalog', () => {
    const workflow = workflowWithTools();
    const missing = reconcileNativeWorkflowTools(workflow, listAgentToolCatalogItems());
    expect(missing.errors.join(' ')).toContain('não existe mais');

    const blockedWorkflow = workflowWithTools();
    const transfer = blockedWorkflow.nodes.find((node) => node.id === 'tool-transfer')!;
    transfer.config = { ...transfer.config, name: 'sgp_open_support_ticket', action: 'sgp_open_support_ticket' };
    const blocked = reconcileNativeWorkflowTools(blockedWorkflow, listAgentToolCatalogItems());
    expect(blocked.errors.join(' ')).toContain('não está liberada');
  });
});
