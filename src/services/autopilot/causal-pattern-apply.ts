import { createHash } from 'crypto';

import { db } from '@/lib/db';
import type {
  AutopilotConfigDraftSnapshot,
  AutopilotFlowGraph,
  AutopilotFlowNode,
  KnowledgeBaseDocument,
  KnowledgeCollection,
} from '@/lib/types';

const KNOWLEDGE_APPLICATION_TYPE = 'draft_knowledge_policy';
const SWITCH_GRAPH_APPLICATION_TYPE = 'draft_switch_graph_patch';
type CausalPatternApplicationType = typeof KNOWLEDGE_APPLICATION_TYPE | typeof SWITCH_GRAPH_APPLICATION_TYPE;

export type PatternRow = {
  id: string;
  pattern_type: string;
  procedure_id: string | null;
  step_id: string | null;
  switch_node_id?: string | null;
  switch_route_id?: string | null;
  tool_name: string | null;
  insight: string;
  evidence_json: unknown;
  suggested_fix_json: unknown;
  impact_json: unknown;
  confidence: unknown;
  status: string;
};

type ConfigRow = {
  name?: string | null;
  gemini_api_key?: string | null;
  ai_model?: string | null;
  transcription_model?: string | null;
  knowledge_base?: string | null;
  knowledge_base_documents?: unknown;
  knowledge_collections?: unknown;
  is_active?: unknown;
  is_private?: unknown;
  default_fallback_reply?: string | null;
  escalation_policy?: string | null;
  closing_policy?: string | null;
  enabled_tool_names?: unknown;
  flow_graph?: unknown;
};

export type AppliedCausalPatternDraftResult = {
  success: boolean;
  error?: string;
  documentId?: string;
  draftUpdatedAt?: string;
  applicationId?: string;
};

export type SafeAutoTuneCausalPatternResult = {
  success: boolean;
  appliedCount: number;
  skippedCount: number;
  appliedPatternIds: string[];
  skippedPatternIds: string[];
  errors: Array<{ patternId: string; error: string }>;
  draftUpdatedAt?: string;
  error?: string;
};

export type RevertedCausalPatternDraftResult = {
  success: boolean;
  error?: string;
  draftUpdatedAt?: string;
  applicationId?: string;
};

export type CausalPatternDraftApplicationPreview = {
  applicationType: CausalPatternApplicationType;
  operation: 'upsert_knowledge_document' | 'upsert_knowledge_document_and_patch_switch_graph';
  patternId: string;
  patternType: string;
  documentId: string;
  documentName: string;
  documentContentPreview: string;
  beforeSnapshotHash: string;
  afterSnapshotHash: string;
  graphPatchOperations: SwitchGraphPatchOperation[];
};

export type SwitchGraphPatchOperation =
  | {
    type: 'update_switch_instructions';
    switchNodeId: string;
    before: string | null;
    after: string;
  }
  | {
    type: 'update_switch_route_description';
    switchNodeId: string;
    routeId: string;
    before: string | null;
    after: string;
  }
  | {
    type: 'update_switch_route_examples';
    switchNodeId: string;
    routeId: string;
    before: string[];
    after: string[];
  };

export type SwitchGraphPatchResult = {
  graph: AutopilotFlowGraph;
  operations: SwitchGraphPatchOperation[];
};

type CausalPatternDraftApplicationPlan = {
  nextSnapshot: AutopilotConfigDraftSnapshot;
  learningDocument: KnowledgeBaseDocument;
  switchGraphPatch: SwitchGraphPatchResult | null;
  applicationType: CausalPatternApplicationType;
  patchJson: Record<string, unknown>;
  beforeSnapshotHash: string;
  afterSnapshotHash: string;
  preview: CausalPatternDraftApplicationPreview;
};

type ApplicationRow = {
  id: string;
  application_type: CausalPatternApplicationType;
  status: string;
  before_snapshot_hash: string;
  after_snapshot_hash: string;
  patch_json: unknown;
};

