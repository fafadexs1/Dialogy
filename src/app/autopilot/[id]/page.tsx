'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Loader2,
  LayoutDashboard,
  Database,
  Zap,
  Settings2,
  CheckCircle2,
  Save,
  ArrowLeft,
  ShieldCheck,
  History,
  LineChart,
  BrainCircuit,
  RotateCcw,
  TestTube2,
  BookOpen,
  X,
  Wrench,
  GitBranch,
} from 'lucide-react';

import type {
  AutopilotConfig,
  AutopilotConfigDraftSnapshot,
  AutopilotConfigVersionSummary,
  AutopilotFlowGraph,
  AutopilotUsageLog,
  AutopilotRagHealth,
  KnowledgeCollection,
  KnowledgeBaseDocument,
  NexusFlowInstance,
  Workspace,
} from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useCurrentUser } from '@/hooks/use-online-status';
import {
  getAutopilotConfig,
  saveAutopilotDraft,
  publishAutopilotDraft,
  discardAutopilotDraft,
  restoreAutopilotVersion,
  deleteAutopilotRule,
  toggleAutopilotRule,
  getAutopilotUsageLogs,
  deleteAutopilotAgent,
  setPrimaryAutopilotAgent,
  getAgentToolCatalogAction,
  getAutopilotRagHealth,
  reindexAutopilotKnowledgeBase,
  runAutopilotRagLab,
  improveAutopilotKnowledgeDocument,
  getAutopilotDecisionInsights,
  refreshAutopilotDecisionPatterns,
  reviewAutopilotCausalPattern,
  previewAutopilotCausalPatternApplication,
  applyAutopilotCausalPattern,
  applySafeAutopilotCausalPatternAutoTune,
  applyAutopilotScoreSuggestion,
  revertAutopilotCausalPatternApplication,
  importAutopilotEcosystemPattern,
  previewAutopilotNativeWorkflowMigration,
  applyAutopilotNativeWorkflowMigration,
  createAutopilotNativeWorkflowDraft,
  generateAutopilotNativeWorkflowWithAi,
  runAutopilotNativeWorkflowTest,
  type AutopilotCausalPatternApplicationPreview,
  type AutopilotDecisionInsights,
} from '@/actions/autopilot';
import { getAiModelCatalogAction } from '@/actions/ai-models';
import {
  DEFAULT_AUTOPILOT_MODEL,
  getAiModelRuntimeProvider,
  getAiModelLabel,
  type AiModelCatalogEntry,
} from '@/lib/ai-models';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { AutopilotStats } from '@/components/autopilot/autopilot-stats';
import { AutopilotKnowledge } from '@/components/autopilot/autopilot-knowledge';
import { AutopilotRules } from '@/components/autopilot/autopilot-rules';
import { AutopilotSettings } from '@/components/autopilot/autopilot-settings';
import { AutopilotPlayground } from '@/components/autopilot/autopilot-playground';
import { AutopilotReadiness } from '@/components/autopilot/autopilot-readiness';
import { AutopilotDecisionInsightsPanel } from '@/components/autopilot/autopilot-decision-insights';
import { AutomationForm } from '@/components/autopilot/automation-form';
import type { AgentEditorPanel } from '@/components/autopilot/autopilot-flow-builder';
import { NativeWorkflowBuilder } from '@/components/workflow/native-workflow-builder';
import { NativeAiBuilderDialog } from '@/components/workflow/native-ai-builder-dialog';
import type { ModelConfiguration, NativeWorkflowTemplate, WorkflowDefinition } from '@/services/workflow-runtime';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import type { AutopilotPlaygroundTrace } from '@/services/autopilot/playground-trace';
import type { RagLabReport } from '@/services/rag/evaluation';

type AgentToolCatalogItem = {
  name: string;
  version: string;
  description: string;
  class: string;
  riskLevel: 'low' | 'medium' | 'high';
  requiresHumanApproval: boolean;
  enabledByDefault: boolean;
  source: 'dialogy' | 'mcp';
  serverId?: string;
  serverName?: string;
  inputSchema?: Record<string, unknown> | null;
  outputSchema?: Record<string, unknown> | null;
};

function inferKnowledgeSourceFormat(filename: string): KnowledgeBaseDocument['sourceFormat'] {
  const extension = filename.split('.').pop()?.toLowerCase();
  if (extension === 'md') return 'markdown';
  if (extension === 'csv') return 'csv';
  if (extension === 'json') return 'json';
  if (extension === 'pdf') return 'pdf';
  return 'plain_text';
}

function generateUUID(): string {
  if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const DEFAULT_KNOWLEDGE_COLLECTION: KnowledgeCollection = {
  id: 'general',
  name: 'Geral',
  description: 'Conteudo compartilhado entre os sub-agentes.',
  isDefault: true,
};

function normalizeKnowledgeCollections(collections?: KnowledgeCollection[] | null): KnowledgeCollection[] {
  const parsed = Array.isArray(collections) ? collections : [];
  return parsed.some((collection) => collection.id === DEFAULT_KNOWLEDGE_COLLECTION.id)
    ? parsed
    : [DEFAULT_KNOWLEDGE_COLLECTION, ...parsed];
}

function normalizeFlowVariableName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[0-9]+/, '');
}

function normalizeSnapshotForSignature(snapshot: AutopilotConfigDraftSnapshot) {
  return {
    ...snapshot,
    name: snapshot.name || '',
    gemini_api_key: null,
    ai_model: snapshot.ai_model || null,
    transcription_model: snapshot.transcription_model || null,
    knowledge_base: snapshot.knowledge_base || null,
    knowledge_base_documents: snapshot.knowledge_base_documents || [],
    knowledge_collections: normalizeKnowledgeCollections(snapshot.knowledge_collections),
    default_fallback_reply: snapshot.default_fallback_reply || null,
    escalation_policy: snapshot.escalation_policy || null,
    closing_policy: snapshot.closing_policy || null,
    inactivity_timeout_seconds: snapshot.inactivity_timeout_seconds || null,
    enabled_tool_names: [...(snapshot.enabled_tool_names || [])].sort(),
    workflow_runtime_v2_mode: snapshot.workflow_runtime_v2_mode || 'off',
    workflow_builder_mode: snapshot.workflow_builder_mode || 'legacy',
    workflow_definition: snapshot.workflow_definition || null,
    workflow_migration: snapshot.workflow_migration || null,
  };
}

function buildSnapshotSignature(snapshot: AutopilotConfigDraftSnapshot | null) {
  return snapshot ? JSON.stringify(normalizeSnapshotForSignature(snapshot)) : '';
}

function buildSnapshotFromConfig(
  config: AutopilotConfig,
  defaultEnabledToolNames: string[],
): AutopilotConfigDraftSnapshot {
  return {
    name: config.name || '',
    gemini_api_key: null,
    ai_model: config.ai_model || null,
    transcription_model: config.transcription_model || null,
    knowledge_base: config.knowledge_base || null,
    knowledge_base_documents: config.knowledge_base_documents || [],
    knowledge_collections: normalizeKnowledgeCollections(config.knowledge_collections),
    is_active: Boolean(config.is_active),
    is_private: Boolean(config.is_private),
    default_fallback_reply: config.default_fallback_reply || null,
    escalation_policy: config.escalation_policy || null,
    closing_policy: config.closing_policy || null,
    inactivity_timeout_seconds: config.inactivity_timeout_seconds || null,
    enabled_tool_names: Array.isArray(config.enabled_tool_names)
      ? config.enabled_tool_names
      : defaultEnabledToolNames,
    flow_graph: config.flow_graph || null,
    workflow_runtime_v2_mode: config.workflow_runtime_v2_mode || 'off',
    workflow_builder_mode: config.workflow_builder_mode || 'legacy',
    workflow_definition: config.workflow_definition || null,
    workflow_migration: null,
  };
}

function normalizeLoadedSnapshot(
  snapshot: AutopilotConfigDraftSnapshot,
  fallback: AutopilotConfigDraftSnapshot,
): AutopilotConfigDraftSnapshot {
  return {
    name: snapshot.name || fallback.name,
    gemini_api_key: null,
    ai_model: snapshot.ai_model || fallback.ai_model,
    transcription_model: snapshot.transcription_model || fallback.transcription_model || null,
    knowledge_base: snapshot.knowledge_base || null,
    knowledge_base_documents: Array.isArray(snapshot.knowledge_base_documents)
      ? snapshot.knowledge_base_documents
      : fallback.knowledge_base_documents,
    knowledge_collections: normalizeKnowledgeCollections(
      Array.isArray(snapshot.knowledge_collections) ? snapshot.knowledge_collections : fallback.knowledge_collections
    ),
    is_active: Boolean(snapshot.is_active),
    is_private: Boolean(snapshot.is_private),
    default_fallback_reply: snapshot.default_fallback_reply || null,
    escalation_policy: snapshot.escalation_policy || null,
    closing_policy: snapshot.closing_policy || null,
    inactivity_timeout_seconds: snapshot.inactivity_timeout_seconds || fallback.inactivity_timeout_seconds || null,
    enabled_tool_names: Array.isArray(snapshot.enabled_tool_names)
      ? snapshot.enabled_tool_names
      : fallback.enabled_tool_names,
    flow_graph: snapshot.flow_graph || fallback.flow_graph || null,
    workflow_runtime_v2_mode: snapshot.workflow_runtime_v2_mode || fallback.workflow_runtime_v2_mode || 'off',
    workflow_builder_mode: snapshot.workflow_builder_mode || fallback.workflow_builder_mode || 'legacy',
    workflow_definition: snapshot.workflow_definition || fallback.workflow_definition || null,
    workflow_migration: snapshot.workflow_migration || fallback.workflow_migration || null,
  };
}

function normalizeTextForVersion(value: string | null | undefined) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function listDiff(previous: string[], next: string[]) {
  const previousSet = new Set(previous);
  const nextSet = new Set(next);
  return {
    added: next.filter((item) => !previousSet.has(item)),
    removed: previous.filter((item) => !nextSet.has(item)),
  };
}

