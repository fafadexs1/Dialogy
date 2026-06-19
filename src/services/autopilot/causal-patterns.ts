import { createHash } from 'crypto';
import { db } from '@/lib/db';
import type { AutopilotDecisionOutcome } from './outcome-tracker';

export type AgentCausalPatternType =
  | 'unnecessary_confirmation'
  | 'confusing_step'
  | 'unnecessary_slot'
  | 'dead_end_step'
  | 'tool_failure_hotspot'
  | 'score_drift'
  | 'switch_fallback_hotspot'
  | 'switch_route_low_confidence';

export type AgentCausalPattern = {
  fingerprint: string;
  patternType: AgentCausalPatternType;
  procedureId?: string | null;
  stepId?: string | null;
  switchNodeId?: string | null;
  switchRouteId?: string | null;
  toolName?: string | null;
  insight: string;
  evidence: Record<string, unknown>;
  suggestedFix: Record<string, unknown>;
  impact: Record<string, unknown>;
  confidence: number;
  scope: 'local' | 'ecosystem';
  vertical?: string | null;
};

export type CausalDecisionSnapshot = {
  decisionType: string;
  goal?: string | null;
  procedureId?: string | null;
  stepId?: string | null;
  selectedTools?: string[];
  requiredSlots?: string[];
  blockedTools?: Array<{
    toolName: string;
    reason?: string | null;
    missingSlots?: string[];
  }>;
  switchResolution?: {
    switchNodeId: string;
    routeId: string;
    routeLabel?: string | null;
    targetNodeId?: string | null;
    confidence: number;
    fallbackUsed: boolean;
    evidence?: string[];
  } | null;
  outcome: AutopilotDecisionOutcome;
};

export type DetectCausalPatternsOptions = {
  minStepSamples?: number;
  minToolSamples?: number;
  minSwitchSamples?: number;
  unnecessaryConfirmationApprovalThreshold?: number;
  unnecessarySlotResolvedRateThreshold?: number;
  confusingStepTurnThreshold?: number;
  confusingStepRateThreshold?: number;
  escalationRateThreshold?: number;
  toolFailureRateThreshold?: number;
  scoreDriftBlockRateThreshold?: number;
  scoreDriftUnresolvedRateThreshold?: number;
  switchFallbackRateThreshold?: number;
  switchLowConfidenceThreshold?: number;
};

const DEFAULT_OPTIONS: Required<DetectCausalPatternsOptions> = {
  minStepSamples: 5,
  minToolSamples: 5,
  minSwitchSamples: 5,
  unnecessaryConfirmationApprovalThreshold: 0.95,
  unnecessarySlotResolvedRateThreshold: 0.8,
  confusingStepTurnThreshold: 2,
  confusingStepRateThreshold: 0.4,
  escalationRateThreshold: 0.35,
  toolFailureRateThreshold: 0.35,
  scoreDriftBlockRateThreshold: 0.35,
  scoreDriftUnresolvedRateThreshold: 0.35,
  switchFallbackRateThreshold: 0.35,
  switchLowConfidenceThreshold: 0.65,
};

function hashPattern(value: Record<string, unknown>) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function round(value: number) {
  return Number(value.toFixed(3));
}

function clampConfidence(value: number) {
  return round(Math.min(0.99, Math.max(0.01, value)));
}

function patternFingerprint(input: {
  patternType: AgentCausalPatternType;
  procedureId?: string | null;
  stepId?: string | null;
  switchNodeId?: string | null;
  switchRouteId?: string | null;
  toolName?: string | null;
}) {
  return hashPattern({
    type: input.patternType,
    procedureId: input.procedureId || null,
    stepId: input.stepId || null,
    switchNodeId: input.switchNodeId || null,
    switchRouteId: input.switchRouteId || null,
    toolName: input.toolName || null,
  });
}

function pushPattern(patterns: AgentCausalPattern[], pattern: Omit<AgentCausalPattern, 'fingerprint' | 'scope'>) {
  patterns.push({
    ...pattern,
    fingerprint: patternFingerprint(pattern),
    scope: 'local',
  });
}