type CausalPatternApplicationQueryable = {
  query: (queryText: string, values?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number | null }>;
};

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseRecord(value: unknown): Record<string, unknown> {
  const parsed = parseJsonValue(value);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

function parseKnowledgeBaseDocuments(value: unknown): KnowledgeBaseDocument[] {
  const parsed = parseJsonValue(value);
  return Array.isArray(parsed) ? parsed as KnowledgeBaseDocument[] : [];
}

function parseKnowledgeCollections(value: unknown): KnowledgeCollection[] {
  const parsed = parseJsonValue(value);
  return Array.isArray(parsed) ? parsed as KnowledgeCollection[] : [];
}

function parseEnabledToolNames(value: unknown): string[] {
  const parsed = parseJsonValue(value);
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function parseFlowGraph(value: unknown): AutopilotFlowGraph | null {
  const parsed = parseJsonValue(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const graph = parsed as Partial<AutopilotFlowGraph>;
  return Array.isArray(graph.nodes) && Array.isArray(graph.edges)
    ? {
      version: 1,
      nodes: graph.nodes,
      edges: graph.edges,
      variables: Array.isArray(graph.variables) ? graph.variables : undefined,
    } as AutopilotFlowGraph
    : null;
}

function buildSnapshotFromConfigRow(row: ConfigRow): AutopilotConfigDraftSnapshot {
  return {
    name: row.name || 'Meu agente de IA',
    gemini_api_key: row.gemini_api_key || null,
    ai_model: row.ai_model || null,
    transcription_model: row.transcription_model || null,
    knowledge_base: row.knowledge_base || null,
    knowledge_base_documents: parseKnowledgeBaseDocuments(row.knowledge_base_documents),
    knowledge_collections: parseKnowledgeCollections(row.knowledge_collections),
    is_active: Boolean(row.is_active),
    is_private: Boolean(row.is_private),
    default_fallback_reply: row.default_fallback_reply || null,
    escalation_policy: row.escalation_policy || null,
    closing_policy: row.closing_policy || null,
    enabled_tool_names: parseEnabledToolNames(row.enabled_tool_names),
    flow_graph: parseFlowGraph(row.flow_graph),
  };
}

function normalizeDraftSnapshot(
  raw: unknown,
  fallback: AutopilotConfigDraftSnapshot,
): AutopilotConfigDraftSnapshot {
  const snapshot = raw && typeof raw === 'object'
    ? raw as Partial<AutopilotConfigDraftSnapshot>
    : {};
  const hasOwn = (key: keyof AutopilotConfigDraftSnapshot) =>
    Object.prototype.hasOwnProperty.call(snapshot, key);

  return {
    name: typeof snapshot.name === 'string' && snapshot.name.trim().length > 0
      ? snapshot.name
      : fallback.name,
    gemini_api_key: hasOwn('gemini_api_key')
      ? (typeof snapshot.gemini_api_key === 'string' && snapshot.gemini_api_key.length > 0 ? snapshot.gemini_api_key : null)
      : fallback.gemini_api_key,
    ai_model: hasOwn('ai_model')
      ? (typeof snapshot.ai_model === 'string' && snapshot.ai_model.length > 0 ? snapshot.ai_model : null)
      : fallback.ai_model,
    transcription_model: hasOwn('transcription_model')
      ? (typeof snapshot.transcription_model === 'string' && snapshot.transcription_model.length > 0 ? snapshot.transcription_model : null)
      : fallback.transcription_model || null,
    knowledge_base: hasOwn('knowledge_base')
      ? (typeof snapshot.knowledge_base === 'string' && snapshot.knowledge_base.length > 0 ? snapshot.knowledge_base : null)
      : fallback.knowledge_base,
    knowledge_base_documents: Array.isArray(snapshot.knowledge_base_documents)
      ? snapshot.knowledge_base_documents
      : fallback.knowledge_base_documents,
    knowledge_collections: Array.isArray(snapshot.knowledge_collections)
      ? snapshot.knowledge_collections
      : fallback.knowledge_collections || [],
    is_active: hasOwn('is_active') ? Boolean(snapshot.is_active) : fallback.is_active,
    is_private: hasOwn('is_private') ? Boolean(snapshot.is_private) : fallback.is_private,
    default_fallback_reply: hasOwn('default_fallback_reply')
      ? (typeof snapshot.default_fallback_reply === 'string' && snapshot.default_fallback_reply.length > 0 ? snapshot.default_fallback_reply : null)
      : fallback.default_fallback_reply,
    escalation_policy: hasOwn('escalation_policy')
      ? (typeof snapshot.escalation_policy === 'string' && snapshot.escalation_policy.length > 0 ? snapshot.escalation_policy : null)
      : fallback.escalation_policy,
    closing_policy: hasOwn('closing_policy')
      ? (typeof snapshot.closing_policy === 'string' && snapshot.closing_policy.length > 0 ? snapshot.closing_policy : null)
      : fallback.closing_policy,
    enabled_tool_names: Array.isArray(snapshot.enabled_tool_names)
      ? parseEnabledToolNames(snapshot.enabled_tool_names)
      : fallback.enabled_tool_names,
    flow_graph: hasOwn('flow_graph') ? parseFlowGraph(snapshot.flow_graph) : fallback.flow_graph || null,
  };
}

function stableJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashCausalPatternDraftSnapshot(snapshot: AutopilotConfigDraftSnapshot): string {
  return createHash('sha256').update(stableJson(snapshot)).digest('hex');
}

function patternTypeLabel(type: string): string {
  if (type === 'confusing_step') return 'Etapa confusa';
  if (type === 'dead_end_step') return 'Beco sem saida';
  if (type === 'tool_failure_hotspot') return 'Falha recorrente de ferramenta';
  if (type === 'switch_fallback_hotspot') return 'Fallback recorrente no Switch';
  if (type === 'switch_route_low_confidence') return 'Rota de Switch com baixa confianca';
  return type || 'Padrao operacional';
}

function suggestedFixText(pattern: PatternRow): string {
  const fix = parseRecord(pattern.suggested_fix_json);
  const action = typeof fix.action === 'string' ? fix.action : null;
  const reason = typeof fix.reason === 'string' ? fix.reason : null;
  const lines = [
    action ? `Acao sugerida: ${action}.` : null,
    reason ? `Motivo: ${reason}` : null,
  ].filter(Boolean);

  if (lines.length > 0) return lines.join('\n');
  if (pattern.pattern_type === 'tool_failure_hotspot' && pattern.tool_name) {
    return `Antes de executar ${pattern.tool_name}, valide dados obrigatorios, confirme o mapeamento do payload e tenha uma resposta alternativa curta se a integracao falhar.`;
  }
  if (pattern.pattern_type === 'switch_fallback_hotspot') {
    return 'Revise as rotas do Switch: adicione exemplos reais, crie uma nova rota para mensagens recorrentes em fallback ou torne a rota fallback uma pergunta objetiva de esclarecimento.';
  }
  if (pattern.pattern_type === 'switch_route_low_confidence') {
    return 'Reescreva a descricao da rota, adicione exemplos positivos/negativos e confira se o destino da rota resolve o problema sem transferir cedo demais.';
  }
  if (pattern.pattern_type === 'dead_end_step') {
    return 'Inclua uma pergunta objetiva de esclarecimento ou uma condicao de transferencia antes que a etapa vire beco sem saida.';
  }
  return 'Reescreva a etapa em instrucoes menores, confirme entendimento do cliente e avance somente quando os dados essenciais estiverem claros.';
}

function recordHighlights(value: unknown): string[] {
  const record = parseRecord(value);
  return Object.entries(record)
    .slice(0, 6)
    .map(([key, item]) => {
      if (typeof item === 'number' || typeof item === 'string' || typeof item === 'boolean') {
        return `- ${key}: ${String(item)}`;
      }
      if (Array.isArray(item)) {
        return `- ${key}: ${item.slice(0, 4).map(String).join(', ')}`;
      }
      return null;
    })
    .filter((line): line is string => Boolean(line));
}

function collectionIdsForLearningDocument(collections: KnowledgeCollection[]): string[] {
  const ids = collections
    .map((collection) => collection.id)
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
  return ids.length > 0 ? Array.from(new Set(ids)) : ['general'];
}

export function buildCausalPatternLearningDocument(input: {
  pattern: PatternRow;
  collections?: KnowledgeCollection[];
  appliedAt?: string;
}): KnowledgeBaseDocument {
  const appliedAt = input.appliedAt || new Date().toISOString();
  const pattern = input.pattern;
  const evidenceLines = recordHighlights(pattern.evidence_json);
  const impactLines = recordHighlights(pattern.impact_json);
  const scopeLines = [
    pattern.procedure_id ? `- Procedimento: ${pattern.procedure_id}` : null,
    pattern.step_id ? `- Etapa: ${pattern.step_id}` : null,
    pattern.switch_node_id ? `- Switch: ${pattern.switch_node_id}` : null,
    pattern.switch_route_id ? `- Rota do Switch: ${pattern.switch_route_id}` : null,
    pattern.tool_name ? `- Ferramenta: ${pattern.tool_name}` : null,
  ].filter(Boolean);

  const content = [
    `# Aprendizado aprovado: ${patternTypeLabel(pattern.pattern_type)}`,
    '',
    'Diretriz operacional para o agente. Use este conteudo para ajustar a conducao do atendimento; nao responda este texto literalmente ao cliente.',
    '',
    '## Padrao observado',
    pattern.insight,
    '',
    scopeLines.length > 0 ? '## Escopo' : null,
    scopeLines.length > 0 ? scopeLines.join('\n') : null,
    '',
    '## Como agir daqui em diante',
    suggestedFixText(pattern),
    '',
    evidenceLines.length > 0 ? '## Evidencias' : null,
    evidenceLines.length > 0 ? evidenceLines.join('\n') : null,
    '',
    impactLines.length > 0 ? '## Impacto estimado' : null,
    impactLines.length > 0 ? impactLines.join('\n') : null,
  ].filter((item): item is string => typeof item === 'string').join('\n').trim();

  return {
    id: `autopilot-learning-${pattern.id}`,
    name: `Aprendizado aprovado - ${patternTypeLabel(pattern.pattern_type)}`,
    content,
    sourceFormat: 'markdown',
    category: 'agent_learning_policy',
    tags: [
      'autoevolution',
      'approved_pattern',
      pattern.pattern_type,
      pattern.procedure_id ? `procedure:${pattern.procedure_id}` : null,
      pattern.step_id ? `step:${pattern.step_id}` : null,
      pattern.switch_node_id ? `switch:${pattern.switch_node_id}` : null,
      pattern.switch_route_id ? `switch_route:${pattern.switch_route_id}` : null,
      pattern.tool_name ? `tool:${pattern.tool_name}` : null,
    ].filter((tag): tag is string => Boolean(tag)),
    priority: 90,
    status: 'active',
    source: 'agent_causal_pattern',
    owner: 'autopilot_decision_engine',
    uploaded_at: appliedAt,
    updatedAt: appliedAt,
    workflowHints: [
      `pattern:${pattern.pattern_type}`,
      pattern.procedure_id ? `procedure:${pattern.procedure_id}` : null,
      pattern.step_id ? `step:${pattern.step_id}` : null,
      pattern.switch_node_id ? `switch:${pattern.switch_node_id}` : null,
      pattern.switch_route_id ? `switch_route:${pattern.switch_route_id}` : null,
    ].filter((hint): hint is string => Boolean(hint)),
    requiredTools: pattern.tool_name ? [pattern.tool_name] : null,
    contextRole: 'policy',
    canonicalAnswer: suggestedFixText(pattern),
    maxPromptChars: 2800,
    collectionIds: collectionIdsForLearningDocument(input.collections || []),
  };
}

export function mergeCausalPatternLearningDocument(
  documents: KnowledgeBaseDocument[],
  document: KnowledgeBaseDocument,
): KnowledgeBaseDocument[] {
  const next = documents.filter((item) => item.id !== document.id);
  return [...next, document];
}

function removeOrRestoreLearningDocument(
  documents: KnowledgeBaseDocument[],
  documentId: string,
  previousDocument: KnowledgeBaseDocument | null,
): KnowledgeBaseDocument[] {
  const filtered = documents.filter((item) => item.id !== documentId);
  return previousDocument ? [...filtered, previousDocument] : filtered;
}

function isSwitchPattern(pattern: PatternRow) {
  return pattern.pattern_type === 'switch_fallback_hotspot'
    || pattern.pattern_type === 'switch_route_low_confidence'
    || Boolean(pattern.switch_node_id || pattern.switch_route_id);
}

function normalizedLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function appendUniqueGuidance(current: string | null | undefined, guidance: string): string {
  const base = String(current || '').trim();
  const cleanGuidance = guidance.trim();
  if (!base) return cleanGuidance;
  if (normalizedLine(base).includes(normalizedLine(cleanGuidance))) return base;
  return `${base}\n\n${cleanGuidance}`;
}

function stringArrayFromRecord(value: unknown, keys: string[]): string[] {
  const record = parseRecord(value);
  const values = keys.flatMap((key) => {
    const item = record[key];
    if (Array.isArray(item)) return item;
    return [];
  });
  return values
    .map((item) => typeof item === 'string' ? item.trim() : '')
    .filter(Boolean)
    .slice(0, 6);
}

function resolveSwitchNodeId(pattern: PatternRow): string | null {
  return pattern.switch_node_id || pattern.step_id || null;
}

function resolveFallbackRouteId(node: AutopilotFlowNode, pattern: PatternRow): string | null {
  if (pattern.switch_route_id) return pattern.switch_route_id;
  const evidence = parseRecord(pattern.evidence_json);
  const fallbackRoutes = Array.isArray(evidence.fallbackRoutes) ? evidence.fallbackRoutes : [];
  const mostCommonFallbackRoute = fallbackRoutes
    .map((item) => parseRecord(item).routeId)
    .find((routeId): routeId is string => typeof routeId === 'string' && routeId.trim().length > 0);
  return node.config?.fallbackRouteId || mostCommonFallbackRoute || null;
}

function switchPatternInstruction(pattern: PatternRow): string {
  const evidence = parseRecord(pattern.evidence_json);
  const sampleSize = typeof evidence.sampleSize === 'number' ? evidence.sampleSize : null;
  const fallbackRate = typeof evidence.fallbackRate === 'number' ? Math.round(evidence.fallbackRate * 100) : null;
  const averageConfidence = typeof evidence.averageConfidence === 'number' ? Math.round(evidence.averageConfidence * 100) : null;
  const routeText = pattern.switch_route_id ? ` na rota "${pattern.switch_route_id}"` : '';

  if (pattern.pattern_type === 'switch_fallback_hotspot') {
    return [
      `Aprendizado aprovado (${pattern.id}): este Switch teve fallback recorrente${sampleSize ? ` em ${sampleSize} amostras` : ''}${fallbackRate != null ? ` (${fallbackRate}%)` : ''}.`,
      'Antes de escolher fallback, compare a mensagem com todas as rotas configuradas; se ainda faltar evidencia, encaminhe para uma pergunta curta de esclarecimento em vez de improvisar uma rota.',
    ].join(' ');
  }

  if (pattern.pattern_type === 'switch_route_low_confidence') {
    return [
      `Aprendizado aprovado (${pattern.id}): a escolha${routeText} teve baixa confianca media${averageConfidence != null ? ` (${averageConfidence}%)` : ''}.`,
      'Use esta rota somente quando houver sinais claros da descricao e dos exemplos; em caso de sobreposicao com outra rota, prefira esclarecer antes de avancar.',
    ].join(' ');
  }

  return `Aprendizado aprovado (${pattern.id}): considere este padrao ao decidir rotas do Switch.`;
}

function switchRouteDescriptionGuidance(pattern: PatternRow): string {
  const fix = parseRecord(pattern.suggested_fix_json);
  const reason = typeof fix.reason === 'string' ? fix.reason.trim() : '';
  if (pattern.pattern_type === 'switch_fallback_hotspot') {
    return [
      'Aprendizado aprovado: use esta rota quando nenhuma rota especifica tiver evidencia suficiente.',
      'A resposta seguinte deve pedir um esclarecimento objetivo sobre o problema do cliente.',
      reason ? `Motivo observado: ${reason}` : '',
    ].filter(Boolean).join(' ');
  }
  return [
    'Aprendizado aprovado: escolha esta rota apenas com sinais claros e diferenciaveis.',
    'Se a mensagem puder pertencer a outra rota, faca uma pergunta de esclarecimento antes de seguir.',
    reason ? `Motivo observado: ${reason}` : '',
  ].filter(Boolean).join(' ');
}

export function buildSwitchPatternDraftGraphPatch(
  graph: AutopilotFlowGraph | null | undefined,
  pattern: PatternRow,
): SwitchGraphPatchResult | null {
  if (!graph || !isSwitchPattern(pattern)) return null;
  const switchNodeId = resolveSwitchNodeId(pattern);
  if (!switchNodeId) return null;

  const operations: SwitchGraphPatchOperation[] = [];
  const nextNodes = graph.nodes.map((node) => {
    if (node.id !== switchNodeId || node.kind !== 'switch') return node;

    const currentConfig = node.config || {};
    const nextConfig: NonNullable<AutopilotFlowNode['config']> = { ...currentConfig };
    const beforeInstructions = currentConfig.instructions || null;
    const afterInstructions = appendUniqueGuidance(beforeInstructions, switchPatternInstruction(pattern));
    if (afterInstructions !== (beforeInstructions || '')) {
      nextConfig.instructions = afterInstructions;
      operations.push({
        type: 'update_switch_instructions',
        switchNodeId,
        before: beforeInstructions,
        after: afterInstructions,
      });
    }

    const routeId = pattern.pattern_type === 'switch_fallback_hotspot'
      ? resolveFallbackRouteId(node, pattern)
      : pattern.switch_route_id || null;
    if (routeId && Array.isArray(currentConfig.routes)) {
      nextConfig.routes = currentConfig.routes.map((route) => {
        if (route.id !== routeId) return route;

        const beforeDescription = route.description || null;
        const afterDescription = appendUniqueGuidance(beforeDescription, switchRouteDescriptionGuidance(pattern));
        const exampleCandidates = stringArrayFromRecord(pattern.evidence_json, ['exampleMessages', 'examples', 'fallbackExamples']);
        const beforeExamples = Array.isArray(route.examples) ? route.examples : [];
        const afterExamples = Array.from(new Set([
          ...beforeExamples,
          ...exampleCandidates,
        ])).slice(0, 12);

        const nextRoute = {
          ...route,
          description: afterDescription,
          examples: afterExamples.length > 0 ? afterExamples : route.examples,
        };

        if (afterDescription !== (beforeDescription || '')) {
          operations.push({
            type: 'update_switch_route_description',
            switchNodeId,
            routeId,
            before: beforeDescription,
            after: afterDescription,
          });
        }
        if (afterExamples.length !== beforeExamples.length) {
          operations.push({
            type: 'update_switch_route_examples',
            switchNodeId,
            routeId,
            before: beforeExamples,
            after: afterExamples,
          });
        }

        return nextRoute;
      });
    }

    return {
      ...node,
      config: nextConfig,
    };
  });

  if (operations.length === 0) return null;
  return {
    graph: {
      ...graph,
      nodes: nextNodes,
    },
    operations,
  };
}

function parseSwitchGraphPatchOperations(patchJson: Record<string, unknown>): SwitchGraphPatchOperation[] {
  const graphPatch = parseRecord(patchJson.graphPatch);
  const operations = Array.isArray(graphPatch.operations) ? graphPatch.operations : [];
  return operations
    .map((operation): SwitchGraphPatchOperation | null => {
      const record = parseRecord(operation);
      if (record.type === 'update_switch_instructions'
        && typeof record.switchNodeId === 'string'
        && typeof record.after === 'string') {
        return {
          type: 'update_switch_instructions',
          switchNodeId: record.switchNodeId,
          before: typeof record.before === 'string' ? record.before : null,
          after: record.after,
        };
      }
      if (record.type === 'update_switch_route_description'
        && typeof record.switchNodeId === 'string'
        && typeof record.routeId === 'string'
        && typeof record.after === 'string') {
        return {
          type: 'update_switch_route_description',
          switchNodeId: record.switchNodeId,
          routeId: record.routeId,
          before: typeof record.before === 'string' ? record.before : null,
          after: record.after,
        };
      }
      if (record.type === 'update_switch_route_examples'
        && typeof record.switchNodeId === 'string'
        && typeof record.routeId === 'string'
        && Array.isArray(record.after)) {
        return {
          type: 'update_switch_route_examples',
          switchNodeId: record.switchNodeId,
          routeId: record.routeId,
          before: Array.isArray(record.before)
            ? record.before.filter((item): item is string => typeof item === 'string')
            : [],
          after: record.after.filter((item): item is string => typeof item === 'string'),
        };
      }
      return null;
    })
    .filter((operation): operation is SwitchGraphPatchOperation => Boolean(operation));
}

function parsePreviousLearningDocument(patchJson: Record<string, unknown>): KnowledgeBaseDocument | null {
  const previousDocument = patchJson.previousDocument;
  if (!previousDocument || typeof previousDocument !== 'object' || Array.isArray(previousDocument)) return null;
  const record = previousDocument as Partial<KnowledgeBaseDocument>;
  return typeof record.id === 'string' && typeof record.name === 'string' && typeof record.content === 'string'
    ? record as KnowledgeBaseDocument
    : null;
}

function revertSwitchGraphPatch(
  graph: AutopilotFlowGraph | null | undefined,
  operations: SwitchGraphPatchOperation[],
): AutopilotFlowGraph | null {
  if (operations.length === 0) return graph || null;
  if (!graph) return null;

  let currentGraph = graph;
  for (const operation of [...operations].reverse()) {
    let operationApplied = false;
    const nextNodes = currentGraph.nodes.map((node) => {
      if (node.id !== operation.switchNodeId || node.kind !== 'switch') return node;
      const nextConfig: NonNullable<AutopilotFlowNode['config']> = { ...(node.config || {}) };

      if (operation.type === 'update_switch_instructions') {
        if (operation.before == null) {
          delete nextConfig.instructions;
        } else {
          nextConfig.instructions = operation.before;
        }
        operationApplied = true;
        return { ...node, config: nextConfig };
      }

      if (!Array.isArray(nextConfig.routes)) return node;
      nextConfig.routes = nextConfig.routes.map((route) => {
        if (route.id !== operation.routeId) return route;
        operationApplied = true;
        if (operation.type === 'update_switch_route_description') {
          return {
            ...route,
            description: operation.before || '',
          };
        }
        return {
          ...route,
          examples: operation.before,
        };
      });
      return { ...node, config: nextConfig };
    });

    if (!operationApplied) return null;
    currentGraph = {
      ...currentGraph,
      nodes: nextNodes,
    };
  }

  return currentGraph;
}

export function buildCausalPatternDraftApplicationPlan(input: {
  currentSnapshot: AutopilotConfigDraftSnapshot;
  pattern: PatternRow;
  appliedAt?: string;
  includeGraphPatch?: boolean;
}): { plan: CausalPatternDraftApplicationPlan | null; error?: string } {
  const appliedAt = input.appliedAt || new Date().toISOString();
  const includeGraphPatch = input.includeGraphPatch ?? true;
  const learningDocument = buildCausalPatternLearningDocument({
    pattern: input.pattern,
    collections: input.currentSnapshot.knowledge_collections || [],
    appliedAt,
  });
  const previousLearningDocument = (input.currentSnapshot.knowledge_base_documents || [])
    .find((document) => document.id === learningDocument.id) || null;
  const switchGraphPatch = includeGraphPatch
    ? buildSwitchPatternDraftGraphPatch(input.currentSnapshot.flow_graph, input.pattern)
    : null;
  if (includeGraphPatch && isSwitchPattern(input.pattern) && !switchGraphPatch) {
    return { plan: null, error: 'Sugestao de Switch nao encontrou o bloco ou a rota no rascunho atual.' };
  }

  const nextSnapshot: AutopilotConfigDraftSnapshot = {
    ...input.currentSnapshot,
    knowledge_base_documents: mergeCausalPatternLearningDocument(
      input.currentSnapshot.knowledge_base_documents || [],
      learningDocument,
    ),
    flow_graph: switchGraphPatch?.graph || input.currentSnapshot.flow_graph || null,
  };
  const beforeSnapshotHash = hashCausalPatternDraftSnapshot(input.currentSnapshot);
  const afterSnapshotHash = hashCausalPatternDraftSnapshot(nextSnapshot);
  const applicationType = switchGraphPatch
    ? SWITCH_GRAPH_APPLICATION_TYPE
    : KNOWLEDGE_APPLICATION_TYPE;
  const operation = switchGraphPatch
    ? 'upsert_knowledge_document_and_patch_switch_graph'
    : 'upsert_knowledge_document';
  const patchJson = {
    operation,
    documentId: learningDocument.id,
    documentName: learningDocument.name,
    previousDocument: previousLearningDocument,
    applicationType,
    patternType: input.pattern.pattern_type,
    procedureId: input.pattern.procedure_id,
    stepId: input.pattern.step_id,
    switchNodeId: input.pattern.switch_node_id || null,
    switchRouteId: input.pattern.switch_route_id || null,
    toolName: input.pattern.tool_name,
    graphPatchIncluded: Boolean(switchGraphPatch),
    graphPatchSkipped: isSwitchPattern(input.pattern) && !switchGraphPatch,
    graphPatch: switchGraphPatch ? {
      operationCount: switchGraphPatch.operations.length,
      operations: switchGraphPatch.operations,
    } : null,
  };

  return {
    plan: {
      nextSnapshot,
      learningDocument,
      switchGraphPatch,
      applicationType,
      patchJson,
      beforeSnapshotHash,
      afterSnapshotHash,
      preview: {
        applicationType,
        operation,
        patternId: input.pattern.id,
        patternType: input.pattern.pattern_type,
        documentId: learningDocument.id,
        documentName: learningDocument.name,
        documentContentPreview: learningDocument.content.slice(0, 1200),
        beforeSnapshotHash,
        afterSnapshotHash,
        graphPatchOperations: switchGraphPatch?.operations || [],
      },
    },
  };
}

function shouldSuppressApplyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('agent_causal_patterns')
    || message.includes('agent_causal_pattern_applications')
    || message.includes('autopilot_config_drafts');
}

export function isCausalPatternSafeAutoTuneEligible(pattern: Pick<PatternRow, 'pattern_type' | 'tool_name' | 'confidence' | 'status'>): boolean {
  const confidence = typeof pattern.confidence === 'number'
    ? pattern.confidence
    : Number(pattern.confidence);
  if (pattern.status !== 'approved') return false;
  if (!Number.isFinite(confidence) || confidence < 0.75) return false;
  if (pattern.tool_name) return false;
  return pattern.pattern_type === 'confusing_step'
    || pattern.pattern_type === 'switch_fallback_hotspot'
    || pattern.pattern_type === 'switch_route_low_confidence';
}

export async function applyCausalPatternToDraft(input: {
  workspaceId: string;
  configId: string;
  patternId: string;
  userId: string;
  includeGraphPatch?: boolean;
  applicationSource?: 'manual' | 'safe_auto_tune';
}): Promise<AppliedCausalPatternDraftResult> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const configRes = await client.query(
      'SELECT * FROM autopilot_configs WHERE workspace_id = $1 AND id = $2 FOR UPDATE',
      [input.workspaceId, input.configId],
    );
    const config = configRes.rows[0] as ConfigRow | undefined;
    if (!config) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Agente nao encontrado.' };
    }

    const patternRes = await client.query(
      `SELECT id, pattern_type, procedure_id, step_id, tool_name, insight,
              switch_node_id, switch_route_id,
              evidence_json, suggested_fix_json, impact_json, confidence, status
       FROM agent_causal_patterns
       WHERE workspace_id = $1
         AND id = $2
       FOR UPDATE`,
      [input.workspaceId, input.patternId],
    );
    const pattern = patternRes.rows[0] as PatternRow | undefined;
    if (!pattern) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Sugestao nao encontrada.' };
    }
    if (pattern.status !== 'approved') {
      await client.query('ROLLBACK');
      return { success: false, error: 'A sugestao precisa estar aprovada antes de ser aplicada.' };
    }

    const draftRes = await client.query(
      'SELECT snapshot FROM autopilot_config_drafts WHERE config_id = $1 LIMIT 1',
      [input.configId],
    );
    const fallbackSnapshot = buildSnapshotFromConfigRow(config);
    const currentSnapshot = draftRes.rows[0]
      ? normalizeDraftSnapshot(draftRes.rows[0].snapshot, fallbackSnapshot)
      : fallbackSnapshot;
    const appliedAt = new Date().toISOString();
    const applicationPlan = buildCausalPatternDraftApplicationPlan({
      currentSnapshot,
      pattern,
      appliedAt,
      includeGraphPatch: input.includeGraphPatch,
    });
    if (!applicationPlan.plan) {
      await client.query('ROLLBACK');
      return { success: false, error: applicationPlan.error || 'Falha ao preparar aplicacao.' };
    }
    const plan = applicationPlan.plan;
    const applicationPayload = {
      ...plan.patchJson,
      applicationSource: input.applicationSource || 'manual',
      appliedAt,
    };

    const draftUpdateRes = await client.query(
      `INSERT INTO autopilot_config_drafts (config_id, workspace_id, user_id, snapshot, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, timezone('utc', now()))
       ON CONFLICT (config_id)
       DO UPDATE SET
          workspace_id = EXCLUDED.workspace_id,
          user_id = EXCLUDED.user_id,
          snapshot = EXCLUDED.snapshot,
          updated_at = timezone('utc', now())
       RETURNING updated_at`,
      [input.configId, input.workspaceId, input.userId, JSON.stringify(plan.nextSnapshot)],
    );

    const applicationRes = await client.query(
      `INSERT INTO agent_causal_pattern_applications (
          workspace_id,
          config_id,
          pattern_id,
          applied_by_user_id,
          application_type,
          status,
          before_snapshot_hash,
          after_snapshot_hash,
          patch_json
       ) VALUES (
          $1, $2, $3, $4, $5, 'drafted', $6, $7, $8::jsonb
       )
       ON CONFLICT (config_id, pattern_id)
       DO UPDATE SET
          applied_by_user_id = EXCLUDED.applied_by_user_id,
          status = 'drafted',
          before_snapshot_hash = EXCLUDED.before_snapshot_hash,
          after_snapshot_hash = EXCLUDED.after_snapshot_hash,
          patch_json = EXCLUDED.patch_json,
          created_at = clock_timestamp()
       RETURNING id`,
      [
        input.workspaceId,
        input.configId,
        input.patternId,
        input.userId,
        plan.applicationType,
        plan.beforeSnapshotHash,
        plan.afterSnapshotHash,
        JSON.stringify(applicationPayload),
      ],
    );

    const reviewMetadata = {
      ...applicationPayload,
      decision: input.applicationSource === 'safe_auto_tune' ? 'safe_auto_tune_applied' : 'mark_applied',
      appliedToDraft: true,
      appliedByUserId: input.userId,
      applicationId: applicationRes.rows[0]?.id || null,
    };
    const patternUpdateRes = await client.query(
      `UPDATE agent_causal_patterns
       SET status = 'applied',
           reviewed_at = COALESCE(reviewed_at, clock_timestamp()),
           applied_at = COALESCE(applied_at, clock_timestamp()),
           reviewed_by_user_id = COALESCE($3, reviewed_by_user_id),
           review_metadata = COALESCE(review_metadata, '{}'::jsonb) || $4::jsonb
       WHERE id = $1
         AND workspace_id = $2
         AND status = 'approved'
       RETURNING id`,
      [
        input.patternId,
        input.workspaceId,
        input.userId,
        JSON.stringify(reviewMetadata),
      ],
    );
    if (patternUpdateRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Sugestao nao esta mais disponivel para aplicacao.' };
    }

    await client.query('COMMIT');
    return {
      success: true,
      documentId: plan.learningDocument.id,
      applicationId: applicationRes.rows[0]?.id || undefined,
      draftUpdatedAt: draftUpdateRes.rows[0]?.updated_at
        ? new Date(draftUpdateRes.rows[0].updated_at).toISOString()
        : appliedAt,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (!shouldSuppressApplyError(error)) {
      console.error('[AUTOPILOT_CAUSAL_PATTERN_APPLY] Failed to apply pattern:', error);
    }
    return { success: false, error: 'Falha ao aplicar sugestao no rascunho.' };
  } finally {
    client.release();
  }
}