function summarizeVersionChanges(
  version: AutopilotConfigVersionSummary,
  previousVersion: AutopilotConfigVersionSummary | null,
  modelOptions: AiModelCatalogEntry[],
) {
  const snapshot = version.snapshot;
  if (!snapshot) return ['Snapshot nao disponivel para esta versao.'];

  const previous = previousVersion?.snapshot || null;
  if (!previous) {
    return [
      `Primeira publicacao com ${snapshot.knowledge_base_documents.length} documento(s), ${snapshot.enabled_tool_names.length} ferramenta(s) e modelo ${getAiModelLabel(snapshot.ai_model || '', modelOptions)}.`,
    ];
  }

  const changes: string[] = [];

  if (snapshot.name !== previous.name) {
    changes.push(`Nome alterado de "${previous.name}" para "${snapshot.name}".`);
  }

  if (snapshot.ai_model !== previous.ai_model) {
    changes.push(`Modelo alterado de ${getAiModelLabel(previous.ai_model || '', modelOptions)} para ${getAiModelLabel(snapshot.ai_model || '', modelOptions)}.`);
  }

  if (snapshot.is_active !== previous.is_active) {
    changes.push(snapshot.is_active ? 'Agente ativado.' : 'Agente pausado.');
  }

  if (snapshot.is_private !== previous.is_private) {
    changes.push(snapshot.is_private ? 'Visibilidade alterada para privado.' : 'Visibilidade alterada para compartilhado.');
  }

  if (normalizeTextForVersion(snapshot.knowledge_base) !== normalizeTextForVersion(previous.knowledge_base)) {
    changes.push('Persona/prompt base atualizado.');
  }

  if (normalizeTextForVersion(snapshot.default_fallback_reply) !== normalizeTextForVersion(previous.default_fallback_reply)) {
    changes.push('Resposta de fallback atualizada.');
  }

  if (normalizeTextForVersion(snapshot.escalation_policy) !== normalizeTextForVersion(previous.escalation_policy)) {
    changes.push('Politica de escalonamento atualizada.');
  }

  if (normalizeTextForVersion(snapshot.closing_policy) !== normalizeTextForVersion(previous.closing_policy)) {
    changes.push('Politica de encerramento atualizada.');
  }
  if ((snapshot.inactivity_timeout_seconds || null) !== (previous.inactivity_timeout_seconds || null)) {
    changes.push(`Encerramento por inatividade alterado para ${snapshot.inactivity_timeout_seconds ? `${snapshot.inactivity_timeout_seconds}s` : 'desativado'}.`);
  }

  const previousDocNames = previous.knowledge_base_documents.map((doc) => doc.name);
  const nextDocNames = snapshot.knowledge_base_documents.map((doc) => doc.name);
  const docDiff = listDiff(previousDocNames, nextDocNames);
  if (docDiff.added.length > 0) {
    changes.push(`Documentos adicionados: ${docDiff.added.slice(0, 3).join(', ')}${docDiff.added.length > 3 ? ` +${docDiff.added.length - 3}` : ''}.`);
  }
  if (docDiff.removed.length > 0) {
    changes.push(`Documentos removidos: ${docDiff.removed.slice(0, 3).join(', ')}${docDiff.removed.length > 3 ? ` +${docDiff.removed.length - 3}` : ''}.`);
  }

  const toolDiff = listDiff(previous.enabled_tool_names, snapshot.enabled_tool_names);
  if (toolDiff.added.length > 0) {
    changes.push(`Ferramentas habilitadas: ${toolDiff.added.slice(0, 4).join(', ')}${toolDiff.added.length > 4 ? ` +${toolDiff.added.length - 4}` : ''}.`);
  }
  if (toolDiff.removed.length > 0) {
    changes.push(`Ferramentas desabilitadas: ${toolDiff.removed.slice(0, 4).join(', ')}${toolDiff.removed.length > 4 ? ` +${toolDiff.removed.length - 4}` : ''}.`);
  }

  return changes.length > 0 ? changes : ['Publicacao sem mudancas estruturais detectadas no snapshot.'];
}