function detectStepPatterns(
  snapshots: CausalDecisionSnapshot[],
  patterns: AgentCausalPattern[],
  options: Required<DetectCausalPatternsOptions>,
) {
  const grouped = new Map<string, CausalDecisionSnapshot[]>();
  for (const snapshot of snapshots) {
    if (!snapshot.stepId) continue;
    const key = `${snapshot.procedureId || 'none'}:${snapshot.stepId}`;
    grouped.set(key, [...(grouped.get(key) || []), snapshot]);
  }

  for (const items of grouped.values()) {
    if (items.length < options.minStepSamples) continue;
    const first = items[0];
    const stepOutcomes = items.flatMap((item) => item.outcome.stepOutcomes || [])
      .filter((step) => step.stepId === first.stepId && (step.procedureId || null) === (first.procedureId || null));
    const avgTurns = stepOutcomes.length > 0
      ? stepOutcomes.reduce((sum, step) => sum + step.turnsOnStep, 0) / stepOutcomes.length
      : 0;
    const confusedCount = stepOutcomes.filter((step) => step.customerConfused).length
      || items.filter((item) => item.decisionType === 'fallback' || item.decisionType === 'ask_slot').length;
    const confusionRate = confusedCount / items.length;
    const escalatedCount = items.filter((item) => item.outcome.escalationNeeded).length;
    const escalationRate = escalatedCount / items.length;

    if (avgTurns >= options.confusingStepTurnThreshold || confusionRate >= options.confusingStepRateThreshold) {
      pushPattern(patterns, {
        patternType: 'confusing_step',
        procedureId: first.procedureId || null,
        stepId: first.stepId || null,
        insight: `A etapa ${first.stepId} parece confusa: media de ${round(avgTurns)} turno(s) e taxa de confusao de ${round(confusionRate * 100)}%.`,
        evidence: {
          sampleSize: items.length,
          averageTurnsOnStep: round(avgTurns),
          confusionRate: round(confusionRate),
          confusedCount,
        },
        suggestedFix: {
          type: 'review_step_instruction',
          action: 'clarify_prompt_or_split_step',
          reason: 'Etapas com muitos turnos ou muitas perguntas/fallbacks tendem a travar o atendimento.',
        },
        impact: {
          affectedConversations: items.length,
          estimatedExtraTurns: Math.max(0, round((avgTurns - 1) * items.length)),
        },
        confidence: clampConfidence(0.55 + Math.max(confusionRate, Math.min(0.4, avgTurns / 10))),
      });
    }

    if (escalationRate >= options.escalationRateThreshold) {
      pushPattern(patterns, {
        patternType: 'dead_end_step',
        procedureId: first.procedureId || null,
        stepId: first.stepId || null,
        insight: `A etapa ${first.stepId} esta levando a escalacao em ${round(escalationRate * 100)}% dos casos.`,
        evidence: {
          sampleSize: items.length,
          escalationRate: round(escalationRate),
          escalatedCount,
        },
        suggestedFix: {
          type: 'add_safe_branch_or_fallback',
          action: 'add_clarification_or_handoff_condition',
          reason: 'A etapa parece virar beco sem saida antes de resolver automaticamente.',
        },
        impact: {
          affectedConversations: items.length,
          escalatedConversations: escalatedCount,
        },
        confidence: clampConfidence(0.5 + escalationRate),
      });
    }
  }
}

function detectUnnecessarySlotPatterns(
  snapshots: CausalDecisionSnapshot[],
  patterns: AgentCausalPattern[],
  options: Required<DetectCausalPatternsOptions>,
) {
  const inferableSlots = new Set(['phone', 'email', 'name']);
  const slotStats = new Map<string, CausalDecisionSnapshot[]>();
  for (const snapshot of snapshots) {
    if (snapshot.decisionType !== 'ask_slot') continue;
    for (const slot of snapshot.requiredSlots || []) {
      if (!inferableSlots.has(slot)) continue;
      slotStats.set(slot, [...(slotStats.get(slot) || []), snapshot]);
    }
  }

  for (const [slot, items] of slotStats.entries()) {
    if (items.length < options.minStepSamples) continue;
    const resolvedItems = items.filter((item) => item.outcome.resolved);
    const resolvedRate = resolvedItems.length / items.length;
    if (resolvedRate < options.unnecessarySlotResolvedRateThreshold) continue;

    const averageTurns = items.reduce((sum, item) => sum + item.outcome.turnsToResolve, 0) / items.length;
    pushPattern(patterns, {
      patternType: 'unnecessary_slot',
      stepId: `slot:${slot}`,
      insight: `O slot ${slot} foi solicitado ${items.length} vez(es), mas costuma ser inferivel do contato/canal e resolveu em ${round(resolvedRate * 100)}% dos casos.`,
      evidence: {
        slot,
        sampleSize: items.length,
        resolvedCount: resolvedItems.length,
        resolvedRate: round(resolvedRate),
        averageTurnsToResolve: round(averageTurns),
      },
      suggestedFix: {
        type: 'auto_fill_slot_from_context',
        action: 'prefer_contact_or_channel_value_before_asking_customer',
        slot,
        reason: 'Slots como telefone, email e nome frequentemente ja existem no contato ou no canal; pedir de novo adiciona turnos desnecessarios.',
      },
      impact: {
        affectedConversations: items.length,
        estimatedAvoidableTurns: items.length,
      },
      confidence: clampConfidence(0.5 + resolvedRate * 0.4),
    });
  }
}

