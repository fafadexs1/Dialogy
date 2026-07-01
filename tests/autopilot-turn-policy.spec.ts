import { describe, expect, it } from 'vitest';

import type { AutopilotConfig, KnowledgeBaseDocument } from '@/lib/types';
import {
  authorizeAutopilotTurnPlanTools,
  compileAutopilotTurnPolicy,
} from '@/services/autopilot/turn-policy';

const documents = [
  { id: 'doc-general', name: 'General', content: 'General', collectionIds: ['general'] },
] as KnowledgeBaseDocument[];

describe('autopilot turn policy', () => {
  it('defaults to deny when no flow is configured', () => {
    const policy = compileAutopilotTurnPolicy({
      config: { enabled_tool_names: ['transfer_chat'] } as AutopilotConfig,
      documents,
      intentScope: null,
    });

    expect(policy.allowedToolNames).toEqual([]);
    expect(policy.allowedKnowledgeDocumentIds).toBeUndefined();
    expect(policy.reason).toBe('flow_graph_missing');
  });

  it('allows only globally enabled tools connected to the active flow node', () => {
    const policy = compileAutopilotTurnPolicy({
      config: {
        enabled_tool_names: ['transfer_chat', 'close_chat'],
        flow_graph: {
          version: 1,
          nodes: [
            { id: 'assistant', kind: 'assistant', title: 'Assistant' },
            {
              id: 'transfer',
              kind: 'tool',
              title: 'Transfer',
              toolName: 'transfer_chat',
              config: { instructions: 'Transfira somente para a equipe solicitada pelo cliente.' },
            },
            { id: 'close', kind: 'tool', title: 'Close', toolName: 'close_chat' },
          ],
          edges: [{ id: 'edge-transfer', source: 'assistant', target: 'transfer' }],
        },
      } as unknown as AutopilotConfig,
      documents,
      intentScope: null,
    });

    expect(policy.allowedToolNames).toEqual(['transfer_chat']);
    expect(policy.toolInstructionsByName).toEqual({
      transfer_chat: 'Transfira somente para a equipe solicitada pelo cliente.',
    });
  });

  it('allows tools connected to a native V2 sub-agent', () => {
    const policy = compileAutopilotTurnPolicy({
      config: {
        enabled_tool_names: ['mcp:commerce:list_products'],
        tool_mode: 'on_demand',
        flow_graph: {
          version: 1,
          nodes: [
            {
              id: 'agent',
              kind: 'sub_agent',
              title: 'Agente principal',
              subtitle: 'V2',
              position: { x: 0, y: 0 },
            },
            {
              id: 'catalog',
              kind: 'tool',
              title: 'Catalogo',
              subtitle: 'MCP',
              position: { x: 200, y: 0 },
              toolName: 'mcp:commerce:list_products',
            },
          ],
          edges: [{ id: 'agent-catalog', source: 'agent', target: 'catalog' }],
        },
      } as unknown as AutopilotConfig,
      documents,
      intentScope: null,
    });

    expect(policy.activeNodeId).toBe('agent');
    expect(policy.allowedToolNames).toEqual(['mcp:commerce:list_products']);
    expect(policy.reason).toBe('flow_scoped_tools_allowed');
  });

  it('allows the full directed tool chain of one branch without leaking sibling branch tools', () => {
    const policy = compileAutopilotTurnPolicy({
      config: {
        enabled_tool_names: [
          'sgp_fetch_contact_panel_data',
          'mcp:router:get_wifi_view',
          'mcp:router:reboot_router',
        ],
        tool_mode: 'on_demand',
        flow_graph: {
          version: 1,
          nodes: [
            { id: 'principal', kind: 'sub_agent', title: 'Principal' },
            { id: 'lookup-collect', kind: 'collect', title: 'Validar consulta' },
            { id: 'sgp', kind: 'tool', title: 'SGP', toolName: 'sgp_fetch_contact_panel_data' },
            { id: 'lookup-bridge', kind: 'message', title: 'Validar resultado' },
            { id: 'wifi-view', kind: 'tool', title: 'Wi-Fi', toolName: 'mcp:router:get_wifi_view' },
            { id: 'lookup-response', kind: 'sub_agent', title: 'Responder consulta' },
            { id: 'reboot-collect', kind: 'collect', title: 'Confirmar reboot' },
            { id: 'reboot', kind: 'tool', title: 'Reboot', toolName: 'mcp:router:reboot_router' },
          ],
          edges: [
            { id: 'lookup-sgp', source: 'lookup-collect', target: 'sgp' },
            { id: 'sgp-bridge', source: 'sgp', target: 'lookup-bridge' },
            { id: 'bridge-view', source: 'lookup-bridge', target: 'wifi-view' },
            { id: 'view-response', source: 'wifi-view', target: 'lookup-response' },
            { id: 'reboot-tool', source: 'reboot-collect', target: 'reboot' },
          ],
        },
      } as unknown as AutopilotConfig,
      documents,
      intentScope: null,
      persistedActiveNodeId: 'lookup-collect',
    });

    expect(policy.activeNodeId).toBe('lookup-collect');
    expect(policy.allowedToolNames).toEqual([
      'sgp_fetch_contact_panel_data',
      'mcp:router:get_wifi_view',
    ]);
    expect(policy.allowedToolNames).not.toContain('mcp:router:reboot_router');
  });

  it('lets sub-agents inherit globally enabled tools connected to the principal assistant', () => {
    const policy = compileAutopilotTurnPolicy({
      config: {
        enabled_tool_names: ['transfer_chat', 'close_chat'],
        flow_graph: {
          version: 1,
          nodes: [
            { id: 'assistant', kind: 'assistant', title: 'Assistant' },
            {
              id: 'billing',
              kind: 'intent',
              title: 'Billing',
              config: { intent: 'billing_or_payment', instructions: 'Atenda financeiro.' },
            },
            {
              id: 'transfer',
              kind: 'tool',
              title: 'Transfer',
              toolName: 'transfer_chat',
              config: { instructions: 'Transfira somente quando solicitado.' },
            },
            { id: 'close', kind: 'tool', title: 'Close', toolName: 'close_chat' },
          ],
          edges: [
            { id: 'assistant-billing', source: 'assistant', target: 'billing' },
            { id: 'assistant-transfer', source: 'assistant', target: 'transfer' },
          ],
        },
      } as unknown as AutopilotConfig,
      documents,
      intentScope: {
        nodeId: 'billing',
        title: 'Billing',
        intent: 'billing_or_payment',
        systemPrompt: 'Atenda financeiro.',
      },
    });

    expect(policy.activeNodeId).toBe('billing');
    expect(policy.allowedToolNames).toEqual(['transfer_chat']);
    expect(policy.toolInstructionsByName).toEqual({
      transfer_chat: 'Transfira somente quando solicitado.',
    });
  });

  it('allows internal notes as a transfer companion when globally enabled', () => {
    const policy = compileAutopilotTurnPolicy({
      config: {
        enabled_tool_names: ['transfer_chat', 'add_internal_note'],
        flow_graph: {
          version: 1,
          nodes: [
            { id: 'assistant', kind: 'assistant', title: 'Assistant' },
            { id: 'transfer', kind: 'tool', title: 'Transfer', toolName: 'transfer_chat' },
          ],
          edges: [{ id: 'assistant-transfer', source: 'assistant', target: 'transfer' }],
        },
      } as unknown as AutopilotConfig,
      documents,
      intentScope: null,
    });

    expect(policy.allowedToolNames).toEqual(['transfer_chat', 'add_internal_note']);
  });

  it('does not allow internal notes as a companion when they are globally disabled', () => {
    const policy = compileAutopilotTurnPolicy({
      config: {
        enabled_tool_names: ['transfer_chat'],
        flow_graph: {
          version: 1,
          nodes: [
            { id: 'assistant', kind: 'assistant', title: 'Assistant' },
            { id: 'transfer', kind: 'tool', title: 'Transfer', toolName: 'transfer_chat' },
          ],
          edges: [{ id: 'assistant-transfer', source: 'assistant', target: 'transfer' }],
        },
      } as unknown as AutopilotConfig,
      documents,
      intentScope: null,
    });

    expect(policy.allowedToolNames).toEqual(['transfer_chat']);
  });

  it('denies vector retrieval when a configured flow node has no attached knowledge', () => {
    const policy = compileAutopilotTurnPolicy({
      config: {
        flow_graph: {
          version: 1,
          nodes: [{ id: 'assistant', kind: 'assistant', title: 'Assistant' }],
          edges: [],
        },
      } as unknown as AutopilotConfig,
      documents,
      intentScope: null,
    });

    expect(policy.allowedKnowledgeDocumentIds).toEqual([]);
  });

  it('lets sub-agents inherit knowledge connected to the principal assistant', () => {
    const policy = compileAutopilotTurnPolicy({
      config: {
        flow_graph: {
          version: 1,
          nodes: [
            { id: 'assistant', kind: 'assistant', title: 'Assistant' },
            {
              id: 'billing',
              kind: 'intent',
              title: 'Billing',
              config: { intent: 'billing_or_payment', instructions: 'Atenda financeiro.' },
            },
            { id: 'knowledge', kind: 'knowledge', title: 'Knowledge' },
          ],
          edges: [
            { id: 'assistant-billing', source: 'assistant', target: 'billing' },
            { id: 'knowledge-assistant', source: 'knowledge', target: 'assistant' },
          ],
        },
      } as unknown as AutopilotConfig,
      documents,
      intentScope: {
        nodeId: 'billing',
        title: 'Billing',
        intent: 'billing_or_payment',
        systemPrompt: 'Atenda financeiro.',
      },
    });

    expect(policy.allowedKnowledgeDocumentIds).toEqual(['doc-general']);
  });

  it('lets the deterministic turn plan authorize an exact globally enabled tool missing from an old graph', () => {
    const policy = compileAutopilotTurnPolicy({
      config: {
        enabled_tool_names: [
          'mcp:router:get_wifi_view',
          'mcp:router:scan_wifi_neighbors',
          'mcp:router:reboot_router',
        ],
        tool_mode: 'on_demand',
        flow_graph: {
          version: 1,
          nodes: [
            { id: 'agent', kind: 'sub_agent', title: 'Agent' },
            {
              id: 'wifi',
              kind: 'tool',
              title: 'Wi-Fi',
              toolName: 'mcp:router:get_wifi_view',
            },
          ],
          edges: [{ id: 'agent-wifi', source: 'agent', target: 'wifi' }],
        },
      } as unknown as AutopilotConfig,
      documents,
      intentScope: null,
    });

    const authorization = authorizeAutopilotTurnPlanTools(
      policy,
      ['mcp:router:scan_wifi_neighbors'],
      ['mcp:router:scan_wifi_neighbors'],
    );

    expect(authorization.planningToolNames).toEqual([
      'mcp:router:get_wifi_view',
      'mcp:router:scan_wifi_neighbors',
    ]);
    expect(authorization.widenedToolNames).toEqual(['mcp:router:scan_wifi_neighbors']);
    expect(authorization.allowedToolNames).toEqual([
      'mcp:router:get_wifi_view',
      'mcp:router:scan_wifi_neighbors',
    ]);
    expect(authorization.blockedToolNames).toEqual([]);
  });

  it('never lets the turn plan bypass an explicit deny mode or a disabled tool', () => {
    const policy = compileAutopilotTurnPolicy({
      config: {
        enabled_tool_names: ['mcp:router:get_wifi_view'],
        tool_mode: 'deny',
        flow_graph: {
          version: 1,
          nodes: [{ id: 'agent', kind: 'sub_agent', title: 'Agent' }],
          edges: [],
        },
      } as unknown as AutopilotConfig,
      documents,
      intentScope: null,
    });

    const authorization = authorizeAutopilotTurnPlanTools(policy, [
      'mcp:router:get_wifi_view',
      'mcp:router:reboot_router',
    ]);

    expect(authorization.planningToolNames).toEqual([]);
    expect(authorization.allowedToolNames).toEqual([]);
    expect(authorization.widenedToolNames).toEqual([]);
    expect(authorization.blockedToolNames).toEqual([
      'mcp:router:get_wifi_view',
      'mcp:router:reboot_router',
    ]);
  });
});
