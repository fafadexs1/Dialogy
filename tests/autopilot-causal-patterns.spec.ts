import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/lib/db';
import {
  detectAndPersistCausalPatternsForWorkspace,
  detectCausalPatternsFromDecisions,
  type CausalDecisionSnapshot,
} from '@/services/autopilot/causal-patterns';
import type { AutopilotDecisionOutcome } from '@/services/autopilot/outcome-tracker';

vi.mock('@/lib/db', () => ({
  db: {
    query: vi.fn(),
  },
}));

function outcome(overrides: Partial<AutopilotDecisionOutcome> = {}): AutopilotDecisionOutcome {
  return {
    resolved: true,
    resolutionType: 'automated',
    turnsToResolve: 2,
    timeToResolutionSeconds: 120,
    customerAskedForHuman: false,
    customerSentimentFinal: 'neutral',
    toolsExecuted: [],
    toolsFailed: [],
    escalationNeeded: false,
    closedBy: 'agent',
    chatStatus: 'encerrados',
    stepOutcomes: [],
    ...overrides,
  };
}

describe('autopilot causal patterns', () => {
  beforeEach(() => {
    vi.mocked(db.query).mockReset();
  });

  it('detects confusing procedure steps from outcome step metrics', () => {
    const snapshots: CausalDecisionSnapshot[] = Array.from({ length: 5 }, (_, index) => ({
      decisionType: index % 2 === 0 ? 'ask_slot' : 'answer',
      goal: 'troubleshooting',
      procedureId: 'proc-wifi',
      stepId: 'collect-router-context',
      selectedTools: [],
      outcome: outcome({
        stepOutcomes: [{
          procedureId: 'proc-wifi',
          stepId: 'collect-router-context',
          turnsOnStep: 3,
          decisionCount: 1,
          customerConfused: index % 2 === 0,
          escalated: false,
        }],
      }),
    }));

    const patterns = detectCausalPatternsFromDecisions(snapshots, { minStepSamples: 5 });

    expect(patterns).toEqual([
      expect.objectContaining({
        patternType: 'confusing_step',
        procedureId: 'proc-wifi',
        stepId: 'collect-router-context',
      }),
    ]);
    expect(patterns[0].evidence).toMatchObject({
      sampleSize: 5,
      averageTurnsOnStep: 3,
    });
  });

  it('detects dead-end steps that escalate too often', () => {
    const snapshots: CausalDecisionSnapshot[] = Array.from({ length: 6 }, () => ({
      decisionType: 'handoff',
      goal: 'support_request',
      procedureId: 'proc-support',
      stepId: 'diagnose',
      selectedTools: ['transfer_chat'],
      outcome: outcome({
        resolved: false,
        resolutionType: 'human_handoff',
        escalationNeeded: true,
        toolsExecuted: ['transfer_chat'],
        stepOutcomes: [{
          procedureId: 'proc-support',
          stepId: 'diagnose',
          turnsOnStep: 1,
          decisionCount: 1,
          customerConfused: false,
          escalated: true,
        }],
      }),
    }));

    const patterns = detectCausalPatternsFromDecisions(snapshots, { minStepSamples: 5 });

    expect(patterns.some((pattern) => pattern.patternType === 'dead_end_step')).toBe(true);
  });

  it('detects tools with recurrent failures', () => {
    const snapshots: CausalDecisionSnapshot[] = [
      ...Array.from({ length: 4 }, () => ({
        decisionType: 'call_tool',
        goal: 'billing_or_payment',
        selectedTools: ['sgp_generate_invoice_pix'],
        outcome: outcome({
          toolsExecuted: [],
          toolsFailed: ['sgp_generate_invoice_pix'],
        }),
      })),
      ...Array.from({ length: 2 }, () => ({
        decisionType: 'call_tool',
        goal: 'billing_or_payment',
        selectedTools: ['sgp_generate_invoice_pix'],
        outcome: outcome({
          toolsExecuted: ['sgp_generate_invoice_pix'],
          toolsFailed: [],
        }),
      })),
    ];

    const patterns = detectCausalPatternsFromDecisions(snapshots, { minToolSamples: 5 });

    expect(patterns).toEqual([
      expect.objectContaining({
        patternType: 'tool_failure_hotspot',
        toolName: 'sgp_generate_invoice_pix',
      }),
    ]);
    expect(patterns[0].evidence).toMatchObject({
      sampleSize: 6,
      failedCount: 4,
    });
  });

  it('detects inferable slots that are repeatedly requested from customers', () => {
    const snapshots: CausalDecisionSnapshot[] = Array.from({ length: 5 }, () => ({
      decisionType: 'ask_slot',
      goal: 'support_request',
      requiredSlots: ['phone'],
      selectedTools: [],
      outcome: outcome({
        resolved: true,
        turnsToResolve: 3,
      }),
    }));

    const patterns = detectCausalPatternsFromDecisions(snapshots, {
      minStepSamples: 5,
      unnecessarySlotResolvedRateThreshold: 0.8,
    });

    expect(patterns).toEqual([
      expect.objectContaining({
        patternType: 'unnecessary_slot',
        stepId: 'slot:phone',
      }),
    ]);
    expect(patterns[0].suggestedFix).toMatchObject({
      action: 'prefer_contact_or_channel_value_before_asking_customer',
      slot: 'phone',
    });
  });

  it('detects confirmations that appear unnecessary from resolved outcomes', () => {
    const snapshots: CausalDecisionSnapshot[] = Array.from({ length: 5 }, () => ({
      decisionType: 'wait_confirmation',
      goal: 'troubleshooting',
      selectedTools: ['router_reboot'],
      outcome: outcome({
        resolved: true,
        resolutionType: 'automated',
        escalationNeeded: false,
      }),
    }));

    const patterns = detectCausalPatternsFromDecisions(snapshots, {
      minToolSamples: 5,
      unnecessaryConfirmationApprovalThreshold: 0.95,
    });

    expect(patterns).toEqual([
      expect.objectContaining({
        patternType: 'unnecessary_confirmation',
        toolName: 'router_reboot',
      }),
    ]);
    expect(patterns[0].suggestedFix).toMatchObject({
      action: 'consider_relaxing_confirmation_for_low_risk_or_read_only_contexts',
    });
  });

  it('detects score drift when blocked tools correlate with unresolved outcomes', () => {
    const snapshots: CausalDecisionSnapshot[] = [
      ...Array.from({ length: 4 }, () => ({
        decisionType: 'fallback',
        goal: 'billing_or_payment',
        selectedTools: [],
        blockedTools: [{
          toolName: 'sgp_generate_invoice_pix',
          reason: 'missing required slots',
          missingSlots: ['customer_identifier'],
        }],
        outcome: outcome({
          resolved: false,
          resolutionType: 'human_handoff',
          escalationNeeded: true,
        }),
      })),
      ...Array.from({ length: 2 }, () => ({
        decisionType: 'call_tool',
        goal: 'billing_or_payment',
        selectedTools: ['sgp_fetch_contact_panel_data'],
        blockedTools: [],
        outcome: outcome(),
      })),
    ];

    const patterns = detectCausalPatternsFromDecisions(snapshots, {
      minToolSamples: 5,
      scoreDriftBlockRateThreshold: 0.5,
      scoreDriftUnresolvedRateThreshold: 0.5,
    });

    expect(patterns).toEqual([
      expect.objectContaining({
        patternType: 'score_drift',
      }),
    ]);
    expect(patterns[0].suggestedFix).toMatchObject({
      action: 'increase_required_slots_and_policy_weights',
    });
    expect(patterns[0].evidence).toMatchObject({
      sampleSize: 6,
      blockedDecisionCount: 4,
      unresolvedCount: 4,
      missingSlotBlocks: 4,
      affectedTools: ['sgp_generate_invoice_pix'],
    });
  });

  it('detects switch nodes with recurrent fallback decisions', () => {
    const snapshots: CausalDecisionSnapshot[] = Array.from({ length: 6 }, (_, index) => ({
      decisionType: index % 2 === 0 ? 'fallback' : 'answer',
      goal: 'troubleshooting',
      selectedTools: [],
      switchResolution: {
        switchNodeId: 'switch-wifi',
        routeId: index < 4 ? 'outro' : 'lentidao_wifi',
        routeLabel: index < 4 ? 'Outro' : 'Lentidao Wi-Fi',
        confidence: index < 4 ? 0.42 : 0.82,
        fallbackUsed: index < 4,
        evidence: ['Mensagem sem cobertura suficiente.'],
      },
      outcome: outcome(),
    }));

    const patterns = detectCausalPatternsFromDecisions(snapshots, {
      minSwitchSamples: 5,
      switchFallbackRateThreshold: 0.5,
    });

    expect(patterns).toEqual([
      expect.objectContaining({
        patternType: 'switch_fallback_hotspot',
        stepId: 'switch-wifi',
        switchNodeId: 'switch-wifi',
      }),
    ]);
    expect(patterns[0].evidence).toMatchObject({
      switchNodeId: 'switch-wifi',
      sampleSize: 6,
      fallbackCount: 4,
    });
  });

  it('detects switch routes with low average confidence', () => {
    const snapshots: CausalDecisionSnapshot[] = Array.from({ length: 5 }, () => ({
      decisionType: 'answer',
      goal: 'troubleshooting',
      selectedTools: [],
      switchResolution: {
        switchNodeId: 'switch-wifi',
        routeId: 'lentidao_wifi',
        routeLabel: 'Lentidao Wi-Fi',
        targetNodeId: 'diagnosticar-lentidao',
        confidence: 0.52,
        fallbackUsed: false,
        evidence: ['Termos parecidos com lentidao.'],
      },
      outcome: outcome(),
    }));

    const patterns = detectCausalPatternsFromDecisions(snapshots, {
      minSwitchSamples: 5,
      switchLowConfidenceThreshold: 0.65,
    });

    expect(patterns).toEqual([
      expect.objectContaining({
        patternType: 'switch_route_low_confidence',
        switchNodeId: 'switch-wifi',
        switchRouteId: 'lentidao_wifi',
      }),
    ]);
    expect(patterns[0].suggestedFix).toMatchObject({
      action: 'rewrite_route_description_and_examples',
      routeId: 'lentidao_wifi',
    });
  });

  it('persists detected patterns with a stable fingerprint', async () => {
    const storedOutcome = outcome({
      toolsFailed: ['sgp_generate_invoice_pix'],
      toolsExecuted: [],
    });
    vi.mocked(db.query)
      .mockResolvedValueOnce({
        rows: Array.from({ length: 5 }, () => ({
          decision_type: 'call_tool',
          goal: 'billing_or_payment',
          procedure_id: null,
          step_id: null,
          selected_tools_json: ['sgp_generate_invoice_pix'],
          metadata: {},
          outcome_json: storedOutcome,
        })),
      } as any)
      .mockResolvedValue({ rows: [] } as any);

    const patterns = await detectAndPersistCausalPatternsForWorkspace({
      workspaceId: 'workspace-1',
      agentId: 'agent-1',
      options: { minToolSamples: 5 },
    });

    expect(patterns).toHaveLength(1);
    const insertCall = vi.mocked(db.query).mock.calls.find(([query]) => (
      String(query).includes('INSERT INTO agent_causal_patterns')
    ));
    expect(insertCall).toBeTruthy();
    expect(insertCall?.[1]).toEqual(expect.arrayContaining([
      'workspace-1',
      'agent-1',
      patterns[0].fingerprint,
      'tool_failure_hotspot',
      'sgp_generate_invoice_pix',
    ]));
  });

  it('persists score drift patterns from blocked tool ledger data', async () => {
    const blockedOutcome = outcome({
      resolved: false,
      resolutionType: 'human_handoff',
      escalationNeeded: true,
    });
    vi.mocked(db.query)
      .mockResolvedValueOnce({
        rows: [
          ...Array.from({ length: 4 }, () => ({
            decision_type: 'fallback',
            goal: 'billing_or_payment',
            procedure_id: null,
            step_id: null,
            selected_tools_json: [],
            blocked_tools_json: [{
              toolName: 'sgp_generate_invoice_pix',
              reason: 'missing required slots',
              missingSlots: ['customer_identifier'],
            }],
            metadata: {},
            outcome_json: blockedOutcome,
          })),
          ...Array.from({ length: 2 }, () => ({
            decision_type: 'call_tool',
            goal: 'billing_or_payment',
            procedure_id: null,
            step_id: null,
            selected_tools_json: ['sgp_fetch_contact_panel_data'],
            blocked_tools_json: [],
            metadata: {},
            outcome_json: outcome(),
          })),
        ],
      } as any)
      .mockResolvedValue({ rows: [] } as any);

    const patterns = await detectAndPersistCausalPatternsForWorkspace({
      workspaceId: 'workspace-1',
      options: {
        minToolSamples: 5,
        scoreDriftBlockRateThreshold: 0.5,
        scoreDriftUnresolvedRateThreshold: 0.5,
      },
    });

    expect(patterns.some((pattern) => pattern.patternType === 'score_drift')).toBe(true);
    const insertCalls = vi.mocked(db.query).mock.calls.filter(([query]) => (
      String(query).includes('INSERT INTO agent_causal_patterns')
    ));
    expect(insertCalls.some((call) => JSON.stringify(call[1] || []).includes('score_drift'))).toBe(true);
  });

  it('persists unnecessary slot patterns from missing slot ledger data', async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce({
        rows: Array.from({ length: 5 }, () => ({
          decision_type: 'ask_slot',
          goal: 'support_request',
          procedure_id: null,
          step_id: null,
          selected_tools_json: [],
          missing_slots_json: ['email'],
          blocked_tools_json: [],
          metadata: {},
          outcome_json: outcome({
            resolved: true,
            turnsToResolve: 3,
          }),
        })),
      } as any)
      .mockResolvedValue({ rows: [] } as any);

    const patterns = await detectAndPersistCausalPatternsForWorkspace({
      workspaceId: 'workspace-1',
      options: {
        minStepSamples: 5,
        unnecessarySlotResolvedRateThreshold: 0.8,
      },
    });

    expect(patterns.some((pattern) => pattern.patternType === 'unnecessary_slot')).toBe(true);
    const insertCalls = vi.mocked(db.query).mock.calls.filter(([query]) => (
      String(query).includes('INSERT INTO agent_causal_patterns')
    ));
    expect(insertCalls.some((call) => JSON.stringify(call[1] || []).includes('unnecessary_slot'))).toBe(true);
  });

  it('persists switch pattern scope from decision metadata', async () => {
    const storedOutcome = outcome();
    vi.mocked(db.query)
      .mockResolvedValueOnce({
        rows: Array.from({ length: 5 }, () => ({
          decision_type: 'fallback',
          goal: 'troubleshooting',
          procedure_id: null,
          step_id: null,
          selected_tools_json: [],
          metadata: {
            switchResolution: {
              switchNodeId: 'switch-wifi',
              routeId: 'outro',
              routeLabel: 'Outro',
              confidence: 0.4,
              fallbackUsed: true,
            },
          },
          outcome_json: storedOutcome,
        })),
      } as any)
      .mockResolvedValue({ rows: [] } as any);

    const patterns = await detectAndPersistCausalPatternsForWorkspace({
      workspaceId: 'workspace-1',
      options: {
        minSwitchSamples: 5,
        switchFallbackRateThreshold: 0.5,
      },
    });

    expect(patterns).toHaveLength(1);
    expect(patterns[0]).toMatchObject({
      patternType: 'switch_fallback_hotspot',
      switchNodeId: 'switch-wifi',
    });
    const insertCall = vi.mocked(db.query).mock.calls.find(([query]) => (
      String(query).includes('INSERT INTO agent_causal_patterns')
    ));
    expect(insertCall?.[1]).toEqual(expect.arrayContaining([
      'workspace-1',
      patterns[0].fingerprint,
      'switch_fallback_hotspot',
      'switch-wifi',
    ]));
  });
});