export async function applySafeCausalPatternAutoTuneToDraft(input: {
  workspaceId: string;
  configId: string;
  userId: string;
  limit?: number;
}): Promise<SafeAutoTuneCausalPatternResult> {
  try {
    const limit = Math.max(1, Math.min(10, Math.round(input.limit || 5)));
    const patternRes = await db.query(
      `SELECT id, pattern_type, procedure_id, step_id, tool_name, insight,
              switch_node_id, switch_route_id,
              evidence_json, suggested_fix_json, impact_json, confidence, status
       FROM agent_causal_patterns
       WHERE workspace_id = $1
         AND status = 'approved'
       ORDER BY confidence DESC, created_at ASC
       LIMIT 50`,
      [input.workspaceId],
    );
    const approvedPatterns = patternRes.rows as PatternRow[];
    const eligiblePatterns = approvedPatterns
      .filter(isCausalPatternSafeAutoTuneEligible)
      .slice(0, limit);
    const skippedPatternIds = approvedPatterns
      .filter((pattern) => !eligiblePatterns.some((eligible) => eligible.id === pattern.id))
      .map((pattern) => pattern.id);

    const appliedPatternIds: string[] = [];
    const errors: Array<{ patternId: string; error: string }> = [];
    let draftUpdatedAt: string | undefined;
    for (const pattern of eligiblePatterns) {
      const applied = await applyCausalPatternToDraft({
        workspaceId: input.workspaceId,
        configId: input.configId,
        patternId: pattern.id,
        userId: input.userId,
        includeGraphPatch: false,
        applicationSource: 'safe_auto_tune',
      });
      if (applied.success) {
        appliedPatternIds.push(pattern.id);
        draftUpdatedAt = applied.draftUpdatedAt || draftUpdatedAt;
      } else {
        errors.push({
          patternId: pattern.id,
          error: applied.error || 'Falha ao aplicar auto-tune seguro.',
        });
      }
    }

    return {
      success: errors.length === 0,
      appliedCount: appliedPatternIds.length,
      skippedCount: skippedPatternIds.length,
      appliedPatternIds,
      skippedPatternIds,
      errors,
      draftUpdatedAt,
      error: errors.length > 0 ? 'Alguns aprendizados seguros nao puderam ser aplicados.' : undefined,
    };
  } catch (error) {
    if (!shouldSuppressApplyError(error)) {
      console.error('[AUTOPILOT_CAUSAL_PATTERN_SAFE_AUTO_TUNE] Failed to apply safe auto-tune:', error);
    }
    return {
      success: false,
      appliedCount: 0,
      skippedCount: 0,
      appliedPatternIds: [],
      skippedPatternIds: [],
      errors: [],
      error: 'Falha ao executar auto-tune seguro.',
    };
  }
}

