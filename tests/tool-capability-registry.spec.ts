import { describe, expect, it } from 'vitest';

import { listAgentToolCatalogItems, type AgentToolCatalogItem } from '@/services/agent-tools/catalog';
import { resolveAutopilotIntent } from '@/services/autopilot-intent';
import { extractAutopilotSlots } from '@/services/autopilot/slots';
import {
  evaluateToolCapabilityGate,
  findToolCapabilityForAction,
  listToolCapabilities,
} from '@/services/autopilot/tool-capability-registry';
import type { Contact } from '@/lib/types';

const contact: Contact = {
  id: 'contact-1',
  workspace_id: 'workspace-1',
  name: 'Cliente',
};

describe('tool capability registry', () => {
  it('projects catalog tools into formal capabilities', () => {
    const capabilities = listToolCapabilities(listAgentToolCatalogItems());
    const panel = capabilities.find((capability) => capability.name === 'sgp_fetch_contact_panel_data');

    expect(panel).toMatchObject({
      capability: 'check_customer_status',
      riskLevel: 'low',
      source: 'dialogy',
      requiredSlots: ['customer_identifier'],
    });
    expect(panel?.allowedGoals).toContain('billing_or_payment');
  });

  it('allows a tool when goal, slots and enabled policy are satisfied', () => {
    const message = 'Preciso da segunda via. CPF 529.982.247-25';
    const intentResolution = resolveAutopilotIntent({ customerMessage: message });
    const result = evaluateToolCapabilityGate({
      action: { type: 'sgp_fetch_contact_panel_data', payload: {} },
      intentResolution,
      slotExtraction: extractAutopilotSlots({ customerMessage: message, contact }),
      enabledToolNames: ['sgp_fetch_contact_panel_data'],
      toolCatalog: listAgentToolCatalogItems(),
    });

    expect(result).toMatchObject({
      allowed: true,
      code: 'allowed',
      missingSlots: [],
    });
    expect(result.score).toBeGreaterThanOrEqual(0.95);
  });

  it('blocks operational tools when required slots are missing', () => {
    const message = 'Preciso da segunda via do boleto';
    const intentResolution = resolveAutopilotIntent({ customerMessage: message });
    const result = evaluateToolCapabilityGate({
      action: { type: 'sgp_fetch_contact_panel_data', payload: {} },
      intentResolution,
      slotExtraction: extractAutopilotSlots({ customerMessage: message, contact }),
      enabledToolNames: ['sgp_fetch_contact_panel_data'],
      toolCatalog: listAgentToolCatalogItems(),
    });

    expect(result).toMatchObject({
      allowed: false,
      code: 'missing_slots',
      missingSlots: ['customer_identifier'],
    });
    expect(result.scoreBreakdown.requiredSlotsPresent).toBe(0);
  });

  it('uses custom auditable weights without changing hard policy gates', () => {
    const message = 'Preciso da segunda via do boleto';
    const intentResolution = resolveAutopilotIntent({ customerMessage: message });
    const result = evaluateToolCapabilityGate({
      action: { type: 'sgp_fetch_contact_panel_data', payload: {} },
      intentResolution,
      slotExtraction: extractAutopilotSlots({ customerMessage: message, contact }),
      enabledToolNames: ['sgp_fetch_contact_panel_data'],
      toolCatalog: listAgentToolCatalogItems(),
      scoringWeights: {
        requiredSlotsPresent: 0.8,
        goalMatch: 0.1,
        procedureStepMatch: 0.1,
        policyAllowed: 0,
        toolEvidence: 0,
      },
    });

    expect(result.allowed).toBe(false);
    expect(result.code).toBe('missing_slots');
    expect(result.scoreBreakdown.weights).toMatchObject({
      requiredSlotsPresent: 0.8,
      goalMatch: 0.1,
    });
  });

  it('blocks tools when the auditable selection score is below threshold', () => {
    const weakEvidenceTool: AgentToolCatalogItem = {
      ...listAgentToolCatalogItems()[0],
      name: 'mcp:router:weak_lookup' as any,
      source: 'mcp',
      description: '',
      class: 'read_only',
      riskLevel: 'low',
      sideEffect: 'none',
      requiredSlots: [],
      allowedIntents: ['troubleshooting'],
      requiresHumanApproval: false,
      enabledByDefault: false,
      serverId: 'router',
      serverName: 'Router',
      inputSchema: null,
      outputSchema: null,
    };
    const result = evaluateToolCapabilityGate({
      action: {
        type: 'mcp_call_tool',
        payload: { toolName: 'mcp:router:weak_lookup', arguments: {} },
      },
      intentResolution: { intent: 'troubleshooting' },
      slotExtraction: { slots: {}, details: [], invalidSlots: [] },
      enabledToolNames: ['mcp:router:weak_lookup'],
      toolCatalog: [...listAgentToolCatalogItems(), weakEvidenceTool],
      scoringWeights: {
        goalMatch: 0,
        procedureStepMatch: 0,
        requiredSlotsPresent: 0,
        policyAllowed: 0,
        toolEvidence: 1,
      },
    });

    expect(result).toMatchObject({
      allowed: false,
      code: 'score_below_threshold',
    });
    expect(result.score).toBeLessThan(0.75);
  });

  it('blocks tools outside their allowed customer goal', () => {
    const message = 'Quais planos de internet voces tem?';
    const intentResolution = resolveAutopilotIntent({ customerMessage: message });
    const result = evaluateToolCapabilityGate({
      action: { type: 'sgp_generate_invoice_pix', payload: { invoiceId: '1', contractId: '2' } },
      intentResolution,
      slotExtraction: extractAutopilotSlots({ customerMessage: message, contact }),
      enabledToolNames: ['sgp_generate_invoice_pix'],
      toolCatalog: listAgentToolCatalogItems(),
    });

    expect(result.allowed).toBe(false);
    expect(result.code).toBe('intent_not_allowed');
  });

  it('resolves MCP actions by concrete qualified tool name', () => {
    const capability = findToolCapabilityForAction({
      action: {
        type: 'mcp_call_tool',
        payload: { toolName: 'mcp:router:find_router_by_ip', arguments: {} },
      },
      toolCatalog: [
        {
          ...listAgentToolCatalogItems()[0],
          name: 'mcp:router:find_router_by_ip' as any,
          source: 'mcp',
          description: 'Find router by IP',
          class: 'read_only',
          riskLevel: 'low',
          sideEffect: 'none',
          requiredSlots: [],
          allowedIntents: ['troubleshooting'],
        },
      ],
    });

    expect(capability).toMatchObject({
      name: 'mcp:router:find_router_by_ip',
      capability: 'external_find_router_by_ip',
      source: 'mcp',
    });
  });
});