function detectToolPatterns(
  snapshots: CausalDecisionSnapshot[],
  patterns: AgentCausalPattern[],
  options: Required<DetectCausalPatternsOptions>,
) {
  const toolStats = new Map<string, { total: number; failed: number; goals: Set<string> }>();
  for (const snapshot of snapshots) {
    const executed = new Set([
      ...(snapshot.outcome.toolsExecuted || []),
      ...(snapshot.outcome.toolsFailed || []),
    ]);
    for (const toolName of executed) {
      const current = toolStats.get(toolName) || { total: 0, failed: 0, goals: new Set<string>() };
      current.total += 1;
      if (snapshot.outcome.toolsFailed.includes(toolName)) current.failed += 1;
      if (snapshot.goal) current.goals.add(snapshot.goal);
      toolStats.set(toolName, current);
    }
  }

  for (const [toolName, stats] of toolStats.entries()) {
    if (stats.total < options.minToolSamples) continue;
    const failureRate = stats.failed / stats.total;
    if (failureRate < options.toolFailureRateThreshold) continue;
    pushPattern(patterns, {
      patternType: 'tool_failure_hotspot',
      toolName,
      insight: `A ferramenta ${toolName} falhou em ${round(failureRate * 100)}% das execucoes analisadas.`,
      evidence: {
        sampleSize: stats.total,
        failedCount: stats.failed,
        failureRate: round(failureRate),
        goals: Array.from(stats.goals),
      },
      suggestedFix: {
        type: 'review_tool_policy_or_payload_mapping',
        action: 'inspect_required_slots_schema_and_integration_errors',
        reason: 'Falhas recorrentes de ferramenta costumam vir de slots ausentes, payload invalido ou indisponibilidade da integracao.',
      },
      impact: {
        affectedToolExecutions: stats.total,
        failedToolExecutions: stats.failed,
      },
      confidence: clampConfidence(0.5 + failureRate),
    });
  }
}

function detectUnnecessaryConfirmationPatterns(
  snapshots: CausalDecisionSnapshot[],
  patterns: AgentCausalPattern[],
  options: Required<DetectCausalPatternsOptions>,
) {
  const confirmationSnapshots = snapshots.filter((snapshot) => snapshot.decisionType === 'wait_confirmation');
  const byTool = new Map<string, CausalDecisionSnapshot[]>();
  for (const snapshot of confirmationSnapshots) {
    const tools = snapshot.selectedTools?.length ? snapshot.selectedTools : ['unknown_tool'];
    for (const toolName of tools) {
      byTool.set(toolName, [...(byTool.get(toolName) || []), snapshot]);
    }
  }

  for (const [toolName, items] of byTool.entries()) {
    if (items.length < options.minToolSamples) continue;
    const approvedOrResolved = items.filter((item) => (
      item.outcome.resolved &&
      !item.outcome.escalationNeeded &&
      item.outcome.resolutionType !== 'human_handoff'
    ));
    const approvalRate = approvedOrResolved.length / items.length;
    if (approvalRate < options.unnecessaryConfirmationApprovalThreshold) continue;

    pushPattern(patterns, {
      patternType: 'unnecessary_confirmation',
      toolName,
      insight: `A confirmacao antes de ${toolName} foi seguida de resolucao automatica em ${round(approvalRate * 100)}% dos casos analisados.`,
      evidence: {
        sampleSize: items.length,
        approvedOrResolvedCount: approvedOrResolved.length,
        approvalRate: round(approvalRate),
      },
      suggestedFix: {
        type: 'review_confirmation_policy',
        action: 'consider_relaxing_confirmation_for_low_risk_or_read_only_contexts',
        toolName,
        reason: 'Confirmacoes sempre aceitas podem adicionar atrito; qualquer relaxamento ainda precisa respeitar risco, side effects e politica da ferramenta.',
      },
      impact: {
        affectedConversations: items.length,
        estimatedAvoidableTurns: items.length,
      },
      confidence: clampConfidence(0.45 + approvalRate * 0.45),
    });
  }
}