export async function revertCausalPatternDraftApplication(input: {
  workspaceId: string;
  configId: string;
  patternId: string;
  userId: string;
}): Promise<RevertedCausalPatternDraftResult> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const configRes = await client.query(
      'SELECT * FROM autopilot_configs WHERE workspace_id = $1 AND id = $2 FOR UPDATE',
      [input.workspaceId, input.configId],
    );
    const config = configRes.rows[0] as ConfigRow | undefined;
    if (!config) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Agente nao encontrado.' };
    }

    const patternRes = await client.query(
      `SELECT id, status
       FROM agent_causal_patterns
       WHERE workspace_id = $1
         AND id = $2
       FOR UPDATE`,
      [input.workspaceId, input.patternId],
    );
    const pattern = patternRes.rows[0] as { id: string; status: string } | undefined;
    if (!pattern) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Sugestao nao encontrada.' };
    }
    if (pattern.status !== 'applied') {
      await client.query('ROLLBACK');
      return { success: false, error: 'A sugestao precisa estar aplicada para ser revertida.' };
    }

    const applicationRes = await client.query(
      `SELECT id, application_type, status, before_snapshot_hash, after_snapshot_hash, patch_json
       FROM agent_causal_pattern_applications
       WHERE workspace_id = $1
         AND config_id = $2
         AND pattern_id = $3
         AND status = 'drafted'
       ORDER BY created_at DESC
       LIMIT 1
       FOR UPDATE`,
      [input.workspaceId, input.configId, input.patternId],
    );
    const application = applicationRes.rows[0] as ApplicationRow | undefined;
    if (!application) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Aplicacao ja foi publicada, revertida ou nao existe no rascunho.' };
    }

    const draftRes = await client.query(
      'SELECT snapshot FROM autopilot_config_drafts WHERE config_id = $1 LIMIT 1 FOR UPDATE',
      [input.configId],
    );
    if (!draftRes.rows[0]) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Aplicacao ja foi publicada ou nao ha rascunho para reverter.' };
    }

    const fallbackSnapshot = buildSnapshotFromConfigRow(config);
    const currentSnapshot = normalizeDraftSnapshot(draftRes.rows[0].snapshot, fallbackSnapshot);
    const currentHash = hashCausalPatternDraftSnapshot(currentSnapshot);
    const patchJson = parseRecord(application.patch_json);
    const markConflict = async (reason: string, detail: Record<string, unknown>) => {
      await client.query(
        `UPDATE agent_causal_pattern_applications
         SET status = 'conflicted',
             patch_json = COALESCE(patch_json, '{}'::jsonb) || $2::jsonb
         WHERE id = $1`,
        [
          application.id,
          JSON.stringify({
            rollbackConflict: {
              reason,
              detectedAt: new Date().toISOString(),
              detectedByUserId: input.userId,
              ...detail,
            },
          }),
        ],
      );
      await client.query('COMMIT');
    };

    if (currentHash !== application.after_snapshot_hash) {
      await markConflict('draft_hash_mismatch', {
        expectedAfterSnapshotHash: application.after_snapshot_hash,
        currentSnapshotHash: currentHash,
      });
      return {
        success: false,
        error: 'O rascunho mudou depois da aplicacao. Reversao bloqueada para nao apagar alteracoes recentes.',
        applicationId: application.id,
      };
    }

    const documentId = typeof patchJson.documentId === 'string' ? patchJson.documentId : null;
    if (!documentId) {
      await markConflict('missing_document_id', {});
      return { success: false, error: 'Aplicacao nao possui documento rastreavel para reverter.', applicationId: application.id };
    }

    const operations = parseSwitchGraphPatchOperations(patchJson);
    const revertedGraph = revertSwitchGraphPatch(currentSnapshot.flow_graph, operations);
    if (operations.length > 0 && !revertedGraph) {
      await markConflict('switch_graph_patch_not_reversible', {
        operationCount: operations.length,
      });
      return {
        success: false,
        error: 'O patch do Switch nao pode mais ser revertido automaticamente no rascunho atual.',
        applicationId: application.id,
      };
    }

    const nextSnapshot: AutopilotConfigDraftSnapshot = {
      ...currentSnapshot,
      knowledge_base_documents: removeOrRestoreLearningDocument(
        currentSnapshot.knowledge_base_documents || [],
        documentId,
        parsePreviousLearningDocument(patchJson),
      ),
      flow_graph: revertedGraph,
    };
    const nextHash = hashCausalPatternDraftSnapshot(nextSnapshot);
    if (nextHash !== application.before_snapshot_hash) {
      await markConflict('rollback_hash_mismatch', {
        expectedBeforeSnapshotHash: application.before_snapshot_hash,
        rollbackSnapshotHash: nextHash,
      });
      return {
        success: false,
        error: 'A reversao preparada nao bate com o snapshot anterior. O sistema marcou conflito para revisao manual.',
        applicationId: application.id,
      };
    }

    const draftUpdateRes = await client.query(
      `UPDATE autopilot_config_drafts
       SET workspace_id = $2,
           user_id = $3,
           snapshot = $4::jsonb,
           updated_at = timezone('utc', now())
       WHERE config_id = $1
       RETURNING updated_at`,
      [input.configId, input.workspaceId, input.userId, JSON.stringify(nextSnapshot)],
    );

    const revertedAt = new Date().toISOString();
    await client.query(
      `UPDATE agent_causal_pattern_applications
       SET status = 'reverted',
           patch_json = COALESCE(patch_json, '{}'::jsonb) || $2::jsonb
       WHERE id = $1`,
      [
        application.id,
        JSON.stringify({
          rollback: {
            revertedAt,
            revertedByUserId: input.userId,
            beforeRevertSnapshotHash: currentHash,
            afterRevertSnapshotHash: nextHash,
          },
        }),
      ],
    );

    const patternUpdateRes = await client.query(
      `UPDATE agent_causal_patterns
       SET status = 'approved',
           applied_at = NULL,
           review_metadata = COALESCE(review_metadata, '{}'::jsonb) || $3::jsonb
       WHERE id = $1
         AND workspace_id = $2
         AND status = 'applied'
       RETURNING id`,
      [
        input.patternId,
        input.workspaceId,
        JSON.stringify({
          decision: 'rollback_application',
          revertedFromDraft: true,
          revertedAt,
          revertedByUserId: input.userId,
          applicationId: application.id,
        }),
      ],
    );
    if (patternUpdateRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Sugestao nao esta mais aplicada.' };
    }

    await client.query('COMMIT');
    return {
      success: true,
      applicationId: application.id,
      draftUpdatedAt: draftUpdateRes.rows[0]?.updated_at
        ? new Date(draftUpdateRes.rows[0].updated_at).toISOString()
        : revertedAt,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (!shouldSuppressApplyError(error)) {
      console.error('[AUTOPILOT_CAUSAL_PATTERN_REVERT] Failed to revert pattern application:', error);
    }
    return { success: false, error: 'Falha ao reverter aplicacao no rascunho.' };
  } finally {
    client.release();
  }
}