export default function AutopilotDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const user = useCurrentUser();
  const agentId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<AutopilotConfig | null>(null);
  const [instances, setInstances] = useState<NexusFlowInstance[]>([]);
  const [usageLogs, setUsageLogs] = useState<AutopilotUsageLog[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [modelCatalog, setModelCatalog] = useState<AiModelCatalogEntry[]>([]);
  const [configuredAiModels, setConfiguredAiModels] = useState<AiModelCatalogEntry[]>([]);
  const [toolCatalog, setToolCatalog] = useState<AgentToolCatalogItem[]>([]);
  const [hasGlobalKey, setHasGlobalKey] = useState(false);
  const [workspaceDefaultAiModel, setWorkspaceDefaultAiModel] = useState<string | null>(null);
  const [workspaceHasGeminiConfig, setWorkspaceHasGeminiConfig] = useState(false);

  const [agentName, setAgentName] = useState('');
  const [aiModel, setAiModel] = useState(DEFAULT_AUTOPILOT_MODEL);
  const [isActive, setIsActive] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [isPrimary, setIsPrimary] = useState(false);
  const [workflowRuntimeV2ShadowEnabled, setWorkflowRuntimeV2ShadowEnabled] = useState(false);
  const [knowledgeBase, setKnowledgeBase] = useState('');
  const [defaultFallbackReply, setDefaultFallbackReply] = useState('');
  const [escalationPolicy, setEscalationPolicy] = useState('');
  const [closingPolicy, setClosingPolicy] = useState('');
  const [inactivityTimeoutSeconds, setInactivityTimeoutSeconds] = useState<number | null>(null);
  const [enabledToolNames, setEnabledToolNames] = useState<string[]>([]);
  const [knowledgeDocuments, setKnowledgeDocuments] = useState<KnowledgeBaseDocument[]>([]);
  const [knowledgeCollections, setKnowledgeCollections] = useState<KnowledgeCollection[]>([DEFAULT_KNOWLEDGE_COLLECTION]);
  const [flowGraph, setFlowGraph] = useState<AutopilotFlowGraph | null>(null);
  const [workflowBuilderMode, setWorkflowBuilderMode] = useState<'legacy' | 'native_v2'>('native_v2');
  const [workflowDefinition, setWorkflowDefinition] = useState<WorkflowDefinition | null>(null);
  const [loadedEditorSnapshot, setLoadedEditorSnapshot] = useState<AutopilotConfigDraftSnapshot | null>(null);
  const [draftUpdatedAt, setDraftUpdatedAt] = useState<string | null>(null);
  const [versions, setVersions] = useState<AutopilotConfigVersionSummary[]>([]);

  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isDiscardingDraft, setIsDiscardingDraft] = useState(false);
  const [restoringVersionId, setRestoringVersionId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isRuleModalOpen, setIsRuleModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<NexusFlowInstance | null>(null);
  const [lastPlaygroundTrace, setLastPlaygroundTrace] = useState<AutopilotPlaygroundTrace | null>(null);
  const [editorPanel, setEditorPanel] = useState<AgentEditorPanel | null>(null);
  const [nativeSetupOpen, setNativeSetupOpen] = useState(false);
  const [nativeSetupBusy, setNativeSetupBusy] = useState(false);
  const [nativeMigrationPreview, setNativeMigrationPreview] = useState<{
    workflow: WorkflowDefinition;
    validation: { valid: boolean; errors: Array<{ message: string }> };
    changes: string[];
    warnings: string[];
  } | null>(null);
  const [ragHealth, setRagHealth] = useState<AutopilotRagHealth | null>(null);
  const [isReindexingKnowledge, setIsReindexingKnowledge] = useState(false);
  const [ragLabReport, setRagLabReport] = useState<RagLabReport | null>(null);
  const [isRunningRagLab, setIsRunningRagLab] = useState(false);
  const [decisionInsights, setDecisionInsights] = useState<AutopilotDecisionInsights | null>(null);
  const [isLoadingDecisionInsights, setIsLoadingDecisionInsights] = useState(false);
  const [hasAttemptedDecisionInsightsLoad, setHasAttemptedDecisionInsightsLoad] = useState(false);
  const [decisionInsightsLoadError, setDecisionInsightsLoadError] = useState<string | null>(null);
  const [isRefreshingDecisionInsights, setIsRefreshingDecisionInsights] = useState(false);
  const [reviewingPatternId, setReviewingPatternId] = useState<string | null>(null);
  const [previewingPatternId, setPreviewingPatternId] = useState<string | null>(null);
  const [applicationPreviewPatternId, setApplicationPreviewPatternId] = useState<string | null>(null);
  const [applicationPreview, setApplicationPreview] = useState<AutopilotCausalPatternApplicationPreview | null>(null);
  const [applyingPatternId, setApplyingPatternId] = useState<string | null>(null);
  const [revertingPatternId, setRevertingPatternId] = useState<string | null>(null);
  const [applyingScoreHistoryId, setApplyingScoreHistoryId] = useState<string | null>(null);
  const [importingEcosystemPatternId, setImportingEcosystemPatternId] = useState<string | null>(null);
  const [isAutoTuningDecisionInsights, setIsAutoTuningDecisionInsights] = useState(false);

  const estimateTokens = useCallback((content: string) => {
    const normalized = content?.trim() || '';
    if (normalized.length === 0) return 0;
    return Math.max(1, Math.ceil(normalized.length / 4));
  }, []);

  const selectableModels = useMemo(
    () => configuredAiModels,
    [configuredAiModels]
  );

  const nativeDefaultModel = useMemo<ModelConfiguration>(() => ({
    provider: getAiModelRuntimeProvider(aiModel || DEFAULT_AUTOPILOT_MODEL),
    model: aiModel || DEFAULT_AUTOPILOT_MODEL,
    temperature: 0.2,
    maxOutputTokens: 2048,
    supportsTools: true,
    supportsStructuredOutput: true,
    supportsStreaming: true,
    timeoutMs: 60_000,
    maxRetries: 2,
  }), [aiModel]);

  const fetchData = useCallback(async (options?: { showLoading?: boolean }) => {
    if (!user?.activeWorkspaceId || !agentId) return;

    const showLoading = options?.showLoading ?? true;
    if (showLoading) setLoading(true);
    try {
      const [autopilotData, catalogData, toolCatalogData, ragHealthData] = await Promise.all([
        getAutopilotConfig(user.activeWorkspaceId, agentId),
        getAiModelCatalogAction(),
        getAgentToolCatalogAction(user.activeWorkspaceId),
        getAutopilotRagHealth(agentId),
      ]);

      if (autopilotData.error) {
        toast({ title: 'Erro ao carregar', description: autopilotData.error, variant: 'destructive' });
        router.push('/autopilot');
        return;
      }

      if (!autopilotData.config) {
        router.push('/autopilot');
        return;
      }

      const nextCatalog = catalogData.models || [];
      const nextConfiguredModels = autopilotData.workspaceConfiguredAiModels || [];
      const nextToolCatalog = toolCatalogData.tools || [];
      const nextSelectableModels = nextConfiguredModels;
      const defaultEnabledToolNames = nextToolCatalog
        .filter((tool) => tool.enabledByDefault)
        .map((tool) => tool.name);
      const publishedSnapshot = buildSnapshotFromConfig(autopilotData.config, defaultEnabledToolNames);
      const loadedSnapshot = autopilotData.draft?.snapshot
        ? normalizeLoadedSnapshot(autopilotData.draft.snapshot, publishedSnapshot)
        : publishedSnapshot;
      const savedModel = loadedSnapshot.ai_model || null;
      const fallbackModel = nextSelectableModels[0]?.id || savedModel || DEFAULT_AUTOPILOT_MODEL;
      const selectedModel = savedModel || fallbackModel;
      const editorSnapshot = {
        ...loadedSnapshot,
        ai_model: selectedModel,
      };

      setConfig(autopilotData.config);
      setInstances(autopilotData.rules || []);
      setWorkspace(autopilotData.workspace || null);
      setHasGlobalKey(!!autopilotData.hasGlobalKey);
      setWorkspaceDefaultAiModel(autopilotData.workspaceDefaultAiModel || null);
      setWorkspaceHasGeminiConfig(Boolean(autopilotData.workspaceHasGeminiConfig));
      setModelCatalog(nextCatalog);
      setConfiguredAiModels(nextConfiguredModels);
      setToolCatalog(nextToolCatalog);
      setDraftUpdatedAt(autopilotData.draft?.updated_at || null);
      setVersions(autopilotData.versions || []);
      setLoadedEditorSnapshot(editorSnapshot);

      setAgentName(editorSnapshot.name || '');
      setAiModel(selectedModel);
      setIsActive(Boolean(editorSnapshot.is_active));
      setIsPrivate(Boolean(editorSnapshot.is_private));
      setIsPrimary(Boolean(autopilotData.config.is_primary));
      setWorkflowRuntimeV2ShadowEnabled(editorSnapshot.workflow_runtime_v2_mode === 'shadow');
      setKnowledgeBase(editorSnapshot.knowledge_base || '');
      setDefaultFallbackReply(editorSnapshot.default_fallback_reply || '');
      setEscalationPolicy(editorSnapshot.escalation_policy || '');
      setClosingPolicy(editorSnapshot.closing_policy || '');
      setInactivityTimeoutSeconds(editorSnapshot.inactivity_timeout_seconds || null);
      setEnabledToolNames(editorSnapshot.enabled_tool_names || []);
      setKnowledgeDocuments(editorSnapshot.knowledge_base_documents || []);
      setKnowledgeCollections(normalizeKnowledgeCollections(editorSnapshot.knowledge_collections));
      setFlowGraph(editorSnapshot.flow_graph || null);
      setWorkflowBuilderMode('native_v2');
      setWorkflowDefinition(editorSnapshot.workflow_definition || null);
      setRagHealth(ragHealthData.health || null);

      const logsData = await getAutopilotUsageLogs(autopilotData.config.id);
      setUsageLogs(logsData.logs || []);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [agentId, router, toast, user?.activeWorkspaceId]);

  useEffect(() => {
    if (user?.activeWorkspaceId && agentId) {
      void fetchData();
    }
  }, [fetchData, user?.activeWorkspaceId, agentId]);

  const currentEditorSnapshot = useMemo<AutopilotConfigDraftSnapshot>(() => ({
    name: agentName,
    gemini_api_key: null,
    ai_model: aiModel || null,
    transcription_model: config?.transcription_model || null,
    knowledge_base: knowledgeBase || null,
    knowledge_base_documents: knowledgeDocuments,
    knowledge_collections: knowledgeCollections,
    is_active: isActive,
    is_private: isPrivate,
    default_fallback_reply: defaultFallbackReply || null,
    escalation_policy: escalationPolicy || null,
    closing_policy: closingPolicy || null,
    inactivity_timeout_seconds: inactivityTimeoutSeconds || null,
    enabled_tool_names: enabledToolNames,
    flow_graph: flowGraph,
    workflow_runtime_v2_mode: workflowRuntimeV2ShadowEnabled ? 'shadow' : 'off',
    workflow_builder_mode: workflowBuilderMode,
    workflow_definition: workflowDefinition,
    workflow_migration: loadedEditorSnapshot?.workflow_migration || null,
  }), [
    agentName,
    aiModel,
    closingPolicy,
    config?.transcription_model,
    defaultFallbackReply,
    enabledToolNames,
    escalationPolicy,
    inactivityTimeoutSeconds,
    isActive,
    isPrivate,
    knowledgeBase,
    knowledgeDocuments,
    knowledgeCollections,
    flowGraph,
    workflowBuilderMode,
    workflowDefinition,
    loadedEditorSnapshot?.workflow_migration,
    workflowRuntimeV2ShadowEnabled,
  ]);

  const currentSnapshotSignature = useMemo(
    () => buildSnapshotSignature(currentEditorSnapshot),
    [currentEditorSnapshot]
  );
  const loadedSnapshotSignature = useMemo(
    () => buildSnapshotSignature(loadedEditorSnapshot),
    [loadedEditorSnapshot]
  );

  const isDirty = useMemo(() => {
    if (!config || !loadedSnapshotSignature) return false;
    return currentSnapshotSignature !== loadedSnapshotSignature;
  }, [config, currentSnapshotSignature, loadedSnapshotSignature]);

  const hasDraft = Boolean(draftUpdatedAt);
  const hasUnpublishedChanges = hasDraft || isDirty;
  const previewDraftSnapshot = currentEditorSnapshot;

  const buildConfigFormData = useCallback(() => {
    if (!config || !user?.activeWorkspaceId) return null;

    const formData = new FormData();
    formData.append('workspaceId', user.activeWorkspaceId);
    formData.append('configId', config.id);
    formData.append('agentName', agentName);
    formData.append('aiModel', aiModel);
    formData.append('isActive', isActive ? 'on' : 'off');
    formData.append('isPrivate', isPrivate ? 'on' : 'off');
    formData.append('knowledgeBase', knowledgeBase);
    formData.append('defaultFallbackReply', defaultFallbackReply);
    formData.append('escalationPolicy', escalationPolicy);
    formData.append('closingPolicy', closingPolicy);
    formData.append('inactivityTimeoutSeconds', inactivityTimeoutSeconds ? String(inactivityTimeoutSeconds) : '');
    formData.append('enabledToolNames', JSON.stringify(enabledToolNames));
    formData.append('knowledgeBaseDocuments', JSON.stringify(knowledgeDocuments));
    formData.append('knowledgeCollections', JSON.stringify(knowledgeCollections));
    formData.append('flowGraph', JSON.stringify(flowGraph));
    formData.append('workflowRuntimeV2Mode', workflowRuntimeV2ShadowEnabled ? 'shadow' : 'off');
    formData.append('workflowBuilderMode', workflowBuilderMode);
    formData.append('workflowDefinition', JSON.stringify(workflowDefinition));
    return formData;
  }, [
    agentName,
    aiModel,
    closingPolicy,
    config,
    defaultFallbackReply,
    enabledToolNames,
    escalationPolicy,
    inactivityTimeoutSeconds,
    isActive,
    isPrivate,
    knowledgeBase,
    knowledgeDocuments,
    knowledgeCollections,
    flowGraph,
    workflowBuilderMode,
    workflowDefinition,
    workflowRuntimeV2ShadowEnabled,
    user?.activeWorkspaceId,
  ]);

  const handleSaveConfig = async () => {
    const formData = buildConfigFormData();
    if (!formData) return;

    setIsSaving(true);
    try {
      const result = await saveAutopilotDraft({ success: false }, formData);

      if (result.success) {
        toast({ title: 'Rascunho salvo', description: 'Teste e compare antes de publicar para os clientes.' });
        setLastPlaygroundTrace(null);
        setLoadedEditorSnapshot(currentEditorSnapshot);
        setDraftUpdatedAt(result.updatedAt || new Date().toISOString());
      } else {
        toast({ title: 'Erro ao salvar rascunho', description: result.error, variant: 'destructive' });
      }
    } catch (error: any) {
      toast({ title: 'Erro inesperado', description: error.message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const handlePublishConfig = async () => {
    if (!config) return;

    setIsPublishing(true);
    try {
      if (isDirty) {
        const formData = buildConfigFormData();
        if (!formData) return;

        const draftResult = await saveAutopilotDraft({ success: false }, formData);
        if (!draftResult.success) {
          toast({ title: 'Erro ao salvar rascunho', description: draftResult.error, variant: 'destructive' });
          return;
        }
      }

      const result = await publishAutopilotDraft(config.id);
      if (result.success) {
        toast({
          title: workflowBuilderMode === 'native_v2' ? 'Automação publicada' : 'Agente publicado',
          description: result.versionNumber ? `Versao v${result.versionNumber} publicada.` : 'Rascunho promovido para producao.',
        });
        setLastPlaygroundTrace(null);
        await fetchData({ showLoading: false });
      } else {
        toast({ title: 'Erro ao publicar', description: result.error, variant: 'destructive' });
      }
    } catch (error: any) {
      toast({ title: 'Erro inesperado', description: error.message, variant: 'destructive' });
    } finally {
      setIsPublishing(false);
    }
  };

  const handleDiscardDraft = async () => {
    if (!config) return;
    if (hasDraft && !confirm('Descartar o rascunho atual e voltar ao publicado?')) return;

    setIsDiscardingDraft(true);
    try {
      if (hasDraft) {
        const result = await discardAutopilotDraft(config.id);
        if (!result.success) {
          toast({ title: 'Erro ao descartar', description: result.error, variant: 'destructive' });
          return;
        }
      }
      setLastPlaygroundTrace(null);
      await fetchData({ showLoading: false });
      toast({ title: 'Rascunho descartado', description: 'A tela voltou para a versao publicada.' });
    } catch (error: any) {
      toast({ title: 'Erro inesperado', description: error.message, variant: 'destructive' });
    } finally {
      setIsDiscardingDraft(false);
    }
  };

  const handleRestoreVersion = async (versionId: string, versionNumber: number) => {
    if (!config) return;
    if (!confirm(`Restaurar a versao v${versionNumber}? A configuracao atual sera substituida e um novo ponto no historico sera criado.`)) return;

    setRestoringVersionId(versionId);
    try {
      const result = await restoreAutopilotVersion(config.id, versionId);
      if (result.success) {
        toast({
          title: 'Versao restaurada',
          description: result.versionNumber
            ? `Rollback publicado como v${result.versionNumber}.`
            : `A versao v${versionNumber} foi restaurada.`,
        });
        setLastPlaygroundTrace(null);
        await fetchData({ showLoading: false });
      } else {
        toast({ title: 'Erro ao restaurar versao', description: result.error, variant: 'destructive' });
      }
    } catch (error: any) {
      toast({ title: 'Erro inesperado', description: error.message, variant: 'destructive' });
    } finally {
      setRestoringVersionId(null);
    }
  };

  const handleKnowledgeUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    setIsUploading(true);
    try {
      const additions: KnowledgeBaseDocument[] = [];
      for (const file of Array.from(files)) {
        let text = '';
        const sourceFormat = inferKnowledgeSourceFormat(file.name);

        if (sourceFormat === 'pdf' || file.type === 'application/pdf') {
          // Import dynamic to avoid breaking SSR
          const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
          pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/legacy/build/pdf.worker.mjs`;

          const arrayBuffer = await file.arrayBuffer();
          const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
          const totalPages = pdf.numPages;

          for (let i = 1; i <= totalPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            // @ts-ignore
            const pageText = textContent.items.map((item) => item.str).join(' ');
            text += pageText + '\\n\\n';

            // Yield to event loop to avoid freezing UI for large PDFs
            if (i % 10 === 0) {
              await new Promise((resolve) => setTimeout(resolve, 0));
            }
          }
          text = text.trim();
        } else {
          text = (await file.text()).trim();
        }

        additions.push({
          id: generateUUID(),
          name: file.name,
          content: text,
          sourceFormat,
          originalFilename: file.name,
          tokens: estimateTokens(text),
        });
      }
      setKnowledgeDocuments((prev) => [...prev, ...additions]);
      toast({ title: 'Arquivos carregados', description: 'Revise e salve para reindexar o agente.' });
    } catch (error) {
      console.error('Error parsing file:', error);
      toast({ title: 'Falha ao ler arquivos', variant: 'destructive' });
    } finally {
      setIsUploading(false);
    }
  };

  const handleAddManualDoc = () => {
    const newDoc: KnowledgeBaseDocument = {
      id: generateUUID(),
      name: `Nota ${(knowledgeDocuments.length + 1).toString().padStart(2, '0')}`,
      content: '',
      sourceFormat: 'markdown',
      tokens: 0,
    };
    setKnowledgeDocuments((prev) => [...prev, newDoc]);
  };

  const handleUpdateDoc = (id: string, content: string) => {
    setKnowledgeDocuments((prev) =>
      prev.map((doc) => (doc.id === id ? { ...doc, content, tokens: estimateTokens(content) } : doc))
    );
  };

  const handleUpdateDocName = (id: string, name: string) => {
    setKnowledgeDocuments((prev) => prev.map((doc) => (doc.id === id ? { ...doc, name } : doc)));
  };

  const handleUpdateDocCategory = (id: string, category: string) => {
    const normalizedCategory = category.trim() || null;
    setKnowledgeDocuments((prev) =>
      prev.map((doc) => (doc.id === id ? { ...doc, category: normalizedCategory } : doc))
    );
  };

  const handleUpdateDocMaxPromptChars = (id: string, maxPromptChars: number | null) => {
    setKnowledgeDocuments((prev) =>
      prev.map((doc) => (doc.id === id ? { ...doc, maxPromptChars } : doc))
    );
  };

  const handleUpdateDocMetadata = (
    id: string,
    patch: Partial<Pick<KnowledgeBaseDocument, 'summary' | 'tags' | 'contextRole' | 'canonicalAnswer' | 'workflowHints'>>
  ) => {
    setKnowledgeDocuments((prev) =>
      prev.map((doc) => (doc.id === id ? { ...doc, ...patch } : doc))
    );
  };

  const handleUpdateDocCollections = (id: string, collectionIds: string[]) => {
    setKnowledgeDocuments((prev) =>
      prev.map((doc) => (doc.id === id ? { ...doc, collectionIds } : doc))
    );
  };

  const handleImproveKnowledgeDocument = async (document: KnowledgeBaseDocument) => {
    if (!config) return;
    const result = await improveAutopilotKnowledgeDocument(config.id, document);
    if (!result.document) {
      toast({ title: 'Falha ao melhorar documento', description: result.error, variant: 'destructive' });
      return;
    }
    setKnowledgeDocuments((previous) => previous.map((item) => {
      if (item.id !== document.id) return item;
      const improvedDocument = result.document!;
      return {
        ...item,
        ...improvedDocument,
        id: item.id,
        collectionIds: item.collectionIds,
        maxPromptChars: item.maxPromptChars,
        tokens: estimateTokens(improvedDocument.content),
      };
    }));
    toast({
      title: 'Documento otimizado para RAG',
      description: 'Revise o Markdown gerado e salve o agente para reindexar.',
    });
  };

  const handleAddKnowledgeCollection = (name: string) => {
    const normalized = name.trim();
    if (!normalized) return false;
    if (knowledgeCollections.some((collection) => collection.name.toLowerCase() === normalized.toLowerCase())) return false;
    setKnowledgeCollections((prev) => prev.concat({
      id: generateUUID(),
      name: normalized,
    }));
    return true;
  };

  const handleRemoveKnowledgeCollection = (id: string) => {
    if (id === DEFAULT_KNOWLEDGE_COLLECTION.id) return;
    setKnowledgeCollections((prev) => prev.filter((collection) => collection.id !== id));
    setKnowledgeDocuments((prev) => prev.map((doc) => ({
      ...doc,
      collectionIds: (doc.collectionIds || []).filter((collectionId) => collectionId !== id),
    })));
    setFlowGraph((previous) => previous ? {
      ...previous,
      nodes: previous.nodes.map((node) => node.kind !== 'intent' ? node : ({
        ...node,
        config: {
          ...node.config,
          knowledgeCollectionIds: node.config?.knowledgeCollectionIds?.includes(id)
            ? node.config.knowledgeCollectionIds.filter((collectionId) => collectionId !== id).length > 0
              ? node.config.knowledgeCollectionIds.filter((collectionId) => collectionId !== id)
              : ['general']
            : node.config?.knowledgeCollectionIds,
        },
      })),
    } : previous);
  };

  const handleRemoveDoc = (id: string) => {
    setKnowledgeDocuments((prev) => prev.filter((doc) => doc.id !== id));
  };

  const handleReindexKnowledgeBase = async () => {
    if (!config) return;
    setIsReindexingKnowledge(true);
    try {
      const result = await reindexAutopilotKnowledgeBase(config.id);
      if (!result.success) {
        toast({ title: 'Erro ao reindexar', description: result.error, variant: 'destructive' });
        return;
      }
      toast({
        title: 'Reindexacao iniciada',
        description: `${result.queued || 0} documento(s) enviados para indexacao.`,
      });
      const healthResult = await getAutopilotRagHealth(config.id);
      setRagHealth(healthResult.health || null);
    } finally {
      setIsReindexingKnowledge(false);
    }
  };

  const handleRunRagLab = async () => {
    if (!config) return;
    setIsRunningRagLab(true);
    try {
      const result = await runAutopilotRagLab(config.id);
      if (!result.report) {
        toast({ title: 'Erro no laboratorio', description: result.error, variant: 'destructive' });
        return;
      }
      setRagLabReport(result.report);
      const healthResult = await getAutopilotRagHealth(config.id);
      setRagHealth(healthResult.health || null);
      toast({
        title: 'Laboratorio concluido',
        description: `${result.report.passed}/${result.report.total} casos aprovados.`,
      });
    } finally {
      setIsRunningRagLab(false);
    }
  };

  const loadDecisionInsights = useCallback(async (options?: { silent?: boolean }) => {
    const configId = config?.id || agentId;
    if (!configId) return;

    setHasAttemptedDecisionInsightsLoad(true);
    if (!options?.silent) setIsLoadingDecisionInsights(true);
    try {
      const result = await getAutopilotDecisionInsights(configId);
      if (!result.insights) {
        const message = result.error || 'Nao foi possivel carregar os aprendizados do agente.';
        setDecisionInsightsLoadError(message);
        toast({
          title: 'Erro ao carregar motor',
          description: message,
          variant: 'destructive',
        });
        return;
      }
      setDecisionInsightsLoadError(null);
      setDecisionInsights(result.insights);
    } finally {
      if (!options?.silent) setIsLoadingDecisionInsights(false);
    }
  }, [agentId, config?.id, toast]);

  const handleRefreshDecisionInsights = useCallback(async () => {
    if (!config) return;

    setIsRefreshingDecisionInsights(true);
    try {
      const result = await refreshAutopilotDecisionPatterns(config.id);
      if (!result.success) {
        setDecisionInsightsLoadError(result.error || 'Falha ao atualizar aprendizados do agente.');
        toast({
          title: 'Falha ao atualizar aprendizados',
          description: result.error,
          variant: 'destructive',
        });
        return;
      }
      setHasAttemptedDecisionInsightsLoad(true);
      setDecisionInsightsLoadError(null);
      setDecisionInsights(result.insights || null);
      toast({ title: 'Aprendizados atualizados', description: 'O motor recalculou os padroes recentes do agente.' });
    } finally {
      setIsRefreshingDecisionInsights(false);
    }
  }, [config, toast]);

  const handleReviewDecisionPattern = useCallback(async (patternId: string, decision: 'approve' | 'dismiss') => {
    if (!config) return;

    setReviewingPatternId(patternId);
    try {
      const result = await reviewAutopilotCausalPattern({
        configId: config.id,
        patternId,
        decision,
      });
      if (!result.success) {
        toast({ title: 'Falha ao revisar sugestao', description: result.error, variant: 'destructive' });
        return;
      }
      setDecisionInsights(result.insights || null);
      if (applicationPreviewPatternId === patternId) {
        setApplicationPreviewPatternId(null);
        setApplicationPreview(null);
      }
      toast({ title: decision === 'approve' ? 'Sugestao aprovada' : 'Sugestao ignorada' });
    } finally {
      setReviewingPatternId(null);
    }
  }, [applicationPreviewPatternId, config, toast]);

  const handlePreviewDecisionPattern = useCallback(async (patternId: string) => {
    if (!config) return;

    setPreviewingPatternId(patternId);
    try {
      const result = await previewAutopilotCausalPatternApplication({
        configId: config.id,
        patternId,
      });
      if (!result.success) {
        toast({ title: 'Falha ao gerar preview', description: result.error, variant: 'destructive' });
        return;
      }
      setApplicationPreviewPatternId(patternId);
      setApplicationPreview(result.preview || null);
    } finally {
      setPreviewingPatternId(null);
    }
  }, [config, toast]);

  const handleApplyDecisionPattern = useCallback(async (
    patternId: string,
    applicationMode?: 'full' | 'knowledge_only',
  ) => {
    if (!config) return;

    setApplyingPatternId(patternId);
    try {
      const result = await applyAutopilotCausalPattern({
        configId: config.id,
        patternId,
        applicationMode,
      });
      if (!result.success) {
        toast({ title: 'Falha ao aplicar sugestao', description: result.error, variant: 'destructive' });
        return;
      }
      setDecisionInsights(result.insights || null);
      setApplicationPreviewPatternId(null);
      setApplicationPreview(null);
      if (result.draftUpdatedAt) setDraftUpdatedAt(result.draftUpdatedAt);
      await fetchData({ showLoading: false });
      toast({ title: 'Sugestao aplicada ao rascunho', description: 'Revise o flow e publique quando estiver pronto.' });
    } finally {
      setApplyingPatternId(null);
    }
  }, [config, fetchData, toast]);

  const handleRevertDecisionPattern = useCallback(async (patternId: string) => {
    if (!config) return;
    if (!confirm('Reverter esta sugestao aplicada no rascunho?')) return;

    setRevertingPatternId(patternId);
    try {
      const result = await revertAutopilotCausalPatternApplication({
        configId: config.id,
        patternId,
      });
      if (!result.success) {
        toast({ title: 'Falha ao reverter sugestao', description: result.error, variant: 'destructive' });
        return;
      }
      setDecisionInsights(result.insights || null);
      if (result.draftUpdatedAt) setDraftUpdatedAt(result.draftUpdatedAt);
      await fetchData({ showLoading: false });
      toast({ title: 'Sugestao revertida', description: 'O rascunho foi atualizado com a reversao.' });
    } finally {
      setRevertingPatternId(null);
    }
  }, [config, fetchData, toast]);

  const handleApplyDecisionScoreHistory = useCallback(async (scoreHistoryId: string) => {
    if (!config) return;

    setApplyingScoreHistoryId(scoreHistoryId);
    try {
      const result = await applyAutopilotScoreSuggestion({
        configId: config.id,
        scoreHistoryId,
      });
      if (!result.success) {
        toast({ title: 'Falha ao aplicar pesos', description: result.error, variant: 'destructive' });
        return;
      }
      setDecisionInsights(result.insights || null);
      toast({ title: 'Pesos aplicados', description: 'O motor de decisao usara os novos pesos nas proximas execucoes.' });
    } finally {
      setApplyingScoreHistoryId(null);
    }
  }, [config, toast]);

  const handleImportDecisionEcosystemPattern = useCallback(async (ecosystemPatternId: string) => {
    if (!config) return;

    setImportingEcosystemPatternId(ecosystemPatternId);
    try {
      const result = await importAutopilotEcosystemPattern({
        configId: config.id,
        ecosystemPatternId,
      });
      if (!result.success) {
        toast({ title: 'Falha ao importar sugestao', description: result.error, variant: 'destructive' });
        return;
      }
      setDecisionInsights(result.insights || null);
      toast({ title: 'Sugestao importada', description: 'Ela entrou na lista de padroes deste workspace.' });
    } finally {
      setImportingEcosystemPatternId(null);
    }
  }, [config, toast]);

  const handleSafeDecisionAutoTune = useCallback(async () => {
    if (!config) return;

    setIsAutoTuningDecisionInsights(true);
    try {
      const result = await applySafeAutopilotCausalPatternAutoTune({ configId: config.id });
      if (!result.success) {
        toast({ title: 'Auto-tune nao aplicado', description: result.error, variant: 'destructive' });
        return;
      }
      setDecisionInsights(result.insights || null);
      if (result.draftUpdatedAt) setDraftUpdatedAt(result.draftUpdatedAt);
      await fetchData({ showLoading: false });
      toast({
        title: 'Auto-tune aplicado ao rascunho',
        description: `${result.appliedCount || 0} melhoria(s) aplicada(s), ${result.skippedCount || 0} ignorada(s).`,
      });
    } finally {
      setIsAutoTuningDecisionInsights(false);
    }
  }, [config, fetchData, toast]);

  useEffect(() => {
    if (
      editorPanel !== 'decision'
      || decisionInsights
      || isLoadingDecisionInsights
      || hasAttemptedDecisionInsightsLoad
    ) return;
    void loadDecisionInsights();
  }, [decisionInsights, editorPanel, hasAttemptedDecisionInsightsLoad, isLoadingDecisionInsights, loadDecisionInsights]);

  const upsertRuleFlowNode = (rule: NexusFlowInstance) => {
    const nodeId = `rule-${rule.id}`;
    setFlowGraph((previous) => {
      if (!previous) return previous;
      const existingIndex = previous.nodes.findIndex((node) => node.id === nodeId);
      const nextNode = {
        id: nodeId,
        kind: 'rule' as const,
        title: rule.name,
        subtitle: rule.enabled ? 'Habilidade ativa' : 'Habilidade pausada',
        position: existingIndex >= 0
          ? previous.nodes[existingIndex].position
          : { x: 720, y: 350 + previous.nodes.filter((node) => node.kind === 'rule').length * 150 },
        config: {
          instructions: rule.trigger,
          variableName: `regra_${normalizeFlowVariableName(rule.name) || 'ativa'}`,
        },
      };

      return {
        ...previous,
        nodes: existingIndex >= 0
          ? previous.nodes.map((node) => (node.id === nodeId ? { ...node, ...nextNode } : node))
          : [...previous.nodes, nextNode],
      };
    });
  };

  const handleRuleSaved = (rule?: NexusFlowInstance) => {
    if (!rule) {
      setIsRuleModalOpen(false);
      return;
    }
    setInstances((prev) => {
      const exists = prev.some((item) => item.id === rule.id);
      return exists
        ? prev.map((item) => (item.id === rule.id ? rule : item))
        : [...prev, rule].sort((a, b) => a.name.localeCompare(b.name));
    });
    upsertRuleFlowNode(rule);
    setEditingRule(null);
    setIsRuleModalOpen(false);
  };

  const handleToggleRule = async (id: string, enabled: boolean) => {
    const result = await toggleAutopilotRule(id, enabled);
    if (result.success) {
      setInstances((prev) => prev.map((rule) => {
        if (rule.id !== id) return rule;
        const nextRule = { ...rule, enabled };
        upsertRuleFlowNode(nextRule);
        return nextRule;
      }));
      toast({ title: enabled ? 'Regra ativada' : 'Regra desativada' });
    }
  };

  const handleDeleteRule = async (id: string) => {
    if (!confirm('Excluir esta regra permanentemente?')) return;
    const result = await deleteAutopilotRule(id);
    if (result.success) {
      setInstances((prev) => prev.filter((rule) => rule.id !== id));
      setFlowGraph((previous) => previous ? {
        ...previous,
        nodes: previous.nodes.filter((node) => node.id !== `rule-${id}`),
        edges: previous.edges.filter((edge) => edge.source !== `rule-${id}` && edge.target !== `rule-${id}`),
      } : previous);
      toast({ title: 'Regra removida' });
    }
  };

  const handleDeleteAgent = async () => {
    if (!config || !confirm('Tem certeza? Isso apagará este agente e todas as suas automações.')) return;

    const result = await deleteAutopilotAgent(config.id);
    if (result.success) {
      toast({ title: 'Agente excluído' });
      router.push('/autopilot');
    } else {
      toast({ title: 'Erro ao excluir', description: result.error, variant: 'destructive' });
    }
  };

  const handleSetPrimary = async () => {
    if (!config || !user?.activeWorkspaceId) return;
    const result = await setPrimaryAutopilotAgent(config.id);
    if (result.success) {
      toast({ title: 'Agente definido como principal' });
      await fetchData({ showLoading: false });
    } else {
      toast({ title: 'Erro ao definir principal', description: result.error, variant: 'destructive' });
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!config) return null;

  const handlePreviewNativeMigration = async () => {
    if (!config) return;
    setNativeSetupBusy(true);
    try {
      const result = await previewAutopilotNativeWorkflowMigration(config.id);
      if (!result.workflow || !result.validation) {
        toast({ title: 'Migração indisponível', description: result.error, variant: 'destructive' });
        return;
      }
      setNativeMigrationPreview({
        workflow: result.workflow,
        validation: result.validation,
        changes: result.changes || [],
        warnings: result.warnings || [],
      });
      setNativeSetupOpen(true);
    } finally {
      setNativeSetupBusy(false);
    }
  };

  const handleApplyNativeMigration = async () => {
    if (!config) return;
    setNativeSetupBusy(true);
    try {
      const result = await applyAutopilotNativeWorkflowMigration(config.id);
      if (!result.success || !result.workflow) {
        toast({ title: 'Falha ao migrar', description: result.error, variant: 'destructive' });
        return;
      }
      setWorkflowDefinition(result.workflow);
      setWorkflowBuilderMode('native_v2');
      setWorkflowRuntimeV2ShadowEnabled(true);
      setDraftUpdatedAt(result.updatedAt || new Date().toISOString());
      setNativeSetupOpen(false);
      toast({ title: 'Flowbuilder nativo ativado', description: 'O grafo legado foi preservado para rollback.' });
    } finally {
      setNativeSetupBusy(false);
    }
  };

  const handleCreateNativeTemplate = async (template: NativeWorkflowTemplate) => {
    if (!config) return;
    setNativeSetupBusy(true);
    try {
      const result = await createAutopilotNativeWorkflowDraft({ configId: config.id, template });
      if (!result.success || !result.workflow) {
        toast({ title: 'Falha ao criar automação', description: result.error, variant: 'destructive' });
        return;
      }
      setWorkflowDefinition(result.workflow);
      setWorkflowBuilderMode('native_v2');
      setWorkflowRuntimeV2ShadowEnabled(true);
      setDraftUpdatedAt(result.updatedAt || new Date().toISOString());
      setNativeSetupOpen(false);
      toast({ title: 'Automação nativa criada', description: 'Configure os blocos e publique quando a validação estiver verde.' });
    } finally {
      setNativeSetupBusy(false);
    }
  };

  const handleOpenEditorPanel = (panel: AgentEditorPanel) => {
    const inlinePanels: AgentEditorPanel[] = ['knowledge', 'capabilities', 'analytics', 'decision', 'settings'];
    setEditorPanel((current) => (current === panel && inlinePanels.includes(panel) ? null : panel));
  };

  const renderInlinePanelFrame = (input: {
    eyebrow: string;
    title: string;
    description: string;
    icon: React.ReactNode;
    accentClassName: string;
    children: React.ReactNode;
  }) => (
    <div className="mx-auto flex w-full max-w-[1380px] flex-col gap-5 text-slate-100">
      <div className="flex flex-col gap-4 rounded-[28px] border border-white/[0.08] bg-[#15171a]/85 px-6 py-5 shadow-2xl backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]', input.accentClassName)}>
            {input.icon}
            {input.eyebrow}
          </div>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white">{input.title}</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
            {input.description}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => setEditorPanel(null)}
          className="rounded-xl border-white/10 bg-[#111316] text-slate-200 hover:bg-white/5 hover:text-white"
        >
          <X className="mr-2 h-4 w-4" />
          Voltar ao fluxo
        </Button>
      </div>
      {input.children}
    </div>
  );

  const inlineEditorPanel = (() => {
    if (editorPanel === 'knowledge') {
      return renderInlinePanelFrame({
        eyebrow: 'Base do agente',
        title: 'Base de conhecimento',
        description: 'Organize documentos, colecoes e saude do indice sem sair do fluxo visual do atendente.',
        icon: <BookOpen className="h-3.5 w-3.5" />,
        accentClassName: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
        children: (
      <AutopilotKnowledge
        documents={knowledgeDocuments}
        collections={knowledgeCollections}
        toolCatalog={toolCatalog}
        onUpload={handleKnowledgeUpload}
        onRemove={handleRemoveDoc}
        onUpdateContent={handleUpdateDoc}
        onUpdateName={handleUpdateDocName}
        onUpdateCategory={handleUpdateDocCategory}
        onUpdateMaxPromptChars={handleUpdateDocMaxPromptChars}
        onUpdateMetadata={handleUpdateDocMetadata}
        onUpdateCollections={handleUpdateDocCollections}
        onAddCollection={handleAddKnowledgeCollection}
        onRemoveCollection={handleRemoveKnowledgeCollection}
        onAddManual={handleAddManualDoc}
        onImproveDocument={handleImproveKnowledgeDocument}
        isUploading={isUploading}
        ragHealth={ragHealth}
        onReindex={handleReindexKnowledgeBase}
        isReindexing={isReindexingKnowledge}
        ragLabReport={ragLabReport}
        onRunRagLab={handleRunRagLab}
        isRunningRagLab={isRunningRagLab}
      />
        ),
      });
    }

    if (editorPanel === 'capabilities') {
      return renderInlinePanelFrame({
        eyebrow: 'Ferramentas do atendimento',
        title: 'Ferramentas e habilidades',
        description: 'Configure tools, automacoes e habilidades que o agente pode acionar durante o atendimento.',
        icon: <Wrench className="h-3.5 w-3.5" />,
        accentClassName: 'border-sky-500/25 bg-sky-500/10 text-sky-300',
        children: (
          <div className="rounded-[28px] border border-white/[0.08] bg-[#15171a]/85 p-5 shadow-2xl backdrop-blur sm:p-6">
            <AutopilotRules
              rules={instances}
              toolCatalog={toolCatalog}
              enabledToolNames={enabledToolNames}
              setEnabledToolNames={setEnabledToolNames}
              onSaveTools={handleSaveConfig}
              isSavingTools={isSaving}
              onAdd={() => {
                setEditingRule(null);
                setIsRuleModalOpen(true);
              }}
              onEdit={(rule) => {
                setEditingRule(rule);
                setIsRuleModalOpen(true);
              }}
              onDelete={handleDeleteRule}
              onToggle={handleToggleRule}
            />
          </div>
        ),
      });
    }

    if (editorPanel === 'analytics') {
      return renderInlinePanelFrame({
        eyebrow: 'Fluxo e desempenho',
        title: 'Analise do agente',
        description: 'Acompanhe uso, sinais de execucao e historico operacional sem sair do construtor visual.',
        icon: <GitBranch className="h-3.5 w-3.5" />,
        accentClassName: 'border-violet-500/25 bg-violet-500/10 text-violet-300',
        children: (
          <div className="rounded-[28px] border border-white/[0.08] bg-[#15171a]/85 p-5 shadow-2xl backdrop-blur sm:p-6">
            <AutopilotStats usageLogs={usageLogs} loading={loading} />
          </div>
        ),
      });
    }

    if (editorPanel === 'decision') {
      return renderInlinePanelFrame({
        eyebrow: 'Motor auto evolutivo',
        title: 'Ledger, padroes e auto-tune',
        description: 'Veja decisoes reais, resultados observados e melhorias seguras que o agente pode aplicar no rascunho.',
        icon: <BrainCircuit className="h-3.5 w-3.5" />,
        accentClassName: 'border-violet-500/25 bg-violet-500/10 text-violet-300',
        children: (
          <div className="rounded-[28px] border border-white/[0.08] bg-[#15171a]/85 p-5 shadow-2xl backdrop-blur sm:p-6">
            {decisionInsightsLoadError && (
              <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100 sm:flex-row sm:items-center sm:justify-between">
                <span>{decisionInsightsLoadError}</span>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void loadDecisionInsights()}
                  disabled={isLoadingDecisionInsights}
                  className="w-fit rounded-xl border-red-500/30 bg-red-950/30 text-red-100 hover:bg-red-900/35 hover:text-white"
                >
                  {isLoadingDecisionInsights ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Tentar novamente
                </Button>
              </div>
            )}
            <AutopilotDecisionInsightsPanel
              insights={decisionInsights}
              loading={isLoadingDecisionInsights}
              refreshing={isRefreshingDecisionInsights}
              reviewingPatternId={reviewingPatternId}
              previewingPatternId={previewingPatternId}
              applicationPreviewPatternId={applicationPreviewPatternId}
              applicationPreview={applicationPreview}
              applyingPatternId={applyingPatternId}
              revertingPatternId={revertingPatternId}
              applyingScoreHistoryId={applyingScoreHistoryId}
              importingEcosystemPatternId={importingEcosystemPatternId}
              autoTuning={isAutoTuningDecisionInsights}
              onRefresh={handleRefreshDecisionInsights}
              onReviewPattern={handleReviewDecisionPattern}
              onPreviewPattern={handlePreviewDecisionPattern}
              onClearPreview={() => {
                setApplicationPreviewPatternId(null);
                setApplicationPreview(null);
              }}
              onApplyPattern={handleApplyDecisionPattern}
              onRevertPattern={handleRevertDecisionPattern}
              onApplyScoreHistory={handleApplyDecisionScoreHistory}
              onImportEcosystemPattern={handleImportDecisionEcosystemPattern}
              onSafeAutoTune={handleSafeDecisionAutoTune}
            />
          </div>
        ),
      });
    }

    if (editorPanel === 'settings') {
      return renderInlinePanelFrame({
        eyebrow: 'Controle do agente',
        title: 'Configuracoes gerais',
        description: 'Ajuste identidade, modelo, status, privacidade e politicas principais sem sair do construtor visual.',
        icon: <Settings2 className="h-3.5 w-3.5" />,
        accentClassName: 'border-slate-500/25 bg-slate-500/10 text-slate-300',
        children: (
          <div className="rounded-[28px] border border-white/[0.08] bg-[#15171a]/85 p-5 shadow-2xl backdrop-blur sm:p-6">
            <AutopilotSettings
              agentName={agentName}
              setAgentName={setAgentName}
              aiModel={aiModel}
              setAiModel={setAiModel}
              knowledgeBase={knowledgeBase}
              setKnowledgeBase={setKnowledgeBase}
              defaultFallbackReply={defaultFallbackReply}
              setDefaultFallbackReply={setDefaultFallbackReply}
              escalationPolicy={escalationPolicy}
              setEscalationPolicy={setEscalationPolicy}
              closingPolicy={closingPolicy}
              setClosingPolicy={setClosingPolicy}
              inactivityTimeoutSeconds={inactivityTimeoutSeconds}
              setInactivityTimeoutSeconds={setInactivityTimeoutSeconds}
              isActive={isActive}
              setIsActive={setIsActive}
              isPrivate={isPrivate}
              setIsPrivate={setIsPrivate}
              workflowRuntimeV2ShadowEnabled={workflowRuntimeV2ShadowEnabled}
              setWorkflowRuntimeV2ShadowEnabled={setWorkflowRuntimeV2ShadowEnabled}
              isPrimary={isPrimary}
              onSetPrimary={handleSetPrimary}
              modelOptions={selectableModels}
              onSave={handleSaveConfig}
              isSaving={isSaving}
              onDelete={handleDeleteAgent}
              workspace={workspace}
              nativeWorkflow={workflowBuilderMode === 'native_v2'}
            />
          </div>
        ),
      });
    }

    if (editorPanel === 'playground') {
      return renderInlinePanelFrame({
        eyebrow: 'Ambiente de testes',
        title: 'Playground do agente',
        description: 'Teste e inspecione o agente sem publicar alterações no atendimento real.',
        icon: <TestTube2 className="h-3.5 w-3.5" />,
        accentClassName: 'border-rose-500/25 bg-rose-500/10 text-rose-300',
        children: (
          <div className="rounded-[28px] border border-white/[0.08] bg-[#15171a]/85 p-5 shadow-2xl backdrop-blur sm:p-6">
            <AutopilotPlayground
              workspaceId={user?.activeWorkspaceId}
              agentId={agentId}
              disabled={isSaving || isPublishing}
              stale={hasUnpublishedChanges}
              draftSnapshot={previewDraftSnapshot}
              onTrace={setLastPlaygroundTrace}
            />
          </div>
        ),
      });
    }

    if (editorPanel === 'versions') {
      return renderInlinePanelFrame({
        eyebrow: 'Versionamento',
        title: 'Histórico de versões',
        description: 'Restaure configurações anteriores do atendente inteligente.',
        icon: <History className="h-3.5 w-3.5" />,
        accentClassName: 'border-slate-500/25 bg-slate-500/10 text-slate-300',
        children: (
          <div className="rounded-[28px] border border-white/[0.08] bg-[#15171a]/85 p-5 shadow-2xl backdrop-blur sm:p-6">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-sm text-slate-400">Ponto de restauração ativo</span>
              <Badge variant="outline" className="rounded-full border-slate-700 text-slate-300">
                {versions[0] ? `Atual: v${versions[0].version_number}` : 'Sem versão'}
              </Badge>
            </div>
            <div className="grid gap-3">
              {versions.map((version, index) => {
                const current = index === 0;
                const restoring = restoringVersionId === version.id;
                const changes = summarizeVersionChanges(version, versions[index + 1] || null, modelCatalog);
                return (
                  <Card key={version.id} className="border-white/10 bg-[#1e222b]">
                    <CardContent className="flex flex-col justify-between gap-4 p-5 sm:flex-row sm:items-start">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-white">Versão v{version.version_number}</h3>
                          {current && <Badge className="bg-emerald-500/15 text-emerald-300 border-0">Atual</Badge>}
                        </div>
                        <p className="mt-1 text-xs text-slate-400">
                          {new Date(version.created_at).toLocaleString('pt-BR')}
                        </p>
                        <ul className="mt-3 space-y-1 text-sm text-slate-400">
                          {changes.slice(0, 3).map((change) => (
                            <li key={change} className="flex gap-2">
                              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />
                              <span>{change}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <Button
                        variant={current ? 'outline' : 'default'}
                        disabled={current || Boolean(restoringVersionId)}
                        onClick={() => handleRestoreVersion(version.id, version.version_number)}
                        className={current ? 'border-white/10 text-slate-400' : 'bg-cyan-500 text-slate-950 hover:bg-cyan-400'}
                      >
                        {restoring ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
                        {current ? 'Em uso' : 'Restaurar'}
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
              {versions.length === 0 && (
                <div className="rounded-2xl border border-dashed border-white/10 p-10 text-center text-sm text-slate-500">
                  Publique o agente para criar o primeiro ponto de restauração.
                </div>
              )}
            </div>
          </div>
        ),
      });
    }

    return null;
  })();

  const inlineEditorPanelName: AgentEditorPanel | null =
    editorPanel === 'knowledge' || editorPanel === 'capabilities' || editorPanel === 'analytics' || editorPanel === 'decision' || editorPanel === 'settings' || editorPanel === 'playground' || editorPanel === 'versions'
      ? editorPanel
      : null;

  if (workflowDefinition) {
    return (
      <div className="relative min-h-0 flex-1 flex flex-col">
        <NativeWorkflowBuilder
        definition={workflowDefinition}
        activePanelContent={inlineEditorPanel}
        defaultModel={nativeDefaultModel}
        modelOptions={selectableModels}
        knowledgeDocuments={knowledgeDocuments}
        knowledgeCollections={knowledgeCollections}
        tools={toolCatalog.map((tool) => ({
          name: tool.name,
          description: tool.description,
          source: tool.source,
          serverId: tool.serverId,
          riskLevel: tool.riskLevel,
          requiresHumanApproval: tool.requiresHumanApproval,
          inputSchema: tool.inputSchema,
          outputSchema: tool.outputSchema,
        }))}
        isSaving={isSaving}
        isPublishing={isPublishing}
        onChange={setWorkflowDefinition}
        onBack={() => router.push('/autopilot')}
        onOpenSettings={() => setEditorPanel('settings')}
        onOpenPanel={(panel) => setEditorPanel(panel)}
        onTest={async () => {
          const message = window.prompt('Mensagem de teste', 'Olá, preciso de ajuda.');
          if (!message?.trim() || !config) return null;
          const result = await runAutopilotNativeWorkflowTest({
            configId: config.id,
            customerMessage: message.trim(),
            workflowDefinition,
          });
          if (!result.success || !result.executionId) {
            toast({ title: 'Falha no teste', description: result.error, variant: 'destructive' });
            return null;
          }
          return result.executionId;
        }}
        onTestNode={async (startNodeId, fixtures) => {
          if (!config) return null;
          const result = await runAutopilotNativeWorkflowTest({
            configId: config.id,
            customerMessage: 'Teste isolado iniciado pelo editor.',
            workflowDefinition,
            startNodeId,
            fixtures,
          });
          if (!result.success || !result.executionId) {
            toast({ title: 'Falha no teste isolado', description: result.error, variant: 'destructive' });
            return null;
          }
          return result.executionId;
        }}
        onSave={handleSaveConfig}
        onPublish={handlePublishConfig}
        />
        <NativeAiBuilderDialog
          definition={workflowDefinition}
          disabled={isSaving || isPublishing}
          onGenerate={(conversation) => generateAutopilotNativeWorkflowWithAi({
            configId: agentId,
            conversation,
            currentWorkflow: workflowDefinition,
            enabledToolNames,
          })}
          onApply={(proposal) => {
            if (!proposal.validation.valid) {
              toast({ title: 'Proposta bloqueada', description: 'A proposta nao passou no validador do runtime.', variant: 'destructive' });
              return;
            }
            setWorkflowDefinition(proposal.workflow);
            setEnabledToolNames((current) => [...new Set([...current, ...proposal.selectedToolNames])]);
            toast({
              title: 'Proposta aplicada ao rascunho',
              description: 'Revise o canvas, execute um teste e salve quando estiver pronto.',
            });
          }}
        />
      </div>
    );
  }

  // Native-only onboarding. Configurations without a definition can choose a
  // supported template, but the legacy editor is no longer reachable.
  return (
    <>
      <div className="flex min-h-[calc(100dvh-4rem)] items-center justify-center bg-[#080d14] p-6">
        <div className="w-full max-w-3xl rounded-3xl border border-cyan-500/20 bg-[#101821] p-8 text-center shadow-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-400">Flowbuilder agent-first</p>
          <h1 className="mt-3 text-2xl font-semibold text-white">Crie a definição nativa desta automação</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-400">Escolha um template executável. O editor anterior foi desativado e nenhum novo fluxo é salvo no formato legado.</p>
          <Button onClick={() => { setNativeMigrationPreview(null); setNativeSetupOpen(true); }} className="mt-6 bg-cyan-500 text-slate-950 hover:bg-cyan-400">Escolher template</Button>
        </div>
      </div>

      <Dialog open={nativeSetupOpen} onOpenChange={setNativeSetupOpen}>
        <DialogContent className="max-w-3xl border-white/10 bg-[#111419] text-slate-100">
          <DialogTitle>Flowbuilder agent-first</DialogTitle>
          <DialogDescription className="text-slate-400">
            Comece por um template ou migre o fluxo atual. O grafo legado nunca será apagado.
          </DialogDescription>
          {nativeMigrationPreview ? (
            <div className="space-y-5">
              <div className={cn('rounded-2xl border p-4', nativeMigrationPreview.validation.valid ? 'border-emerald-500/20 bg-emerald-500/[0.06]' : 'border-amber-500/20 bg-amber-500/[0.06]')}>
                <p className="font-medium">{nativeMigrationPreview.validation.valid ? 'Migração pronta para aplicar' : 'A migração precisa de revisão'}</p>
                <p className="mt-1 text-sm text-slate-400">{nativeMigrationPreview.workflow.nodes.length} blocos · {nativeMigrationPreview.workflow.connections.length} conexões</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {nativeMigrationPreview.changes.map((change) => <div key={change} className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-300">{change}</div>)}
              </div>
              {nativeMigrationPreview.validation.errors.length > 0 && <div className="rounded-xl border border-red-500/20 bg-red-500/[0.06] p-4 text-sm text-red-200">{nativeMigrationPreview.validation.errors.map((issue) => issue.message).join(' ')}</div>}
              <div className="flex justify-end gap-3"><Button variant="ghost" onClick={() => setNativeMigrationPreview(null)}>Voltar aos templates</Button><Button onClick={() => void handleApplyNativeMigration()} disabled={nativeSetupBusy || !nativeMigrationPreview.validation.valid}>Aplicar migração</Button></div>
            </div>
          ) : (
            <div className="grid gap-4 py-3 sm:grid-cols-3">
              {[
                ['single_agent', 'Agente único', 'Atendimento completo com modelo, memória, RAG e guardrail.'],
                ['routed_team', 'Equipe roteada', 'AI Router direcionando suporte e comercial.'],
                ['blank', 'Em branco', 'Canvas livre, inicialmente bloqueado para publicação.'],
              ].map(([template, title, description]) => (
                <button key={template} type="button" onClick={() => void handleCreateNativeTemplate(template as NativeWorkflowTemplate)} disabled={nativeSetupBusy} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-left transition hover:border-cyan-400/40 hover:bg-cyan-500/[0.06]">
                  <span className="block font-semibold text-slate-100">{title}</span><span className="mt-2 block text-sm leading-6 text-slate-400">{description}</span>
                </button>
              ))}
              {flowGraph && <Button variant="outline" onClick={() => void handlePreviewNativeMigration()} disabled={nativeSetupBusy} className="sm:col-span-3">Visualizar migração do flow atual</Button>}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={editorPanel !== null && !inlineEditorPanelName} onOpenChange={(open) => !open && setEditorPanel(null)}>
        <DialogContent className="flex h-[92vh] max-h-[92vh] w-[min(1160px,94vw)] max-w-none flex-col overflow-hidden rounded-[26px] border-white/10 bg-[#111316] p-0 text-slate-100 shadow-2xl">
          <DialogTitle className="sr-only">
            {editorPanel === 'playground' ? 'Playground do agente' : 'Painel do agente'}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Teste e inspecione o agente sem publicar alterações no atendimento real.
          </DialogDescription>
          {editorPanel === 'playground' && (
            <div className="flex-1 overflow-y-auto p-5 sm:p-7">
              <AutopilotPlayground
                workspaceId={user?.activeWorkspaceId}
                agentId={agentId}
                disabled={isSaving || isPublishing}
                stale={hasUnpublishedChanges}
                draftSnapshot={previewDraftSnapshot}
                onTrace={setLastPlaygroundTrace}
              />
            </div>
          )}

          {editorPanel === 'versions' && (
            <div className="flex-1 overflow-y-auto p-6 sm:p-8">
              <div className="mb-6 flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-semibold text-foreground">Historico publicado</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Restaure configuracoes anteriores do atendente inteligente.
                  </p>
                </div>
                <Badge variant="outline" className="rounded-full">
                  {versions[0] ? `Atual: v${versions[0].version_number}` : 'Sem versao'}
                </Badge>
              </div>
              <div className="grid gap-3">
                {versions.map((version, index) => {
                  const current = index === 0;
                  const restoring = restoringVersionId === version.id;
                  return (
                    <Card key={version.id} className="border-border bg-card">
                      <CardContent className="flex flex-col justify-between gap-4 p-5 sm:flex-row sm:items-start">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold">Versao v{version.version_number}</h3>
                            {current && <Badge className="bg-emerald-500/15 text-emerald-300">Atual</Badge>}
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {new Date(version.created_at).toLocaleString('pt-BR')}
                          </p>
                          <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
                            {summarizeVersionChanges(version, versions[index + 1] || null, modelCatalog)
                              .slice(0, 3)
                              .map((change) => <li key={change}>{change}</li>)}
                          </ul>
                        </div>
                        <Button
                          variant={current ? 'outline' : 'default'}
                          disabled={current || Boolean(restoringVersionId)}
                          onClick={() => handleRestoreVersion(version.id, version.version_number)}
                        >
                          {restoring ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
                          {current ? 'Em uso' : 'Restaurar'}
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
                {versions.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                    Publique o agente para criar o primeiro ponto de restauracao.
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={isRuleModalOpen} onOpenChange={setIsRuleModalOpen}>
        <DialogContent className="flex h-[90vh] max-h-[90vh] max-w-3xl flex-col overflow-hidden rounded-[28px] border border-border bg-background p-0 shadow-2xl">
          <AutomationForm
            configId={config.id}
            instance={editingRule}
            onClose={() => setIsRuleModalOpen(false)}
            onSuccess={handleRuleSaved}
          />
        </DialogContent>
      </Dialog>
    </>
  );

  // Historical settings markup retained only as unreachable source during the
  // cleanup window; both executable returns above are native-only.
  return (
    <div className="flex h-full min-w-0 flex-col gap-6 bg-background px-4 py-4 sm:px-6 lg:px-8">
      <header className="mx-auto flex w-full max-w-[1600px] min-w-0 flex-col gap-4 rounded-[28px] border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.push('/autopilot')}
              className="mt-0.5 shrink-0 rounded-full"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>

            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-2xl font-bold tracking-tight text-foreground">
                  {agentName || config?.name}
                </h1>
                {isPrimary && (
                  <Badge className="rounded-full border-0 bg-amber-500/15 text-amber-700 dark:text-amber-300">
                    Principal
                  </Badge>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="rounded-full text-xs">
                  {getAiModelLabel(aiModel, modelCatalog)}
                </Badge>
                <Badge variant="outline" className="rounded-full text-xs">
                  {isPrivate ? 'Privado' : 'Público'}
                </Badge>
                {isActive ? (
                  <span className="inline-flex items-center gap-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    Operando
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
                    Pausado
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {isDirty ? (
              <Badge className="rounded-full border-0 bg-amber-500/15 text-amber-700 dark:text-amber-300">
                Alteracoes nao salvas
              </Badge>
            ) : hasDraft ? (
              <Badge className="rounded-full border-0 bg-blue-500/15 text-blue-700 dark:text-blue-300">
                Rascunho salvo
              </Badge>
            ) : (
              <Badge className="rounded-full border-0 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                Publicado
              </Badge>
            )}

            {(hasDraft || isDirty) && (
              <Button
                onClick={handleDiscardDraft}
                disabled={isSaving || isPublishing || isDiscardingDraft}
                variant="outline"
                className="rounded-full px-4"
              >
                {isDiscardingDraft ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Descartar
              </Button>
            )}

            <Button
              onClick={handleSaveConfig}
              disabled={isSaving || !isDirty}
              variant="secondary"
              className="rounded-full px-5"
            >
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Salvar rascunho
            </Button>

            <Button
              onClick={handlePublishConfig}
              disabled={isSaving || isPublishing || (!hasDraft && !isDirty)}
              className="rounded-full px-5"
            >
              {isPublishing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
              Publicar
            </Button>
          </div>
        </div>
        {(hasDraft || versions.length > 0) && (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-muted/25 px-4 py-3 text-xs text-muted-foreground">
            <History className="h-4 w-4" />
            {hasDraft && (
              <span>
                Rascunho salvo{draftUpdatedAt ? ` em ${new Date(String(draftUpdatedAt)).toLocaleString('pt-BR')}` : ''}.
              </span>
            )}
            {versions[0] && (
              <span>
                Ultima publicacao: v{versions[0].version_number}
                {versions[0].created_at ? ` em ${new Date(versions[0].created_at).toLocaleString('pt-BR')}` : ''}.
              </span>
            )}
          </div>
        )}
      </header>

      <main className="mx-auto grid w-full max-w-[1600px] min-w-0 flex-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
        <Tabs defaultValue="overview" className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm">
            <TabsTrigger value="overview" className="gap-2 rounded-xl px-4 py-2">
              <LayoutDashboard className="h-4 w-4" /> Visão geral
            </TabsTrigger>
            <TabsTrigger value="knowledge" className="gap-2 rounded-xl px-4 py-2">
              <Database className="h-4 w-4" /> Conhecimento
            </TabsTrigger>
            <TabsTrigger value="rules" className="gap-2 rounded-xl px-4 py-2">
              <Zap className="h-4 w-4" /> O que ele pode fazer
            </TabsTrigger>
            <TabsTrigger value="analytics" className="gap-2 rounded-xl px-4 py-2">
              <LineChart className="h-4 w-4" /> Analytics
            </TabsTrigger>
            <TabsTrigger
              value="decision"
              onClick={() => {
                if (!decisionInsights && !isLoadingDecisionInsights && !hasAttemptedDecisionInsightsLoad) void loadDecisionInsights();
              }}
              className="gap-2 rounded-xl px-4 py-2"
            >
              <BrainCircuit className="h-4 w-4" /> Motor
            </TabsTrigger>
            <TabsTrigger value="settings" className="gap-2 rounded-xl px-4 py-2">
              <Settings2 className="h-4 w-4" /> Ajustes
            </TabsTrigger>
            <TabsTrigger value="playground" className="gap-2 rounded-xl px-4 py-2">
              <TestTube2 className="h-4 w-4" /> Playground
            </TabsTrigger>
            <TabsTrigger value="versions" className="gap-2 rounded-xl px-4 py-2">
              <History className="h-4 w-4" /> Versionamento
            </TabsTrigger>
          </TabsList>

          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
            <TabsContent value="overview" className="mt-0 min-w-0 space-y-6">
              <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.9fr)]">
                <Card className="min-w-0 overflow-hidden border border-border bg-card shadow-sm">
                  <CardContent className="space-y-6 p-6 sm:p-8">
                    <div className="flex flex-wrap items-center gap-3">
                      <Badge variant={isPrivate ? 'secondary' : 'outline'} className="rounded-full">
                        {isPrivate ? 'Privado' : 'Público'}
                      </Badge>
                      <Badge variant={isActive ? 'default' : 'secondary'} className="rounded-full">
                        {isActive ? 'Ativo' : 'Pausado'}
                      </Badge>
                      {workspaceHasGeminiConfig && (
                        <Badge variant="outline" className="rounded-full">
                          Workspace com IA configurada
                        </Badge>
                      )}
                    </div>

                    <div className="space-y-3">
                      <h2 className="text-3xl font-bold tracking-tight text-foreground">{agentName || config?.name}</h2>
                      <p className="line-clamp-6 max-w-3xl text-sm leading-7 text-muted-foreground sm:text-base">
                        {knowledgeBase?.trim()
                          ? knowledgeBase.trim()
                          : 'Defina a persona do agente na aba de ajustes para orientar tom, regras de atendimento e objetivo operacional.'}
                      </p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="rounded-2xl border border-border bg-muted/30 p-4">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Modelo</div>
                        <div className="mt-2 text-sm font-medium text-foreground">
                          {getAiModelLabel(aiModel, modelCatalog)}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-border bg-muted/30 p-4">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Base</div>
                        <div className="mt-2 text-sm font-medium text-foreground">
                          {knowledgeDocuments.length.toLocaleString()} documentos
                        </div>
                      </div>
                      <div className="rounded-2xl border border-border bg-muted/30 p-4">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Habilidades</div>
                        <div className="mt-2 text-sm font-medium text-foreground">
                          {instances.filter((item) => item.enabled).length.toLocaleString()} ativas
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 pt-2">
                      <Button
                        onClick={() => setIsActive((current) => !current)}
                        variant={isActive ? 'outline' : 'default'}
                        className="rounded-full px-6"
                      >
                        {isActive ? 'Pausar operação' : 'Ativar agora'}
                      </Button>
                      {!isPrimary && (
                        <Button
                          onClick={handleSetPrimary}
                          variant="secondary"
                          className="rounded-full px-6"
                        >
                          Tornar principal
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <div className="grid gap-6">
                  <Card className="overflow-hidden border border-border bg-card shadow-sm">
                    <CardContent className="grid gap-4 p-6">
                      <div className="rounded-2xl border border-border bg-muted/30 p-4">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Chave de IA</div>
                        <div className="mt-2 text-sm font-medium text-foreground">
                          {hasGlobalKey || workspaceHasGeminiConfig ? 'Disponível' : 'Não configurada'}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-border bg-muted/30 p-4">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Modelo padrão do workspace</div>
                        <div className="mt-2 text-sm font-medium text-foreground">
                          {workspaceDefaultAiModel ? getAiModelLabel(workspaceDefaultAiModel, modelCatalog) : 'Não definido'}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-border bg-muted/30 p-4">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Visibilidade</div>
                        <div className="mt-2 text-sm font-medium text-foreground">
                          {isPrivate ? 'Restrito ao criador' : 'Compartilhado no workspace'}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="knowledge" className="mt-0 min-w-0 pb-10">
              <AutopilotKnowledge
                documents={knowledgeDocuments}
                collections={knowledgeCollections}
                toolCatalog={toolCatalog}
                onUpload={handleKnowledgeUpload}
                onRemove={handleRemoveDoc}
                onUpdateContent={handleUpdateDoc}
                onUpdateName={handleUpdateDocName}
                onUpdateCategory={handleUpdateDocCategory}
                onUpdateMaxPromptChars={handleUpdateDocMaxPromptChars}
                onUpdateMetadata={handleUpdateDocMetadata}
                onUpdateCollections={handleUpdateDocCollections}
                onAddCollection={handleAddKnowledgeCollection}
                onRemoveCollection={handleRemoveKnowledgeCollection}
                onAddManual={handleAddManualDoc}
                onImproveDocument={handleImproveKnowledgeDocument}
                isUploading={isUploading}
                ragHealth={ragHealth}
                onReindex={handleReindexKnowledgeBase}
                isReindexing={isReindexingKnowledge}
                ragLabReport={ragLabReport}
                onRunRagLab={handleRunRagLab}
                isRunningRagLab={isRunningRagLab}
              />
            </TabsContent>

            <TabsContent value="rules" className="mt-0 min-w-0 pb-10">
              <AutopilotRules
                rules={instances}
                toolCatalog={toolCatalog}
                enabledToolNames={enabledToolNames}
                setEnabledToolNames={setEnabledToolNames}
                onSaveTools={handleSaveConfig}
                isSavingTools={isSaving}
                onAdd={() => {
                  setEditingRule(null);
                  setIsRuleModalOpen(true);
                }}
                onEdit={(rule: any) => {
                  setEditingRule(rule);
                  setIsRuleModalOpen(true);
                }}
                onDelete={handleDeleteRule}
                onToggle={handleToggleRule}
              />
            </TabsContent>

            <TabsContent value="analytics" className="mt-0 min-w-0 pb-10">
              <AutopilotStats usageLogs={usageLogs} loading={loading} />
            </TabsContent>

            <TabsContent value="decision" className="mt-0 min-w-0 pb-10">
              {decisionInsightsLoadError && (
                <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between">
                  <span>{decisionInsightsLoadError}</span>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void loadDecisionInsights()}
                    disabled={isLoadingDecisionInsights}
                    className="w-fit rounded-xl"
                  >
                    {isLoadingDecisionInsights ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Tentar novamente
                  </Button>
                </div>
              )}
              <AutopilotDecisionInsightsPanel
                insights={decisionInsights}
                loading={isLoadingDecisionInsights}
                refreshing={isRefreshingDecisionInsights}
                reviewingPatternId={reviewingPatternId}
                previewingPatternId={previewingPatternId}
                applicationPreviewPatternId={applicationPreviewPatternId}
                applicationPreview={applicationPreview}
                applyingPatternId={applyingPatternId}
                revertingPatternId={revertingPatternId}
                applyingScoreHistoryId={applyingScoreHistoryId}
                importingEcosystemPatternId={importingEcosystemPatternId}
                autoTuning={isAutoTuningDecisionInsights}
                onRefresh={handleRefreshDecisionInsights}
                onReviewPattern={handleReviewDecisionPattern}
                onPreviewPattern={handlePreviewDecisionPattern}
                onClearPreview={() => {
                  setApplicationPreviewPatternId(null);
                  setApplicationPreview(null);
                }}
                onApplyPattern={handleApplyDecisionPattern}
                onRevertPattern={handleRevertDecisionPattern}
                onApplyScoreHistory={handleApplyDecisionScoreHistory}
                onImportEcosystemPattern={handleImportDecisionEcosystemPattern}
                onSafeAutoTune={handleSafeDecisionAutoTune}
              />
            </TabsContent>

            <TabsContent value="settings" className="mt-0 min-w-0 pb-10">
              <AutopilotSettings
                agentName={agentName}
                setAgentName={setAgentName}
                aiModel={aiModel}
                setAiModel={setAiModel}
                knowledgeBase={knowledgeBase}
                setKnowledgeBase={setKnowledgeBase}
                defaultFallbackReply={defaultFallbackReply}
                setDefaultFallbackReply={setDefaultFallbackReply}
                escalationPolicy={escalationPolicy}
                setEscalationPolicy={setEscalationPolicy}
                closingPolicy={closingPolicy}
                setClosingPolicy={setClosingPolicy}
                inactivityTimeoutSeconds={inactivityTimeoutSeconds}
                setInactivityTimeoutSeconds={setInactivityTimeoutSeconds}
                isActive={isActive}
                setIsActive={setIsActive}
                isPrivate={isPrivate}
                setIsPrivate={setIsPrivate}
                workflowRuntimeV2ShadowEnabled={workflowRuntimeV2ShadowEnabled}
                setWorkflowRuntimeV2ShadowEnabled={setWorkflowRuntimeV2ShadowEnabled}
                isPrimary={isPrimary}
                onSetPrimary={handleSetPrimary}
                modelOptions={selectableModels}
                onSave={handleSaveConfig}
                isSaving={isSaving}
                onDelete={handleDeleteAgent}
                workspace={workspace}
                nativeWorkflow={workflowBuilderMode === 'native_v2'}
              />
            </TabsContent>

            <TabsContent value="playground" className="mt-0 min-w-0 pb-10">
              <AutopilotPlayground
                workspaceId={user?.activeWorkspaceId}
                agentId={agentId}
                disabled={isSaving || isPublishing}
                stale={hasUnpublishedChanges}
                draftSnapshot={previewDraftSnapshot}
                onTrace={setLastPlaygroundTrace}
              />
            </TabsContent>

            <TabsContent value="versions" className="mt-0 min-w-0 pb-10">
              <div className="grid gap-5">
                <Card className="overflow-hidden rounded-[28px] border border-border bg-card shadow-sm">
                  <CardContent className="grid gap-5 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_280px]">
                    <div className="min-w-0 space-y-3">
                      <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-primary">
                        <History className="h-3.5 w-3.5" />
                        Versionamento
                      </div>
                      <div>
                        <h2 className="text-2xl font-semibold tracking-tight text-foreground">Historico publicado do agente</h2>
                        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                          Restaure uma versao anterior quando ela estiver performando melhor. O rollback vira uma nova publicacao, preservando o historico.
                        </p>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-border bg-muted/25 p-4">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Versao atual</div>
                      <div className="mt-2 text-2xl font-semibold text-foreground">
                        {versions[0] ? `v${versions[0].version_number}` : 'Sem versao'}
                      </div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {versions[0]?.created_at ? new Date(versions[0].created_at).toLocaleString('pt-BR') : 'Publique o agente para criar o primeiro ponto de restauracao.'}
                      </p>
                    </div>
                  </CardContent>
                </Card>

                {versions.length > 0 ? (
                  <div className="grid gap-3">
                    {versions.map((version, index) => {
                      const isCurrent = index === 0;
                      const isRestoring = restoringVersionId === version.id;
                      const changes = summarizeVersionChanges(version, versions[index + 1] || null, modelCatalog);
                      return (
                        <Card key={version.id} className="overflow-hidden rounded-[24px] border border-border bg-card shadow-sm">
                          <CardContent className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                            <div className="grid min-w-0 gap-4">
                              <div className="flex min-w-0 items-start gap-4">
                                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-muted text-primary">
                                  {isCurrent ? <CheckCircle2 className="h-5 w-5" /> : <History className="h-5 w-5" />}
                                </div>
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <h3 className="text-base font-semibold text-foreground">Versao v{version.version_number}</h3>
                                    {isCurrent && (
                                      <Badge className="rounded-full border-0 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                                        Atual
                                      </Badge>
                                    )}
                                  </div>
                                  <p className="mt-1 text-sm text-muted-foreground">
                                    {version.label || `Publicacao v${version.version_number}`}
                                  </p>
                                  <p className="mt-2 text-xs text-muted-foreground">
                                    Publicada em {new Date(version.created_at).toLocaleString('pt-BR')}
                                  </p>
                                </div>
                              </div>

                              <div className="rounded-2xl border border-border bg-muted/20 p-4">
                                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">O que mudou nesta versao</div>
                                <ul className="mt-3 grid gap-2">
                                  {changes.map((change) => (
                                    <li key={change} className="flex gap-2 text-sm leading-6 text-muted-foreground">
                                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                                      <span>{change}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            </div>

                            <Button
                              type="button"
                              variant={isCurrent ? 'outline' : 'default'}
                              disabled={isCurrent || Boolean(restoringVersionId)}
                              onClick={() => handleRestoreVersion(version.id, version.version_number)}
                              className="rounded-full"
                            >
                              {isRestoring ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
                              {isCurrent ? 'Em uso' : 'Restaurar'}
                            </Button>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                ) : (
                  <Card className="overflow-hidden rounded-[28px] border border-dashed border-border bg-card shadow-sm">
                    <CardContent className="flex min-h-[280px] flex-col items-center justify-center px-6 py-12 text-center">
                      <History className="h-12 w-12 text-muted-foreground/50" />
                      <h3 className="mt-5 text-lg font-semibold text-foreground">Nenhuma versao publicada</h3>
                      <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                        Salve e publique o agente para criar o primeiro ponto de restauracao.
                      </p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </TabsContent>
          </div>
        </Tabs>

        <aside className="min-w-0 self-start xl:sticky xl:top-4">
          <AutopilotReadiness
            aiModel={aiModel}
            modelOptions={selectableModels}
            hasRuntimeKey={Boolean(hasGlobalKey || workspaceHasGeminiConfig)}
            knowledgeBase={knowledgeBase}
            documents={knowledgeDocuments}
            fallbackReply={defaultFallbackReply}
            escalationPolicy={escalationPolicy}
            enabledToolNames={enabledToolNames}
            isActive={isActive}
            isDirty={hasUnpublishedChanges}
            lastTrace={lastPlaygroundTrace}
            flowGraph={flowGraph}
          />
        </aside>
      </main>

      <Dialog open={isRuleModalOpen} onOpenChange={setIsRuleModalOpen}>
        <DialogContent className="flex h-[90vh] max-h-[90vh] max-w-3xl flex-col overflow-hidden rounded-[28px] border border-border bg-background p-0 shadow-2xl">
          {config && (
            <AutomationForm
              configId={config!.id}
              instance={editingRule}
              onClose={() => setIsRuleModalOpen(false)}
              onSuccess={handleRuleSaved}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