function detectScoreDriftPatterns(
  snapshots: CausalDecisionSnapshot[],
  patterns: AgentCausalPattern[],
  options: Required<DetectCausalPatternsOptions>,
) {
  const operationalSnapshots = snapshots.filter((snapshot) => (
    (snapshot.blockedTools?.length || 0) > 0 ||
    (snapshot.selectedTools?.length || 0) > 0 ||
    snapshot.decisionType === 'fallback' ||
    snapshot.decisionType === 'ask_slot'
  ));
  if (operationalSnapshots.length < options.minToolSamples) return;

  const blockedSnapshots = operationalSnapshots.filter((snapshot) => (snapshot.blockedTools?.length || 0) > 0);
  const blockedToolDecisions = blockedSnapshots.reduce((sum, snapshot) => sum + (snapshot.blockedTools?.length || 0), 0);
  const blockRate = blockedSnapshots.length / operationalSnapshots.length;
  const unresolvedItems = operationalSnapshots.filter((snapshot) => (
    !snapshot.outcome.resolved ||
    snapshot.outcome.escalationNeeded ||
    snapshot.outcome.resolutionType === 'human_handoff' ||
    snapshot.outcome.resolutionType === 'timeout'
  ));
  const unresolvedRate = unresolvedItems.length / operationalSnapshots.length;
  const fallbackItems = operationalSnapshots.filter((snapshot) => snapshot.decisionType === 'fallback');
  const askSlotItems = operationalSnapshots.filter((snapshot) => snapshot.decisionType === 'ask_slot');

  if (
    blockRate < options.scoreDriftBlockRateThreshold ||
    unresolvedRate < options.scoreDriftUnresolvedRateThreshold
  ) {
    return;
  }

  const missingSlotBlocks = blockedSnapshots.reduce((sum, snapshot) => (
    sum + (snapshot.blockedTools || []).filter((tool) => (tool.missingSlots || []).length > 0).length
  ), 0);
  const policyBlocks = blockedSnapshots.reduce((sum, snapshot) => (
    sum + (snapshot.blockedTools || []).filter((tool) => {
      const reason = String(tool.reason || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
      return /\b(policy|politica|forbidden|proibid|approval|aprovacao|disabled|desabilitad|intent|intencao)\b/.test(reason);
    }).length
  ), 0);
  const affectedTools = Array.from(new Set(
    blockedSnapshots.flatMap((snapshot) => (snapshot.blockedTools || []).map((tool) => tool.toolName))
  )).slice(0, 8);

  pushPattern(patterns, {
    patternType: 'score_drift',
    insight: `O Tool Selection Score parece permissivo/ruidoso: ${round(blockRate * 100)}% das decisoes operacionais tiveram tools bloqueadas e ${round(unresolvedRate * 100)}% nao resolveram automaticamente.`,
    evidence: {
      sampleSize: operationalSnapshots.length,
      blockedDecisionCount: blockedSnapshots.length,
      blockedToolDecisions,
      blockRate: round(blockRate),
      unresolvedCount: unresolvedItems.length,
      unresolvedRate: round(unresolvedRate),
      fallbackCount: fallbackItems.length,
      askSlotCount: askSlotItems.length,
      missingSlotBlocks,
      policyBlocks,
      affectedTools,
    },
    suggestedFix: {
      type: 'adjust_tool_selection_score',
      action: 'increase_required_slots_and_policy_weights',
      reason: 'Bloqueios recorrentes combinados com baixa resolucao indicam que o score deve valorizar mais slots obrigatorios e politica antes de tentar ferramenta.',
    },
    impact: {
      affectedConversations: operationalSnapshots.length,
      blockedToolDecisions,
      unresolvedConversations: unresolvedItems.length,
    },
    confidence: clampConfidence(0.45 + Math.max(blockRate, unresolvedRate)),
  });
}

function routeLooksLikeIntentionalHandoff(routeLabel: string | null | undefined, routeId: string | null | undefined) {
  const text = `${routeLabel || ''} ${routeId || ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return /\b(humano|atendente|pessoa|handoff|transfer|escal)\w*/.test(text);
}

function detectSwitchPatterns(
  snapshots: CausalDecisionSnapshot[],
  patterns: AgentCausalPattern[],
  options: Required<DetectCausalPatternsOptions>,
) {
  const switchSnapshots = snapshots.filter((snapshot) => snapshot.switchResolution?.switchNodeId);
  const bySwitch = new Map<string, CausalDecisionSnapshot[]>();
  const byRoute = new Map<string, CausalDecisionSnapshot[]>();

  for (const snapshot of switchSnapshots) {
    const resolution = snapshot.switchResolution;
    if (!resolution) continue;
    bySwitch.set(resolution.switchNodeId, [...(bySwitch.get(resolution.switchNodeId) || []), snapshot]);
    byRoute.set(`${resolution.switchNodeId}:${resolution.routeId}`, [
      ...(byRoute.get(`${resolution.switchNodeId}:${resolution.routeId}`) || []),
      snapshot,
    ]);
  }

  for (const [switchNodeId, items] of bySwitch.entries()) {
    if (items.length < options.minSwitchSamples) continue;
    const fallbackItems = items.filter((item) => item.switchResolution?.fallbackUsed);
    const fallbackRate = fallbackItems.length / items.length;
    if (fallbackRate >= options.switchFallbackRateThreshold) {
      const routeCounts = new Map<string, number>();
      for (const item of fallbackItems) {
        const routeId = item.switchResolution?.routeId || 'fallback';
        routeCounts.set(routeId, (routeCounts.get(routeId) || 0) + 1);
      }
      const fallbackRoutes = Array.from(routeCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([routeId, count]) => ({ routeId, count }));

      pushPattern(patterns, {
        patternType: 'switch_fallback_hotspot',
        stepId: switchNodeId,
        switchNodeId,
        insight: `O Switch ${switchNodeId} esta caindo em fallback em ${round(fallbackRate * 100)}% das decisoes analisadas.`,
        evidence: {
          switchNodeId,
          sampleSize: items.length,
          fallbackCount: fallbackItems.length,
          fallbackRate: round(fallbackRate),
          fallbackRoutes,
        },
        suggestedFix: {
          type: 'improve_switch_routes',
          action: 'add_route_or_examples_for_recurring_fallbacks',
          switchNodeId,
          reason: 'Fallback recorrente indica que mensagens reais nao estao cobertas pelas rotas configuradas ou pelos exemplos do Switch.',
        },
        impact: {
          affectedConversations: fallbackItems.length,
          totalSwitchDecisions: items.length,
        },
        confidence: clampConfidence(0.5 + fallbackRate),
      });
    }
  }

  for (const items of byRoute.values()) {
    if (items.length < options.minSwitchSamples) continue;
    const firstResolution = items[0].switchResolution;
    if (!firstResolution) continue;
    if (firstResolution.fallbackUsed) continue;

    const averageConfidence = items.reduce((sum, item) => (
      sum + (item.switchResolution?.confidence ?? 0)
    ), 0) / items.length;
    const handoffRate = items.filter((item) => (
      item.outcome.escalationNeeded || item.outcome.resolutionType === 'human_handoff'
    )).length / items.length;
    const lowConfidence = averageConfidence < options.switchLowConfidenceThreshold;
    const unexpectedHandoff = handoffRate >= options.escalationRateThreshold
      && !routeLooksLikeIntentionalHandoff(firstResolution.routeLabel, firstResolution.routeId);

    if (!lowConfidence && !unexpectedHandoff) continue;

    pushPattern(patterns, {
      patternType: 'switch_route_low_confidence',
      stepId: firstResolution.switchNodeId,
      switchNodeId: firstResolution.switchNodeId,
      switchRouteId: firstResolution.routeId,
      insight: lowConfidence
        ? `A rota ${firstResolution.routeId} do Switch ${firstResolution.switchNodeId} esta com confianca media de ${round(averageConfidence * 100)}%.`
        : `A rota ${firstResolution.routeId} do Switch ${firstResolution.switchNodeId} esta levando a humano em ${round(handoffRate * 100)}% dos casos.`,
      evidence: {
        switchNodeId: firstResolution.switchNodeId,
        routeId: firstResolution.routeId,
        routeLabel: firstResolution.routeLabel || null,
        sampleSize: items.length,
        averageConfidence: round(averageConfidence),
        handoffRate: round(handoffRate),
      },
      suggestedFix: {
        type: 'improve_switch_route',
        action: lowConfidence ? 'rewrite_route_description_and_examples' : 'review_route_target_or_add_clarifying_step',
        switchNodeId: firstResolution.switchNodeId,
        routeId: firstResolution.routeId,
        reason: lowConfidence
          ? 'Baixa confianca sugere exemplos insuficientes, descricao ambigua ou sobreposicao com outra rota.'
          : 'Transferencia recorrente sugere que a rota nao resolve sozinha ou precisa de uma etapa de esclarecimento antes do destino atual.',
      },
      impact: {
        affectedConversations: items.length,
        estimatedHumanHandoffs: round(handoffRate * items.length),
      },
      confidence: clampConfidence(0.45 + Math.max(1 - averageConfidence, handoffRate)),
    });
  }
}

export function detectCausalPatternsFromDecisions(
  snapshots: CausalDecisionSnapshot[],
  options: DetectCausalPatternsOptions = {},
): AgentCausalPattern[] {
  const resolvedOptions = { ...DEFAULT_OPTIONS, ...options };
  const patterns: AgentCausalPattern[] = [];
  detectUnnecessarySlotPatterns(snapshots, patterns, resolvedOptions);
  detectStepPatterns(snapshots, patterns, resolvedOptions);
  detectToolPatterns(snapshots, patterns, resolvedOptions);
  detectUnnecessaryConfirmationPatterns(snapshots, patterns, resolvedOptions);
  detectScoreDriftPatterns(snapshots, patterns, resolvedOptions);
  detectSwitchPatterns(snapshots, patterns, resolvedOptions);

  const deduped = new Map<string, AgentCausalPattern>();
  for (const pattern of patterns) {
    const current = deduped.get(pattern.fingerprint);
    if (!current || pattern.confidence > current.confidence) {
      deduped.set(pattern.fingerprint, pattern);
    }
  }
  return Array.from(deduped.values()).sort((a, b) => b.confidence - a.confidence);
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      return parseJsonRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value === 'string') {
    try {
      return parseStringArray(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return [];
}

function parseBlockedTools(value: unknown): CausalDecisionSnapshot['blockedTools'] {
  const parsed = typeof value === 'string'
    ? (() => {
      try {
        return JSON.parse(value);
      } catch {
        return [];
      }
    })()
    : value;
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item): NonNullable<CausalDecisionSnapshot['blockedTools']>[number] | null => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const toolName = typeof record.toolName === 'string'
        ? record.toolName
        : typeof record.tool === 'string'
          ? record.tool
          : '';
      if (!toolName.trim()) return null;
      return {
        toolName: toolName.trim(),
        reason: typeof record.reason === 'string' ? record.reason : null,
        missingSlots: parseStringArray(record.missingSlots),
      };
    })
    .filter((item): item is NonNullable<CausalDecisionSnapshot['blockedTools']>[number] => item !== null);
}

function isOutcome(value: Record<string, unknown>): value is AutopilotDecisionOutcome {
  return typeof value.resolutionType === 'string'
    && Array.isArray(value.toolsExecuted)
    && Array.isArray(value.toolsFailed)
    && Array.isArray(value.stepOutcomes);
}

function parseSwitchResolution(value: unknown): CausalDecisionSnapshot['switchResolution'] {
  const metadata = parseJsonRecord(value);
  const raw = parseJsonRecord(metadata.switchResolution);
  const switchNodeId = typeof raw.switchNodeId === 'string' ? raw.switchNodeId.trim() : '';
  const routeId = typeof raw.routeId === 'string' ? raw.routeId.trim() : '';
  if (!switchNodeId || !routeId) return null;

  const confidence = Number(raw.confidence);
  return {
    switchNodeId,
    routeId,
    routeLabel: typeof raw.routeLabel === 'string' ? raw.routeLabel : null,
    targetNodeId: typeof raw.targetNodeId === 'string' ? raw.targetNodeId : null,
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0,
    fallbackUsed: Boolean(raw.fallbackUsed),
    evidence: parseStringArray(raw.evidence),
  };
}

function shouldSuppressPatternError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('agent_causal_patterns') || message.includes('agent_decision_ledger');
}

export async function detectAndPersistCausalPatternsForWorkspace(input: {
  workspaceId: string;
  agentId?: string | null;
  vertical?: string | null;
  sinceDays?: number;
  options?: DetectCausalPatternsOptions;
}): Promise<AgentCausalPattern[]> {
  const sinceDays = Math.max(1, Math.min(365, Math.round(input.sinceDays || 30)));
  try {
    const { rows } = await db.query(
      `SELECT decision_type, goal, procedure_id, step_id, selected_tools_json,
              missing_slots_json,
              blocked_tools_json, metadata, outcome_json
       FROM agent_decision_ledger
       WHERE workspace_id = $1
         AND outcome_json IS NOT NULL
         AND created_at >= clock_timestamp() - ($2::int * interval '1 day')
       ORDER BY created_at ASC`,
      [input.workspaceId, sinceDays],
    );

    const snapshots: CausalDecisionSnapshot[] = rows
      .map((row): CausalDecisionSnapshot | null => {
        const outcome = parseJsonRecord(row.outcome_json);
        if (!isOutcome(outcome)) return null;
        return {
          decisionType: String(row.decision_type || ''),
          goal: row.goal || null,
          procedureId: row.procedure_id || null,
          stepId: row.step_id || null,
          selectedTools: parseStringArray(row.selected_tools_json),
          requiredSlots: parseStringArray(row.missing_slots_json),
          blockedTools: parseBlockedTools(row.blocked_tools_json),
          switchResolution: parseSwitchResolution(row.metadata),
          outcome,
        };
      })
      .filter((snapshot): snapshot is CausalDecisionSnapshot => snapshot !== null);

    const patterns = detectCausalPatternsFromDecisions(snapshots, input.options);
    for (const pattern of patterns) {
      await db.query(
        `INSERT INTO agent_causal_patterns (
          workspace_id,
          agent_id,
          fingerprint,
          pattern_type,
          procedure_id,
          step_id,
          switch_node_id,
          switch_route_id,
          tool_name,
          insight,
          evidence_json,
          suggested_fix_json,
          impact_json,
          confidence,
          scope,
          vertical,
          status
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11::jsonb, $12::jsonb, $13::jsonb, $14, $15, $16, 'pending'
        )
        ON CONFLICT (workspace_id, fingerprint) DO UPDATE SET
          insight = EXCLUDED.insight,
          evidence_json = EXCLUDED.evidence_json,
          suggested_fix_json = EXCLUDED.suggested_fix_json,
          impact_json = EXCLUDED.impact_json,
          confidence = EXCLUDED.confidence,
          switch_node_id = EXCLUDED.switch_node_id,
          switch_route_id = EXCLUDED.switch_route_id,
          vertical = EXCLUDED.vertical,
          status = CASE
            WHEN agent_causal_patterns.status IN ('applied', 'dismissed') THEN agent_causal_patterns.status
            ELSE 'pending'
          END`,
        [
          input.workspaceId,
          input.agentId || null,
          pattern.fingerprint,
          pattern.patternType,
          pattern.procedureId || null,
          pattern.stepId || null,
          pattern.switchNodeId || null,
          pattern.switchRouteId || null,
          pattern.toolName || null,
          pattern.insight,
          JSON.stringify(pattern.evidence),
          JSON.stringify(pattern.suggestedFix),
          JSON.stringify(pattern.impact),
          pattern.confidence,
          pattern.scope,
          input.vertical || pattern.vertical || null,
        ],
      );
    }
    return patterns;
  } catch (error) {
    if (!shouldSuppressPatternError(error)) {
      console.error('[AUTOPILOT_CAUSAL_PATTERNS] Failed to detect causal patterns:', error);
    }
    return [];
  }
}