export async function markDraftCausalPatternApplicationsPublished(
  client: CausalPatternApplicationQueryable,
  input: {
    workspaceId: string;
    configId: string;
    userId: string;
    versionNumber: number;
  },
): Promise<{ publishedCount: number }> {
  const publishedAt = new Date().toISOString();
  const res = await client.query(
    `UPDATE agent_causal_pattern_applications
     SET status = 'published',
         patch_json = COALESCE(patch_json, '{}'::jsonb) || $3::jsonb
     WHERE workspace_id = $1
       AND config_id = $2
       AND status = 'drafted'`,
    [
      input.workspaceId,
      input.configId,
      JSON.stringify({
        publication: {
          publishedAt,
          publishedByUserId: input.userId,
          versionNumber: input.versionNumber,
        },
      }),
    ],
  );
  return { publishedCount: res.rowCount || 0 };
}

export async function markDraftCausalPatternApplicationsDiscarded(
  client: CausalPatternApplicationQueryable,
  input: {
    workspaceId: string;
    configId: string;
    userId: string;
    reason: 'draft_discarded' | 'version_restored';
  },
): Promise<{ revertedCount: number }> {
  const revertedAt = new Date().toISOString();
  const applicationRes = await client.query(
    `UPDATE agent_causal_pattern_applications
     SET status = 'reverted',
         patch_json = COALESCE(patch_json, '{}'::jsonb) || $3::jsonb
     WHERE workspace_id = $1
       AND config_id = $2
       AND status = 'drafted'
     RETURNING pattern_id`,
    [
      input.workspaceId,
      input.configId,
      JSON.stringify({
        rollback: {
          revertedAt,
          revertedByUserId: input.userId,
          reason: input.reason,
        },
      }),
    ],
  );
  const patternIds = applicationRes.rows
    .map((row) => parseRecord(row).pattern_id)
    .filter((patternId): patternId is string => typeof patternId === 'string' && patternId.trim().length > 0);

  if (patternIds.length > 0) {
    await client.query(
      `UPDATE agent_causal_patterns
       SET status = 'approved',
           applied_at = NULL,
           review_metadata = COALESCE(review_metadata, '{}'::jsonb) || $3::jsonb
       WHERE workspace_id = $1
         AND id = ANY($2::uuid[])
         AND status = 'applied'`,
      [
        input.workspaceId,
        patternIds,
        JSON.stringify({
          decision: 'rollback_application',
          revertedFromDraft: true,
          revertedAt,
          revertedByUserId: input.userId,
          reason: input.reason,
        }),
      ],
    );
  }

  return { revertedCount: applicationRes.rowCount || 0 };
}

