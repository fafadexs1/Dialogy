import { describe, expect, it } from 'vitest';

import type { AutopilotFlowGraph } from '@/lib/types';
import type { AgentToolCatalogItem } from '@/services/agent-tools/catalog';
import {
  analyzeAutopilotToolCoverage,
  isAutopilotToolCoveragePublishBlocked,
  summarizeAutopilotToolCoverageBlockers,
} from '@/services/autopilot/tool-coverage';

function tool(input: {
  name: string;
  riskLevel: 'low' | 'medium' | 'high';
  sideEffect: 'none' | 'low' | 'medium' | 'high';
}): AgentToolCatalogItem {
  return {
    name: input.name as any,
    version: 'test',
    description: input.name,
    class: input.sideEffect === 'none' ? 'read_only' : 'write_non_idempotent',
    riskLevel: input.riskLevel,
    sideEffect: input.sideEffect,
    idempotent: input.sideEffect === 'none',
    timeoutMs: 1000,
    maxAttempts: 1,
    requiresHumanApproval: false,
    customerVisible: true,
    allowedIntents: [],
    requiredSlots: [],
    fallbackAction: 'handoff',
    source: 'mcp',
    enabledByDefault: false,
  };
}

describe('autopilot tool coverage', () => {
  it('allows only missing read-only tools to use the deterministic runtime fallback', () => {
    const graph: AutopilotFlowGraph = {
      version: 1,
      nodes: [
        {
          id: 'agent',
          kind: 'sub_agent',
          title: 'Agent',
          subtitle: '',
          position: { x: 0, y: 0 },
        },
        {
          id: 'wifi-view',
          kind: 'tool',
          title: 'Wi-Fi',
          subtitle: '',
          position: { x: 240, y: 0 },
          toolName: 'mcp:router:get_wifi_view',
        },
      ],
      edges: [{ id: 'agent-view', source: 'agent', target: 'wifi-view' }],
    };
    const report = analyzeAutopilotToolCoverage({
      graph,
      enabledToolNames: [
        'mcp:router:get_wifi_view',
        'mcp:router:scan_wifi_neighbors',
        'mcp:router:reboot_router',
      ],
      toolCatalog: [
        tool({ name: 'mcp:router:get_wifi_view', riskLevel: 'low', sideEffect: 'none' }),
        tool({ name: 'mcp:router:scan_wifi_neighbors', riskLevel: 'low', sideEffect: 'none' }),
        tool({ name: 'mcp:router:reboot_router', riskLevel: 'high', sideEffect: 'high' }),
      ],
    });

    expect(report).toMatchObject({
      status: 'branch_required',
      attachedEnabledToolNames: ['mcp:router:get_wifi_view'],
      safeFallbackToolNames: ['mcp:router:scan_wifi_neighbors'],
      branchRequiredToolNames: ['mcp:router:reboot_router'],
      unknownEnabledToolNames: [],
      coverageRatio: 0.6667,
    });
    expect(isAutopilotToolCoveragePublishBlocked(report)).toBe(true);
    expect(summarizeAutopilotToolCoverageBlockers(report)).toContain('mcp:router:reboot_router');
  });

  it('reports unknown enabled tools and duplicate graph declarations', () => {
    const graph = {
      version: 1,
      nodes: [
        { id: 'one', kind: 'tool', title: 'One', toolName: 'mcp:x:read' },
        { id: 'two', kind: 'tool', title: 'Two', toolName: 'mcp:x:read' },
      ],
      edges: [],
    } as unknown as AutopilotFlowGraph;
    const report = analyzeAutopilotToolCoverage({
      graph,
      enabledToolNames: ['mcp:x:read', 'mcp:x:missing'],
      toolCatalog: [tool({ name: 'mcp:x:read', riskLevel: 'low', sideEffect: 'none' })],
    });

    expect(report.status).toBe('branch_required');
    expect(report.duplicateToolNames).toEqual(['mcp:x:read']);
    expect(report.unknownEnabledToolNames).toEqual(['mcp:x:missing']);
  });

  it('blocks a sensitive tool declared without an explicit confirmation ancestor', () => {
    const sensitive = tool({
      name: 'mcp:router:reboot_router',
      riskLevel: 'high',
      sideEffect: 'high',
    });
    const unguardedGraph = {
      version: 1,
      nodes: [
        { id: 'agent', kind: 'sub_agent', title: 'Agent' },
        { id: 'reboot', kind: 'tool', title: 'Reboot', toolName: sensitive.name },
      ],
      edges: [{ id: 'agent-reboot', source: 'agent', target: 'reboot' }],
    } as unknown as AutopilotFlowGraph;
    const guardedGraph = {
      ...unguardedGraph,
      nodes: [
        {
          id: 'confirm',
          kind: 'collect',
          title: 'Confirmar reboot',
          config: {
            formFields: [{
              id: 'confirmation',
              label: 'Confirmacao explicita',
              fieldKey: 'router_reboot_confirmation',
              required: true,
            }],
          },
        },
        unguardedGraph.nodes[1],
      ],
      edges: [{ id: 'confirm-reboot', source: 'confirm', target: 'reboot' }],
    } as unknown as AutopilotFlowGraph;

    const unguarded = analyzeAutopilotToolCoverage({
      graph: unguardedGraph,
      enabledToolNames: [String(sensitive.name)],
      toolCatalog: [sensitive],
    });
    const guarded = analyzeAutopilotToolCoverage({
      graph: guardedGraph,
      enabledToolNames: [String(sensitive.name)],
      toolCatalog: [sensitive],
    });

    expect(unguarded.status).toBe('branch_required');
    expect(unguarded.unguardedToolNames).toEqual([sensitive.name]);
    expect(guarded.status).toBe('covered');
    expect(guarded.unguardedToolNames).toEqual([]);
  });
});
