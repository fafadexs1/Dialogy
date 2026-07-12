import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  resolveAppliedProposalToolNames,
  selectFlowBuilderTools,
} from '@/services/autopilot/flow-builder-tool-scope';
import type { AgentToolCatalogItem } from '@/services/agent-tools/catalog';

function tool(
  name: string,
  enabledByDefault = false,
  overrides: Partial<AgentToolCatalogItem> = {},
): AgentToolCatalogItem {
  return {
    name: name as AgentToolCatalogItem['name'],
    version: 'test',
    description: name,
    class: 'retrieval',
    riskLevel: 'low',
    sideEffect: 'none',
    idempotent: true,
    timeoutMs: 1000,
    maxAttempts: 1,
    requiresHumanApproval: false,
    customerVisible: true,
    allowedIntents: ['support_request'],
    requiredSlots: [],
    fallbackAction: 'handoff',
    source: name.startsWith('mcp:') ? 'mcp' : 'dialogy',
    enabledByDefault,
    ...overrides,
  };
}

describe('Flowbuilder tool scope', () => {
  const catalog = [
    tool('default_read', true),
    tool('mcp:router:get_wifi_view'),
    tool('mcp:router:reboot_router'),
    tool('blocked_operation', false, { allowedIntents: [] }),
  ];

  it('offers the complete eligible workspace catalog, including MCP, without exposing blocked operations', () => {
    expect(selectFlowBuilderTools({
      catalog,
      requestedEnabledToolNames: [],
      persistedEnabledToolNames: ['default_read'],
      mode: 'all_eligible',
    }).map((item) => item.name)).toEqual([
      'default_read',
      'mcp:router:get_wifi_view',
      'mcp:router:reboot_router',
    ]);

    expect(selectFlowBuilderTools({
      catalog,
      requestedEnabledToolNames: ['blocked_operation'],
    })).toEqual([]);
  });

  it('uses the current editor selection, including an explicit empty selection', () => {
    expect(selectFlowBuilderTools({
      catalog,
      requestedEnabledToolNames: ['mcp:router:get_wifi_view'],
      persistedEnabledToolNames: ['mcp:router:reboot_router'],
    }).map((item) => item.name)).toEqual(['mcp:router:get_wifi_view']);

    expect(selectFlowBuilderTools({
      catalog,
      requestedEnabledToolNames: [],
      persistedEnabledToolNames: ['mcp:router:reboot_router'],
    })).toEqual([]);
  });

  it('uses persisted tools when the editor does not send a selection', () => {
    expect(selectFlowBuilderTools({
      catalog,
      persistedEnabledToolNames: ['mcp:router:get_wifi_view'],
    }).map((item) => item.name)).toEqual(['mcp:router:get_wifi_view']);
  });

  it('falls back to defaults only for legacy configs without a persisted array', () => {
    expect(selectFlowBuilderTools({
      catalog,
      persistedEnabledToolNames: null,
    }).map((item) => item.name)).toEqual(['default_read']);
  });

  it('replaces stale enabled tools with the exact validated proposal set', () => {
    expect(resolveAppliedProposalToolNames({
      proposalToolNames: [
        'mcp:router:get_wifi_view',
        'mcp:router:get_wifi_view',
        'invented_tool',
      ],
      catalogToolNames: catalog.map((item) => String(item.name)),
    })).toEqual(['mcp:router:get_wifi_view']);
  });

  it('activates complete-catalog generation explicitly in both AI builder actions', () => {
    const actionSource = readFileSync('src/actions/autopilot.ts', 'utf8');
    expect(actionSource.match(/mode: 'all_eligible'/g)).toHaveLength(2);
  });
});