export async function previewCausalPatternDraftApplication(input: {
  workspaceId: string;
  configId: string;
  patternId: string;
}): Promise<{ preview: CausalPatternDraftApplicationPreview | null; error?: string }> {
  try {
    const configRes = await db.query(
      'SELECT * FROM autopilot_configs WHERE workspace_id = $1 AND id = $2 LIMIT 1',
      [input.workspaceId, input.configId],
    );
    const config = configRes.rows[0] as ConfigRow | undefined;
    if (!config) return { preview: null, error: 'Agente nao encontrado.' };

    const patternRes = await db.query(
      `SELECT id, pattern_type, procedure_id, step_id, tool_name, insight,
              switch_node_id, switch_route_id,
              evidence_json, suggested_fix_json, impact_json, confidence, status
       FROM agent_causal_patterns
       WHERE workspace_id = $1
         AND id = $2
       LIMIT 1`,
      [input.workspaceId, input.patternId],
    );
    const pattern = patternRes.rows[0] as PatternRow | undefined;
    if (!pattern) return { preview: null, error: 'Sugestao nao encontrada.' };
    if (pattern.status !== 'approved') {
      return { preview: null, error: 'A sugestao precisa estar aprovada antes de gerar preview.' };
    }

    const draftRes = await db.query(
      'SELECT snapshot FROM autopilot_config_drafts WHERE config_id = $1 LIMIT 1',
      [input.configId],
    );
    const fallbackSnapshot = buildSnapshotFromConfigRow(config);
    const currentSnapshot = draftRes.rows[0]
      ? normalizeDraftSnapshot(draftRes.rows[0].snapshot, fallbackSnapshot)
      : fallbackSnapshot;
    const applicationPlan = buildCausalPatternDraftApplicationPlan({
      currentSnapshot,
      pattern,
      appliedAt: new Date().toISOString(),
    });
    if (!applicationPlan.plan) {
      return { preview: null, error: applicationPlan.error || 'Falha ao preparar preview.' };
    }
    return { preview: applicationPlan.plan.preview };
  } catch (error) {
    if (!shouldSuppressApplyError(error)) {
      console.error('[AUTOPILOT_CAUSAL_PATTERN_PREVIEW] Failed to preview pattern application:', error);
    }
    return { preview: null, error: 'Falha ao gerar preview da sugestao.' };
  }
}
