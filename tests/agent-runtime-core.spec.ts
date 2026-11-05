import { describe, expect, it } from 'vitest';

import {
  assertValidAgentTaskTransition,
  sanitizeAgentDomainPackDefinition,
  validateAgentDomainPackDefinition,
} from '@/services/agent-runtime/types';
import { compileAutopilotConfigToDomainPack } from '@/services/agent-runtime/domain-packs';
import {
  authorizeAgentToolCapability,
  hasConfirmedCapabilityAction,
} from '@/services/agent-runtime/capability-gateway';
import { evaluateAgentScenario } from '@/services/agent-runtime/evaluation';
import {
  buildKnowledgeEvidence,
  buildOperationalToolEvidence,
  validateAgentAnswerGrounding,
} from '@/services/agent-runtime/grounding';
import { mergeAgentMemory } from '@/services/agent-runtime/memory';
import { summarizeAgentTrace } from '@/services/agent-runtime/trace';
import { listAgentToolCatalogItems } from '@/services/agent-tools/catalog';

describe('universal agent runtime contracts', () => {
  it('allows resumable task transitions and rejects terminal task reopening', () => {
    expect(() => assertValidAgentTaskTransition('active', 'waiting_input')).not.toThrow();
    expect(() => assertValidAgentTaskTransition('waiting_input', 'active')).not.toThrow();
    expect(() => assertValidAgentTaskTransition('completed', 'active')).toThrow(/Transicao de tarefa invalida/);
  });

  it('sanitizes and validates a domain pack without introducing niche logic in the runtime', () => {
    const definition = sanitizeAgentDomainPackDefinition({
      identity: { niche: 'provedor de internet', businessName: 'Velpro' },
      goals: [{ id: 'diagnose_connection', label: 'Diagnosticar conexao' }],
      toolNames: ['lookup_customer_connection', 'lookup_customer_connection'],
    });

    expect(definition.identity?.niche).toBe('provedor de internet');
    expect(definition.toolNames).toEqual(['lookup_customer_connection']);
    expect(validateAgentDomainPackDefinition(definition)).toEqual([]);
  });

  it('requires explicit confirmation for high-risk capabilities', () => {
    const action = {
      type: 'sgp_create_payment_promise' as const,
      payload: {
        contractId: '123',
        promiseDate: '2026-08-20',
      },
    };
    const authorization = authorizeAgentToolCapability({
      action,
      intentResolution: { intent: 'billing_or_payment' },
      slotExtraction: {
        slots: { customer_identifier: 'customer-1' },
        details: [],
        invalidSlots: [],
      },
      enabledToolNames: ['sgp_create_payment_promise'],
      toolCatalog: listAgentToolCatalogItems(),
      enforceConfirmation: true,
    });

    expect(authorization.allowed).toBe(false);
    expect(authorization.code).toBe('requires_confirmation');
    expect(authorization.confirmationRequired).toBe(true);
    expect(hasConfirmedCapabilityAction({
      action,
      confirmedActionFingerprint: authorization.idempotencyKey,
    })).toBe(true);
  });

  it('allows a read-only capability when required slots and scope are present', () => {
    const authorization = authorizeAgentToolCapability({
      action: { type: 'sgp_fetch_contracts', payload: {} },
      intentResolution: { intent: 'support_request' },
      slotExtraction: {
        slots: { customer_identifier: 'customer-1' },
        details: [],
        invalidSlots: [],
      },
      enabledToolNames: ['sgp_fetch_contracts'],
      toolCatalog: listAgentToolCatalogItems(),
      enforceConfirmation: true,
    });

    expect(authorization).toMatchObject({
      allowed: true,
      code: 'allowed',
      contract: {
        name: 'sgp_fetch_contracts',
        idempotent: true,
        sideEffect: 'none',
      },
    });
  });

  it('evaluates forbidden tools and expected task status', () => {
    const result = evaluateAgentScenario({
      scenario: {
        id: 'wifi',
        name: 'Diagnostico',
        niche: 'isp',
        input: 'A internet caiu.',
        expectedGoal: 'troubleshooting',
        expectedTools: ['lookup_customer_connection'],
        forbiddenTools: ['router_reboot'],
        expectedTaskStatus: 'waiting_input',
      },
      observation: {
        goal: 'troubleshooting',
        tools: ['lookup_customer_connection'],
        taskStatus: 'waiting_input',
      },
    });

    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('compiles a visual autopilot config into a versionable domain pack', () => {
    const definition = compileAutopilotConfigToDomainPack({
      id: 'config-1',
      name: 'Loja Aurora',
      niche: 'e-commerce',
      enabledToolNames: ['lookup_order'],
      knowledgeBaseDocuments: [{ id: 'doc-1' }],
      flowGraph: { nodes: [{ id: 'start', type: 'start' }] },
    });

    expect(definition.toolNames).toEqual(['lookup_order']);
    expect(definition.knowledgeSourceIds).toEqual(['doc-1']);
    expect(definition.procedures?.[0]?.id).toBe('autopilot_flow');
    expect(definition.metadata).toMatchObject({
      compiler: 'autopilot_config_to_agent_domain_pack_v2',
      sourceConfigId: 'config-1',
    });
  });

  it('keeps structured memory conflicts explicit and chooses the strongest current value', () => {
    const merged = mergeAgentMemory([
      {
        id: 'older', workspaceId: 'w', contactId: 'c', layer: 'contact_fact', key: 'plan', value: 'basic',
        sourceType: 'conversation', confidence: 0.4, observedAt: '2026-08-01T00:00:00Z', status: 'active',
      },
      {
        id: 'newer', workspaceId: 'w', contactId: 'c', layer: 'contact_fact', key: 'plan', value: 'pro',
        sourceType: 'tool', confidence: 0.9, observedAt: '2026-08-10T00:00:00Z', status: 'active',
      },
    ]);

    expect(merged.entries[0]?.value).toBe('pro');
    expect(merged.conflicts[0]?.reason).toBe('different_values');
  });

  it('requires official tool evidence for operational claims', () => {
    const document = buildKnowledgeEvidence({
      id: 'doc-1',
      name: 'FAQ',
      content: 'O prazo e de cinco dias.',
      category: 'faq',
      status: 'active',
    });
    const blocked = validateAgentAnswerGrounding({
      claimType: 'operational',
      evidence: [document],
      requiredToolNames: ['lookup_order'],
    });
    const allowed = validateAgentAnswerGrounding({
      claimType: 'operational',
      evidence: [buildOperationalToolEvidence({ toolName: 'lookup_order', status: 'success' })],
      requiredToolNames: ['lookup_order'],
    });

    expect(blocked.allowed).toBe(false);
    expect(allowed.allowed).toBe(true);
  });

  it('summarizes trace stages, evidence, tools and policy blocks', () => {
    const summary = summarizeAgentTrace([
      { eventType: 'workflow_plan', durationMs: 12, payload: { evidence: [{ source: 'planner' }] } },
      { eventType: 'tool_planner', payload: { toolName: 'lookup_order', blockedTools: ['refund_order'] } },
    ]);

    expect(summary).toMatchObject({
      eventCount: 2,
      latencyMs: 12,
      toolNames: ['lookup_order'],
      blockedTools: ['refund_order'],
    });
    expect(summary.evidence).toHaveLength(1);
  });
});
