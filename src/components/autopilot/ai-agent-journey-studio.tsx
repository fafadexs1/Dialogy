'use client';

import { createClientUuid } from '@/lib/client-uuid';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  Sparkles,
  MessageSquare,
  HelpCircle,
  GitBranch,
  Database,
  Headphones,
  Plus,
  Play,
  Cloud,
  ChevronDown,
  ChevronRight,
  Pencil,
  Copy,
  CheckCircle2,
  FileText,
  Trash2,
  Zap,
  ShieldCheck,
  ArrowDown,
  ArrowUp,
  Globe,
  Server,
  AlertCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { AutopilotConfig, KnowledgeBaseDocument, KnowledgeCollection } from '@/lib/types';
import { type AiModelCatalogEntry } from '@/lib/ai-models';
import { StudioIntegrationFields, availableStudioData } from './studio-integration-fields';
import { StudioConversationPreview } from './studio-conversation-preview';
import { StudioFieldEditor, StudioStageSettings, type StudioResources } from './studio-stage-settings';
import { StudioStepOptions } from './studio-step-options';
import { StudioProcedureSettings } from './studio-procedure-settings';
import { StudioResultsMetrics } from './studio-results';
import { studioStepConsumers } from '@/services/agent-studio/data-availability';
import {
  AgentStudioDocument,
  ProcedureDocument,
  ProcedureStep,
  ProcedureStepType,
  PROCEDURE_STEP_TYPES,
  PROCEDURE_STEP_TYPE_LABELS,
  HttpRequestStepConfig,
  createDefaultAgentStudioDocument,
} from '@/services/agent-studio/types';
import {
  analyzeProcedureAssistance,
  validateAgentForPublication,
  type PublicationValidationResult,
} from '@/services/agent-studio/assistant-validator';
import {
  saveAgentStudioDraftAction,
  publishAgentStudioAction,
  listAgentMcpServersAction,
  listAgentApiConnectionsAction,
  saveAgentApiConnectionAction,
  listStudioResourcesAction,
  getStudioResultsAction,
  getStudioVersionForDraftAction,
  rollbackAgentStudioToLegacyAction,
  revokeAgentStudioReleaseAction,
  type AgentApiConnectionSummary,
} from '@/actions/agent-studio';
import {
  syncMcpServerToolsAction,
  upsertMcpServerAction,
} from '@/actions/mcp';
import { useToast } from '@/hooks/use-toast';
import { StudioMigrationReview } from './studio-migration-review';
import { StudioVersionComparison } from './studio-version-comparison';
import { StudioPolicySettings } from './studio-policy-settings';
import { StudioKnowledgeSources } from './studio-knowledge-sources';
import type { StudioMigrationReport } from '@/services/agent-studio/migration';

export type AiAgentJourneyStudioProps = {
  config: AutopilotConfig;
  initialDocument?: AgentStudioDocument;
  requiresMigrationReview?: boolean;
  migrationReport?: StudioMigrationReport | null;
  initialTab?: 'flow' | 'appearance' | 'rules' | 'results';
  onSave?: (updatedConfig: Partial<AutopilotConfig>) => Promise<boolean | void>;
  onPublish?: () => Promise<boolean | void>;
  isSaving?: boolean;
  isPublishing?: boolean;
  models?: AiModelCatalogEntry[];
  knowledgeDocuments?: KnowledgeBaseDocument[];
  knowledgeCollections?: KnowledgeCollection[];
  tools?: StudioToolOption[];
  workspaceId: string;
  onBackToOverview?: () => void;
};

type StudioToolOption = {
  name: string;
  displayName?: string;
  description?: string;
  source: 'dialogy' | 'mcp';
  serverId?: string;
  serverName?: string;
  riskLevel?: 'low' | 'medium' | 'high';
  requiresHumanApproval?: boolean;
};

function draftFingerprint(document: AgentStudioDocument) {
  return JSON.stringify({ ...document, draftRevision: 0, status: '', publishedVersion: null, updatedAt: '',
    resolveStage: { ...document.resolveStage, procedures: document.resolveStage.procedures.map((procedure) => ({ ...procedure, status: procedure.status === 'archived' ? 'archived' : 'active', publishedVersion: null, updatedAt: '' })) } });
}

export function AiAgentJourneyStudio({
  config,
  initialDocument,
  requiresMigrationReview = false,
  migrationReport = null,
  initialTab = 'flow',
  models = [],
  knowledgeDocuments = [],
  knowledgeCollections: existingKnowledgeCollections = [],
  tools = [],
  workspaceId,
}: AiAgentJourneyStudioProps) {
  const { toast } = useToast();

  // Navigation & Tabs State
  const [activeTab, setActiveTab] = useState<'flow' | 'appearance' | 'rules' | 'results'>(initialTab);
  const [viewLevel, setViewLevel] = useState<'journey' | 'procedure' | 'step' | 'knowledge'>('journey');
  const [activeProcedureId, setActiveProcedureId] = useState<string | null>(null);
  const [editingProcedure, setEditingProcedure] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Main Studio Document State
  const [doc, setDoc] = useState<AgentStudioDocument>(() => initialDocument
    || createDefaultAgentStudioDocument(config.id, workspaceId, config.name || 'Agente de Atendimento'));
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const savedFingerprint = useRef(draftFingerprint(doc));
  const mutationInFlight = useRef(false);
  const currentDocument = useRef(doc); currentDocument.current = doc;
  const [saveError, setSaveError] = useState('');
  const defaultCollectionId = existingKnowledgeCollections.find((c) => c.isDefault)?.id || existingKnowledgeCollections[0]?.id || 'general';
  const normalizedKnowledgeDocs = knowledgeDocuments.map((source) => ({
    ...source,
    collectionIds: (Array.isArray(source.collectionIds) && source.collectionIds.length > 0)
      ? source.collectionIds
      : [defaultCollectionId],
  }));
  const knowledgeCollections = [...existingKnowledgeCollections, ...(doc.inlineKnowledge || []).map((source) => ({ id: source.id, name: source.name }))];
  const selectedKnowledgeIds = new Set(doc.resolveStage.knowledgeCollectionIds);
  const activeKnowledgeCount = normalizedKnowledgeDocs.filter((source) => !['draft', 'archived', 'expired'].includes(source.status || 'active') && (selectedKnowledgeIds.has(source.id) || (source.collectionIds || []).some((id) => selectedKnowledgeIds.has(id)))).length
    + (doc.inlineKnowledge || []).filter((source) => selectedKnowledgeIds.has(source.id)).length;
  const currentFingerprint = draftFingerprint(doc);
  const [stageSettings, setStageSettings] = useState<'understand' | 'conclude' | null>(null);
  const [deleteProcedureId, setDeleteProcedureId] = useState<string | null>(null);
  const [resources, setResources] = useState<StudioResources>({ teams: [], tags: [], fields: [] });
  const [results, setResults] = useState<Awaited<ReturnType<typeof getStudioResultsAction>> | null>(null);
  const [resultsPeriodDays, setResultsPeriodDays] = useState(30);
  const [resultsRevision, setResultsRevision] = useState(0);
  const [restoreVersion, setRestoreVersion] = useState<{ id: string; version: number } | null>(null);
  const [compareVersion, setCompareVersion] = useState<{ id: string; version: number } | null>(null);
  const [restoringVersion, setRestoringVersion] = useState(false);
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const [rollbackConfirmation, setRollbackConfirmation] = useState('');
  const [rollingBack, setRollingBack] = useState(false);
  const [revocationTarget, setRevocationTarget] = useState<{ releaseId: string; version: number; sourceId?: string; label: string } | null>(null);
  const [revocationReason, setRevocationReason] = useState('');
  const [revocationConfirmation, setRevocationConfirmation] = useState('');
  const [revoking, setRevoking] = useState(false);
  useEffect(() => { void listStudioResourcesAction(config.id).then((result) => { if (result.success) setResources(result); }); }, [config.id]);
  useEffect(() => {
    let cancelled = false;
    if (activeTab === 'results') {
      setResults(null);
      void getStudioResultsAction(config.id, resultsPeriodDays).then((value) => { if (!cancelled) setResults(value); }).catch(() => { if (!cancelled) setResults({ success: false, sessions: [], releases: [], currentRuntime: 'unknown', canRollbackToLegacy: false, error: 'Não foi possível carregar os resultados. Tente novamente.' }); });
    }
    return () => { cancelled = true; };
  }, [activeTab, config.id, doc.publishedVersion, resultsPeriodDays, resultsRevision]);

  // Title Editing
  const [isEditingName, setIsEditingName] = useState(false);

  // Selected Procedure in Level 2
  const activeProcedure = useMemo(() => {
    const procs = doc.resolveStage.procedures;
    if (!activeProcedureId) return procs[0] || null;
    return procs.find((p) => p.id === activeProcedureId) || procs[0] || null;
  }, [activeProcedureId, doc.resolveStage.procedures]);

  // Assistant Suggestions for Active Procedure
  const assistanceSuggestions = useMemo(() => {
    if (!activeProcedure) return [];
    return analyzeProcedureAssistance(activeProcedure, doc.understandStage.askInitialData ? doc.understandStage.initialFields : []);
  }, [activeProcedure, doc.understandStage]);

  // Step Configuration Modal State
  const [editingStepIndex, setEditingStepIndex] = useState<number | null>(null);
  const [editingStepData, setEditingStepData] = useState<ProcedureStep | null>(null);

  // Modals for API Connection & MCP Server inside procedure
  const [isAddApiConnectionOpen, setIsAddApiConnectionOpen] = useState(false);
  const [isAddMcpServerOpen, setIsAddMcpServerOpen] = useState(false);
  const [connectingMcp, setConnectingMcp] = useState(false);
  const [savingConnection, setSavingConnection] = useState(false);
  const [apiConnections, setApiConnections] = useState<AgentApiConnectionSummary[]>([]);
  const [newApiConnection, setNewApiConnection] = useState({
    name: '',
    baseUrl: '',
    authType: 'none' as AgentApiConnectionSummary['authType'],
    apiKeyHeader: 'X-API-Key',
    secret: '',
    username: '',
  });
  const [mcpServers, setMcpServers] = useState<Awaited<ReturnType<typeof listAgentMcpServersAction>>['servers']>([]);
  const [syncedMcpTools, setSyncedMcpTools] = useState<StudioToolOption[]>([]);
  const [newMcpServer, setNewMcpServer] = useState<{
    id?: string;
    token?: string;
    name: string;
    endpoint: string;
    transport: 'streamable_http' | 'sse';
  }>({
    name: '',
    endpoint: '',
    transport: 'streamable_http' as const,
  });

  // Publication Validation Modal State
  const [publicationValidation, setPublicationValidation] = useState<PublicationValidationResult | null>(null);
  const [isPublishDialogOpen, setIsPublishDialogOpen] = useState(false);

  const [previewResetKey, setPreviewResetKey] = useState(0);
  const availableMcpTools = useMemo(() => {
    const byName = new Map<string, StudioToolOption>();
    [...tools.filter((tool) => tool.source === 'mcp'), ...syncedMcpTools, ...mcpServers.filter((server) => server.isActive).flatMap((server) => server.tools.map((tool) => ({
      name: tool.qualifiedName, displayName: tool.title || tool.name.replaceAll('_', ' '), description: tool.description || '',
      source: 'mcp' as const, serverId: server.id, serverName: server.name,
      riskLevel: tool.annotations?.readOnlyHint ? 'low' as const : 'high' as const,
      requiresHumanApproval: !tool.annotations?.readOnlyHint,
    })))].forEach((tool) => byName.set(tool.name, tool));
    return [...byName.values()];
  }, [syncedMcpTools, tools, mcpServers]);

  useEffect(() => {
    if (!workspaceId) return;
    void Promise.all([listAgentMcpServersAction(config.id), listAgentApiConnectionsAction(config.id)]).then(([mcpResult, apiResult]) => {
      if (mcpResult.success) setMcpServers(mcpResult.servers);
      if (apiResult.success) setApiConnections(apiResult.connections);
    });
  }, [config.id, workspaceId]);

  // Procedure Navigation
  const handleOpenProcedure = (procedureId: string) => {
    setActiveProcedureId(procedureId);
    setViewLevel('procedure');
  };

  const handleCreateNewProcedure = () => {
    const newId = `proc_${Date.now()}`;
    const newProc: ProcedureDocument = {
      id: newId,
      name: 'Novo procedimento',
      description: 'A IA segue estas etapas para resolver a solicitação.',
      objective: '',
      priority: 100,
      triggerKeywords: [],
      exampleRequests: [],
      steps: [],
      status: 'draft',
      publishedVersion: null,
      updatedAt: new Date().toISOString(),
    };

    setDoc((prev) => ({
      ...prev,
      resolveStage: {
        ...prev.resolveStage,
        procedures: [...prev.resolveStage.procedures, newProc],
      },
    }));
    setActiveProcedureId(newId);
    setViewLevel('procedure');
    setEditingProcedure(true);
  };

  const removeProcedure = (procedureId: string) => {
    setDoc((previous) => ({
      ...previous,
      resolveStage: {
        ...previous.resolveStage,
        procedures: previous.resolveStage.procedures.filter((procedure) => procedure.id !== procedureId),
      },
    }));
    if (activeProcedureId === procedureId) setActiveProcedureId(null);
    setDeleteProcedureId(null);
  };

  const updateProcedure = (updated: ProcedureDocument) => setDoc((previous) => ({ ...previous, resolveStage: { ...previous.resolveStage, procedures: previous.resolveStage.procedures.map((procedure) => procedure.id === updated.id ? updated : procedure) } }));
  const openStepEditor = (index: number, step: ProcedureStep) => {
    setEditingStepIndex(index);
    setEditingStepData(structuredClone(step));
    setViewLevel('step');
  };
  const closeStepEditor = () => {
    setEditingStepIndex(null);
    setEditingStepData(null);
    setViewLevel('procedure');
  };
  const saveStepEditor = () => {
    if (editingStepIndex !== null && editingStepData && activeProcedure) {
      const updatedSteps = [...activeProcedure.steps];
      updatedSteps[editingStepIndex] = editingStepData;
      updateProcedure({ ...activeProcedure, steps: updatedSteps });
      toast({ title: 'Etapa atualizada', description: 'As alterações serão salvas automaticamente no rascunho.' });
    }
    closeStepEditor();
  };
  const moveStep = (index: number, offset: number) => {
    if (!activeProcedure || index + offset < 0 || index + offset >= activeProcedure.steps.length) return;
    const steps = [...activeProcedure.steps];
    [steps[index], steps[index + offset]] = [steps[index + offset], steps[index]];
    updateProcedure({ ...activeProcedure, steps: steps.map((step, order) => ({ ...step, order: order + 1 })) });
  };
  const removeStep = (index: number) => {
    if (!activeProcedure) return;
    const removed = activeProcedure.steps[index];
    const consumers = studioStepConsumers(activeProcedure, removed);
    if (consumers.length) {
      toast({ title: 'Outras etapas dependem desta', description: `Revise os dados ou caminhos de: ${consumers.map((step) => step.title).join(', ')}. Depois você poderá removê-la.`, variant: 'destructive' }); return;
    }
    updateProcedure({ ...activeProcedure, steps: activeProcedure.steps.filter((_, order) => order !== index).map((step, order) => ({ ...step, order: order + 1 })) });
  };

  const duplicateStep = (index: number) => {
    if (!activeProcedure) return;
    const step = structuredClone(activeProcedure.steps[index]);
    const suffix = createClientUuid().replaceAll('-', '_');
    step.id = `step_${suffix}`; step.title = `${step.title} (cópia)`; delete step.nextStepId;
    if (step.collectField) { step.collectField.id = `field_${suffix}`; step.collectField.variableKey = `field_${suffix}`; }
    for (const output of step.httpRequest?.outputMappings || step.mcpTool?.outputMappings || []) output.chipKey = `${output.chipKey}_${suffix}`;
    const steps = [...activeProcedure.steps]; steps.splice(index + 1, 0, step);
    updateProcedure({ ...activeProcedure, steps: steps.map((item, order) => ({ ...item, order: order + 1 })) });
    openStepEditor(index + 1, step);
  };

  // Add Step from Sidebar
  const handleAddStepToCurrentContext = (type: ProcedureStepType) => {
    if (viewLevel === 'procedure' && activeProcedure) {
      const newOrder = activeProcedure.steps.length + 1;
      const stepMeta = PROCEDURE_STEP_TYPE_LABELS[type];

      let newStep: ProcedureStep = {
        id: `step_${Date.now()}_${newOrder}`,
        order: newOrder,
        type,
        title: stepMeta.label,
        subtitle: stepMeta.description,
      };

      if (type === 'collect_data') {
        newStep.collectField = {
          id: `field_${Date.now()}`,
          name: 'Dado do cliente',
          variableKey: `collected_${Date.now().toString(36)}`,
          type: 'text',
          required: true,
          promptMessage: 'Por favor, informe este dado.',
          maxAttempts: 3,
          requiresConfirmation: false,
          isSensitive: false,
        };
      } else if (type === 'http_request') {
        newStep.httpRequest = {
          name: 'Chamar API externa',
          method: 'GET',
          url: '',
          authType: 'none',
          sentDataMappings: [],
          outputMappings: [],
          timeoutSeconds: 15,
          maxRetries: 1,
          fallbackAction: 'handoff',
        };
      } else if (type === 'mcp_tool_call') {
        const firstMcpTool = availableMcpTools[0];
        newStep.mcpTool = {
          serverId: firstMcpTool?.serverId || '',
          serverName: firstMcpTool?.serverName,
          friendlyToolName: firstMcpTool?.displayName || 'Selecionar ferramenta MCP',
          qualifiedToolName: firstMcpTool ? String(firstMcpTool.name) : '',
          riskLevel: firstMcpTool?.riskLevel === 'high' ? 'destructive' : 'read_only',
          requiresConfirmation: Boolean(firstMcpTool?.requiresHumanApproval),
          argumentMappings: [],
          outputMappings: [],
          fallbackAction: 'handoff',
        };
      } else if (type === 'decision' || type === 'validate_data') {
        newStep.decisionBranches = [
          { id: 'b1', conditionLabel: 'Se sucesso', actionType: 'continue' },
          { id: 'b2', conditionLabel: 'Caso contrário', isDefault: true, actionType: 'respond', actionValue: 'Não localizei esse dado.' },
        ];
      } else if (type === 'respond' || type === 'message') {
        newStep.messageText = 'Mensagem enviada ao cliente.';
      } else if (type === 'handoff') {
        newStep.handoffTeam = doc.concludeStage.handoffTeam;
        newStep.handoffReason = 'Transferência solicitada pelo procedimento.';
      }

      const updatedProcs = doc.resolveStage.procedures.map((p) =>
        p.id === activeProcedure.id ? { ...p, steps: [...p.steps, newStep] } : p
      );
      setDoc((prev) => ({
        ...prev,
        resolveStage: {
          ...prev.resolveStage,
          procedures: updatedProcs,
        },
      }));
    }
  };

  // Add Assistant Suggested Data Collection Step
  const handleApplyAssistance = (suggestion: (typeof assistanceSuggestions)[0]) => {
    if (!activeProcedure || !suggestion.recommendedField) return;
    const newStep: ProcedureStep = {
      id: `step_auto_${Date.now()}`,
      order: suggestion.suggestedStepIndex + 1,
      type: 'collect_data',
      title: `Coletar ${suggestion.recommendedField.name}`,
      subtitle: `Solicitar ${suggestion.recommendedField.name} para a etapa seguinte`,
      collectField: {
        id: `field_${Date.now()}`,
        name: suggestion.recommendedField.name || 'Dado',
        variableKey: suggestion.recommendedField.variableKey || 'data_key',
        type: suggestion.recommendedField.type || 'text',
        required: true,
        promptMessage: suggestion.recommendedField.promptMessage || 'Por favor, informe este dado.',
        maxAttempts: 3,
        requiresConfirmation: false,
        isSensitive: suggestion.recommendedField.type === 'cpf',
      },
    };

    const newSteps = [...activeProcedure.steps];
    newSteps.splice(suggestion.suggestedStepIndex, 0, newStep);
    // Reorder
    const reordered = newSteps.map((s, idx) => ({ ...s, order: idx + 1 }));

    const updatedProcs = doc.resolveStage.procedures.map((p) =>
      p.id === activeProcedure.id ? { ...p, steps: reordered } : p
    );

    setDoc((prev) => ({
      ...prev,
      resolveStage: {
        ...prev.resolveStage,
        procedures: updatedProcs,
      },
    }));

    toast({
      title: 'Etapa adicionada!',
      description: `Coleta de ${suggestion.recommendedField.name} inserida na posição correta.`,
    });
  };

  // Save Draft Action
  const handleSaveDraft = useCallback(async (silent = false) => {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    const input = currentDocument.current;
    const fingerprint = draftFingerprint(input);
    setSaveError('');
    setIsSaving(true);
    try {
      const res = await saveAgentStudioDraftAction(config.id, input);
      if (!res.success) {
        setSaveError(res.error);
        toast({ title: 'Erro ao salvar rascunho', description: res.error, variant: 'destructive' });
        return;
      }
      savedFingerprint.current = fingerprint;
      // Preserve edits made while saving while advancing the optimistic revision.
      setDoc((current) => ({ ...current, draftRevision: res.document.draftRevision, publishedVersion: res.document.publishedVersion }));
      if (!silent) toast({ title: 'Rascunho salvo', description: 'As alterações capturadas foram salvas. Mudanças feitas durante o salvamento serão salvas em seguida.' });
    } catch {
      setSaveError('Não foi possível salvar. Suas mudanças continuam nesta aba.');
      toast({ title: 'Erro ao salvar', description: 'Tente novamente.', variant: 'destructive' });
    } finally {
      mutationInFlight.current = false;
      setIsSaving(false);
    }
  }, [config.id, toast]);

  // Publish Action with Checklist
  useEffect(() => {
    if (currentFingerprint === savedFingerprint.current || isSaving || isPublishing || saveError) return;
    const timer = window.setTimeout(() => void handleSaveDraft(true), 1000);
    return () => window.clearTimeout(timer);
  }, [currentFingerprint, isSaving, isPublishing, saveError, handleSaveDraft]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (draftFingerprint(currentDocument.current) !== savedFingerprint.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  const handleInitiatePublish = () => {
    const val = validateAgentForPublication(doc);
    setPublicationValidation(val);
    setIsPublishDialogOpen(true);
  };

  const handleConfirmPublish = async () => {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    const input = currentDocument.current;
    const fingerprint = draftFingerprint(input);
    setIsPublishing(true);
    try {
      const res = await publishAgentStudioAction(config.id, input);
      if (!res.success) {
        toast({ title: 'Erro na publicação', description: res.error, variant: 'destructive' });
        return;
      }
      if (res.document) {
        savedFingerprint.current = fingerprint;
        setDoc((current) => draftFingerprint(current) === fingerprint ? res.document : { ...current, draftRevision: res.document.draftRevision, publishedVersion: res.document.publishedVersion });
      }
      setIsPublishDialogOpen(false);
      toast({
        title: 'Agente publicado com sucesso! 🚀',
        description: `Versão v${res.publishedVersion} ativada para o atendimento.`,
      });
    } catch {
      toast({ title: 'Falha na publicação', description: 'Ocorreu um erro ao publicar o agente.', variant: 'destructive' });
    } finally {
      mutationInFlight.current = false;
      setIsPublishing(false);
    }
  };

  const handleRestartChat = () => { setPreviewResetKey((key) => key + 1); if (window.matchMedia('(max-width: 1023px)').matches) setPreviewOpen(true); };

  const handleRestoreVersion = async () => {
    if (!restoreVersion || restoringVersion || mutationInFlight.current) return;
    setRestoringVersion(true);
    try {
      const result = await getStudioVersionForDraftAction(config.id, restoreVersion.id);
      if (!result.success) throw new Error(result.error);
      setDoc((current) => ({ ...result.document, status: 'draft', draftRevision: current.draftRevision, publishedVersion: current.publishedVersion, updatedAt: new Date().toISOString() }));
      setRestoreVersion(null); setActiveTab('flow'); setViewLevel('journey');
      toast({ title: 'Versão recuperada como rascunho', description: 'A publicação em uso não foi alterada. Revise, teste e publique quando estiver pronta.' });
    } catch (error) { toast({ title: 'Não foi possível recuperar a versão', description: error instanceof Error ? error.message : 'Tente novamente.', variant: 'destructive' }); }
    finally { setRestoringVersion(false); }
  };

  const handleLegacyRollback = async () => {
    if (rollingBack || rollbackConfirmation !== 'VOLTAR AO MODO ANTERIOR') return;
    setRollingBack(true);
    try {
      const result = await rollbackAgentStudioToLegacyAction(config.id, rollbackConfirmation);
      if (!result.success) throw new Error(result.error);
      savedFingerprint.current = draftFingerprint(result.document);
      setDoc(result.document); setRollbackOpen(false); setRollbackConfirmation(''); setResultsRevision((value) => value + 1);
      toast({ title: 'Modo anterior restaurado', description: 'Novos atendimentos voltaram ao runtime anterior. O Estúdio e suas versões foram preservados.' });
    } catch (error) { toast({ title: 'Não foi possível voltar ao modo anterior', description: error instanceof Error ? error.message : 'Tente novamente.', variant: 'destructive' }); }
    finally { setRollingBack(false); }
  };

  const handleRevocation = async () => {
    if (!revocationTarget || revoking) return;
    const expected = revocationTarget.sourceId ? 'REVOGAR FONTE' : 'REVOGAR VERSÃO';
    if (revocationConfirmation !== expected) return;
    setRevoking(true);
    try {
      const result = await revokeAgentStudioReleaseAction(config.id, { releaseId: revocationTarget.releaseId,
        sourceId: revocationTarget.sourceId, reason: revocationReason, confirmation: revocationConfirmation });
      if (!result.success) throw new Error(result.error);
      setRevocationTarget(null); setRevocationReason(''); setRevocationConfirmation(''); setResultsRevision((value) => value + 1);
      toast({ title: revocationTarget.sourceId ? 'Fonte revogada' : 'Versão revogada', description: 'O bloqueio foi registrado sem apagar o histórico imutável.' });
    } catch (error) { toast({ title: 'Não foi possível revogar', description: error instanceof Error ? error.message : 'Tente novamente.', variant: 'destructive' }); }
    finally { setRevoking(false); }
  };

  const handleAddMcpServer = async () => {
    if (connectingMcp) return;
    setConnectingMcp(true);
    try {
    const saved = await upsertMcpServerAction({
      workspaceId,
      id: newMcpServer.id,
      headers: newMcpServer.token ? { Authorization: `Bearer ${newMcpServer.token}` } : {},
      name: newMcpServer.name,
      url: newMcpServer.endpoint,
      transport: newMcpServer.transport,
      isActive: true,
    });
    if (!saved.success || !saved.id) {
      toast({ title: 'Não foi possível conectar o MCP', description: saved.error, variant: 'destructive' });
      return;
    }
    setNewMcpServer((previous) => ({ ...previous, id: saved.id }));
    const synced = await syncMcpServerToolsAction(workspaceId, saved.id, true);
    if (!synced.success) {
      toast({ title: 'Servidor conectado, mas as ferramentas não foram importadas', description: synced.error, variant: 'destructive' });
      return;
    }
    setSyncedMcpTools((previous) => [
      ...previous,
      ...(synced.tools || []).map((tool) => ({
        name: tool.qualifiedName,
        displayName: tool.title || tool.name,
        description: tool.description || '',
        source: 'mcp' as const,
        serverId: tool.serverId,
        serverName: tool.serverName,
        riskLevel: tool.annotations?.readOnlyHint ? 'low' as const : 'high' as const,
        requiresHumanApproval: !tool.annotations?.readOnlyHint,
      })),
    ]);
    const refreshed = await listAgentMcpServersAction(config.id);
    if (refreshed.success) setMcpServers(refreshed.servers);
    setIsAddMcpServerOpen(false);
    setNewMcpServer({ name: '', endpoint: '', transport: 'streamable_http' });
    toast({ title: 'MCP conectado', description: `${synced.tools?.length || 0} ferramenta(s) disponíveis no estúdio.` });
    } catch { toast({ title: 'Não foi possível conectar o MCP', description: 'Confira a conexão e tente novamente.', variant: 'destructive' }); }
    finally { setConnectingMcp(false); }
  };

  const handleAddApiConnection = async () => {
    if (savingConnection) return;
    setSavingConnection(true);
    try {
    const saved = await saveAgentApiConnectionAction(config.id, {
      name: newApiConnection.name,
      baseUrl: newApiConnection.baseUrl,
      authType: newApiConnection.authType,
      apiKeyHeader: newApiConnection.apiKeyHeader,
      apiKeyValue: newApiConnection.authType === 'api_key' ? newApiConnection.secret : undefined,
      bearerToken: newApiConnection.authType === 'bearer_token' ? newApiConnection.secret : undefined,
      basicUsername: newApiConnection.authType === 'basic_auth' ? newApiConnection.username : undefined,
      basicPassword: newApiConnection.authType === 'basic_auth' ? newApiConnection.secret : undefined,
    });
    if (!saved.success) {
      toast({ title: 'Não foi possível salvar a conexão', description: saved.error, variant: 'destructive' });
      return;
    }
    setApiConnections((previous) => [...previous, saved.connection]);
    setEditingStepData((previous) => previous?.httpRequest ? {
      ...previous,
      httpRequest: { ...previous.httpRequest, connectionId: saved.connection.id, authType: saved.connection.authType },
    } : previous);
    setIsAddApiConnectionOpen(false);
    setNewApiConnection({ name: '', baseUrl: '', authType: 'none', apiKeyHeader: 'X-API-Key', secret: '', username: '' });
    toast({ title: 'Conexão de API salva', description: 'A credencial foi criptografada e vinculada à etapa.' });
    } catch { toast({ title: 'Não foi possível salvar a conexão', description: 'Tente novamente.', variant: 'destructive' }); }
    finally { setSavingConnection(false); }
  };

  // Step type badge helper for Procedure Level 2
  const getStepBadgeInfo = (step: ProcedureStep) => {
    const meta = PROCEDURE_STEP_TYPE_LABELS[step.type];
    return {
      label: meta?.label || 'Etapa',
      color: meta?.badgeColor || 'bg-slate-100 text-slate-800 border-slate-300',
    };
  };

  const getStepIcon = (step: ProcedureStep) => {
    switch (step.type) {
      case 'collect_data':
        return <HelpCircle className="h-4 w-4 text-sky-600" />;
      case 'knowledge_lookup':
        return <Database className="h-4 w-4 text-indigo-600" />;
      case 'validate_data':
        return <ShieldCheck className="h-4 w-4 text-amber-600" />;
      case 'native_action':
        return <Zap className="h-4 w-4 text-purple-600" />;
      case 'http_request':
        return <Globe className="h-4 w-4 text-orange-600" />;
      case 'mcp_tool_call':
        return <Server className="h-4 w-4 text-violet-600" />;
      case 'decision':
        return <GitBranch className="h-4 w-4 text-fuchsia-600" />;
      case 'handoff':
        return <Headphones className="h-4 w-4 text-rose-600" />;
      case 'finish':
        return <CheckCircle2 className="h-4 w-4 text-slate-600" />;
      case 'respond':
      case 'message':
      default:
        return <MessageSquare className="h-4 w-4 text-emerald-600" />;
    }
  };

  return (
    <div className="flex h-screen w-full flex-col bg-[#0b131f] text-slate-100 overflow-hidden font-sans">
      {/* 1. TOP GLOBAL HEADER */}
      <header className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-[#070b12] px-3 py-2 xl:px-5">
        <div className="flex min-w-0 flex-wrap items-center gap-3 xl:gap-6">
          {/* Logo */}
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
              <Sparkles className="h-4 w-4" />
            </div>
            <span className="text-base font-bold tracking-tight text-white">Dialogy AI</span>
          </div>

          {/* Title with edit pencil */}
          <div className="flex items-center gap-2 border-l border-slate-800 pl-4">
            {isEditingName ? (
              <Input
                value={doc.name}
                onChange={(e) => setDoc((prev) => ({ ...prev, name: e.target.value }))}
                onBlur={() => setIsEditingName(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setIsEditingName(false);
                }}
                autoFocus
                className="h-7 w-56 bg-slate-900 border-slate-700 text-xs text-white"
              />
            ) : (
              <button
                type="button"
                onClick={() => setIsEditingName(true)}
                className="flex items-center gap-2 text-sm font-semibold text-slate-200 hover:text-white transition"
              >
                <span>{doc.name}</span>
                <Pencil className="h-3.5 w-3.5 text-slate-500 hover:text-slate-300" />
              </button>
            )}
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setActiveTab('flow')}
              className={cn(
                'relative px-3 py-1.5 text-xs font-semibold transition',
                activeTab === 'flow' ? 'text-white' : 'text-slate-400 hover:text-slate-200'
              )}
            >
              Fluxo
              {activeTab === 'flow' && (
                <div className="absolute bottom-[-14px] left-0 right-0 h-0.5 bg-emerald-500 rounded-full" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('appearance')}
              className={cn(
                'relative px-3 py-1.5 text-xs font-semibold transition',
                activeTab === 'appearance' ? 'text-white' : 'text-slate-400 hover:text-slate-200'
              )}
            >
              Aparência
              {activeTab === 'appearance' && (
                <div className="absolute bottom-[-14px] left-0 right-0 h-0.5 bg-emerald-500 rounded-full" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('rules')}
              className={cn(
                'relative px-3 py-1.5 text-xs font-semibold transition',
                activeTab === 'rules' ? 'text-white' : 'text-slate-400 hover:text-slate-200'
              )}
            >
              Regras
              {activeTab === 'rules' && (
                <div className="absolute bottom-[-14px] left-0 right-0 h-0.5 bg-emerald-500 rounded-full" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('results')}
              className={cn(
                'relative px-3 py-1.5 text-xs font-semibold transition',
                activeTab === 'results' ? 'text-white' : 'text-slate-400 hover:text-slate-200'
              )}
            >
              Resultados
              {activeTab === 'results' && (
                <div className="absolute bottom-[-14px] left-0 right-0 h-0.5 bg-emerald-500 rounded-full" />
              )}
            </button>
          </div>
        </div>

        {/* Right Action Buttons */}
        <div className="flex items-center gap-2.5">
          <button type="button" onClick={() => void handleSaveDraft()} disabled={isSaving || isPublishing} title={saveError || 'Salvar rascunho'} className={cn('max-w-48 truncate text-[11px]', saveError ? 'text-amber-300' : 'text-slate-400')}>
            {saveError ? 'Falha ao salvar · tentar novamente' : isSaving ? 'Salvando…' : currentFingerprint !== savedFingerprint.current ? 'Alterações pendentes' : 'Rascunho salvo'}
          </button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRestartChat}
            className="h-8 rounded-lg border border-slate-700/80 bg-slate-900/60 px-3 text-xs font-medium text-slate-200 hover:bg-slate-800"
          >
            <Play className="mr-1.5 h-3.5 w-3.5 text-emerald-400" />
            Testar
          </Button>

          <Button
            size="sm"
            onClick={handleInitiatePublish}
            disabled={isPublishing || isSaving}
            className="h-8 rounded-lg bg-emerald-600 px-3.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-500"
          >
            <Cloud className="mr-1.5 h-3.5 w-3.5" />
            {isPublishing ? 'Publicando…' : 'Publicar'}
            <ChevronDown className="ml-1 h-3 w-3 opacity-70" />
          </Button>
        </div>
      </header>

      {/* 2. MAIN WORKSPACE BODY */}
      <div className="flex flex-1 overflow-hidden">
        {/* 2A. LEFT SIDEBAR */}
        <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-800 bg-[#070e17] p-4 text-slate-200 xl:flex">
          {viewLevel === 'journey' ? (
            /* Sidebar for Level 1 (Journey) */
            <>
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Adicionar etapas</h3>
                <p className="mt-1 text-[11px] text-slate-500 leading-tight">
                  Clique para configurar cada parte do agente.
                </p>
              </div>

              <div className="mt-5 space-y-3 overflow-y-auto pr-1">
                {/* 1. Mensagens */}
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 mb-1.5">
                    <MessageSquare className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Mensagens</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setStageSettings('understand');
                    }}
                    className="flex w-full items-center justify-between rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-xs text-slate-200 hover:border-slate-700 hover:bg-slate-800/90 transition shadow-sm"
                  >
                    <div className="flex items-center gap-2">
                      <MessageSquare className="h-3.5 w-3.5 text-slate-400" />
                      <span>Enviar texto</span>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-slate-600" />
                  </button>
                </div>

                {/* 2. Coleta de dados */}
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 mb-1.5">
                    <HelpCircle className="h-3.5 w-3.5 text-sky-400" />
                    <span>Coleta de dados</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setDoc((prev) => ({
                        ...prev,
                        understandStage: { ...prev.understandStage, askInitialData: true },
                      }));
                      setStageSettings('understand');
                    }}
                    className="flex w-full items-center justify-between rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-xs text-slate-200 hover:border-slate-700 hover:bg-slate-800/90 transition shadow-sm"
                  >
                    <div className="flex items-center gap-2">
                      <HelpCircle className="h-3.5 w-3.5 text-slate-400" />
                      <span>Pedir informação</span>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-slate-600" />
                  </button>
                </div>

                {/* 3. Decisões */}
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 mb-1.5">
                    <GitBranch className="h-3.5 w-3.5 text-fuchsia-400" />
                    <span>Decisões</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setStageSettings('conclude');
                    }}
                    className="flex w-full items-center justify-between rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-xs text-slate-200 hover:border-slate-700 hover:bg-slate-800/90 transition shadow-sm"
                  >
                    <div className="flex items-center gap-2">
                      <GitBranch className="h-3.5 w-3.5 text-slate-400" />
                      <span>Escolher caminho</span>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-slate-600" />
                  </button>
                </div>

                {/* 4. Ações & APIs */}
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 mb-1.5">
                    <Zap className="h-3.5 w-3.5 text-orange-400" />
                    <span>Ações & APIs</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleCreateNewProcedure}
                    className="flex w-full items-center justify-between rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-xs text-slate-200 hover:border-slate-700 hover:bg-slate-800/90 transition shadow-sm"
                  >
                    <div className="flex items-center gap-2">
                      <Globe className="h-3.5 w-3.5 text-slate-400" />
                      <span>Chamar API / Sistema</span>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-slate-600" />
                  </button>
                </div>

                {/* 5. Equipe */}
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 mb-1.5">
                    <Headphones className="h-3.5 w-3.5 text-rose-400" />
                    <span>Equipe</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setStageSettings('conclude');
                    }}
                    className="flex w-full items-center justify-between rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-xs text-slate-200 hover:border-slate-700 hover:bg-slate-800/90 transition shadow-sm"
                  >
                    <div className="flex items-center gap-2">
                      <Headphones className="h-3.5 w-3.5 text-slate-400" />
                      <span>Transferir atendimento</span>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-slate-600" />
                  </button>
                </div>
              </div>
            </>
          ) : viewLevel === 'procedure' || viewLevel === 'step' ? (
            /* Sidebar for Level 2 (Procedure List) */
            <>
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Procedimentos do agente</h3>
                <p className="mt-1 text-[11px] text-slate-500 leading-tight">
                  Processos que a IA pode executar do início ao fim.
                </p>
              </div>

              <div className="mt-4 space-y-2 overflow-y-auto pr-1">
                {doc.resolveStage.procedures.map((proc) => {
                  const isActive = proc.id === activeProcedure?.id;
                  return (
                    <button
                      key={proc.id}
                      type="button"
                      onClick={() => setActiveProcedureId(proc.id)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-xs font-medium transition shadow-sm',
                        isActive
                          ? 'border-emerald-500/50 bg-emerald-500/10 text-white'
                          : 'border-slate-800 bg-slate-900/60 text-slate-300 hover:border-slate-700 hover:bg-slate-800/70'
                      )}
                    >
                      <FileText className={cn('h-4 w-4 shrink-0', isActive ? 'text-emerald-400' : 'text-slate-400')} />
                      <span className="truncate">{proc.name}{proc.status === 'archived' ? ' · arquivado' : ''}</span>
                    </button>
                  );
                })}

                <button
                  type="button"
                  onClick={handleCreateNewProcedure}
                  className="flex w-full items-center gap-2 rounded-xl border border-dashed border-slate-700/80 bg-slate-900/30 px-3 py-2.5 text-xs text-slate-400 hover:border-emerald-500/50 hover:text-emerald-400 transition"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Novo procedimento</span>
                </button>
              </div>

              <div className="mt-6 overflow-y-auto border-t border-slate-800 pt-4">
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Adicionar ao procedimento</h4>
                <div className="mt-2.5 space-y-1.5">
                  {PROCEDURE_STEP_TYPES.map((type) => <button key={type} type="button" onClick={() => handleAddStepToCurrentContext(type)} className="flex w-full items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/70 p-2 text-left text-xs text-slate-300 hover:bg-slate-800 hover:text-white">
                    {getStepIcon({ type } as ProcedureStep)}{PROCEDURE_STEP_TYPE_LABELS[type].label}
                  </button>)}
                </div>
              </div>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setViewLevel('journey')} className="flex items-center gap-2 text-xs font-semibold text-slate-300 transition hover:text-white">
                <ChevronRight className="h-3.5 w-3.5 rotate-180" />Voltar à jornada
              </button>
              <div className="mt-6 rounded-xl border border-violet-500/20 bg-violet-500/10 p-4">
                <Database className="h-5 w-5 text-violet-300" />
                <h3 className="mt-3 text-xs font-bold text-white">Conhecimento da IA</h3>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-400">Gerencie aqui as fontes que o agente consulta antes de responder.</p>
                <div className="mt-3 rounded-lg bg-slate-950/40 p-3"><strong className="text-lg text-white">{activeKnowledgeCount}</strong><span className="ml-2 text-[10px] text-slate-400">fontes ativas</span></div>
              </div>
            </>
          )}
        </aside>

        {/* 2B. CENTER MAIN CANVAS */}
        <main className="min-w-0 flex-1 overflow-y-auto bg-[#f8fafc] p-3 text-slate-900 sm:p-5 xl:p-8">
          {requiresMigrationReview && !doc.publishedVersion && (migrationReport ? <StudioMigrationReview report={migrationReport} document={doc} onChange={setDoc} /> : <div role="status" className="mx-auto mb-5 max-w-2xl rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-900">Este agente possui configuração anterior preservada. Reabra o Estúdio para carregar o relatório de transição antes de publicar.</div>)}
          {activeTab === 'flow' ? (
            viewLevel === 'journey' ? (
              /* ========================================================= */
              /* LEVEL 1: MAIN CONVERSATIONAL JOURNEY CANVAS              */
              /* ========================================================= */
              <div className="mx-auto max-w-2xl space-y-6">
                {/* STAGE 1: Entender o cliente */}
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 text-xs font-bold text-white shadow-sm">
                      1
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">1. Entender o cliente</h3>
                      <p className="text-xs text-slate-500">Receba o cliente e entenda rapidamente o que ele precisa.</p>
                    </div>
                  </div>

                  <div className="mt-4 space-y-2.5">
                    {/* Welcome Step Card */}
                    <div className="group flex items-center justify-between rounded-xl border border-slate-200/90 bg-white px-4 py-3 shadow-xs hover:border-slate-300 transition">
                      <div className="flex items-center gap-3">
                        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-100">
                          <MessageSquare className="h-4 w-4" />
                        </div>
                        <div>
                          <button type="button" onClick={() => setStageSettings('understand')} className="text-xs font-semibold text-slate-900 hover:text-emerald-700">Dar boas-vindas · editar</button>
                          <p className="text-[11px] text-slate-500">{doc.understandStage.welcomeMessage}</p>
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-slate-300 opacity-0 group-hover:opacity-100 transition" />
                    </div>

                    {/* Discovery Step Card */}
                    <div className="group flex items-center justify-between rounded-xl border border-slate-200/90 bg-white px-4 py-3 shadow-xs hover:border-slate-300 transition">
                      <div className="flex items-center gap-3">
                        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-50 text-sky-600 border border-sky-100">
                          <HelpCircle className="h-4 w-4" />
                        </div>
                        <div>
                          <button type="button" onClick={() => setStageSettings('understand')} className="text-xs font-semibold text-slate-900 hover:text-emerald-700">Descobrir o que precisa · editar</button>
                          <p className="text-[11px] text-slate-500">{doc.understandStage.askInitialData && doc.understandStage.initialFields.length ? doc.understandStage.initialFields.map((field) => field.name).join(' · ') : 'Identificar a intenção do cliente'}</p>
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-slate-300 opacity-0 group-hover:opacity-100 transition" />
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setStageSettings('understand');
                      }}
                      className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-200 py-2.5 text-xs font-medium text-emerald-600 hover:bg-emerald-50/50 hover:border-emerald-300 transition"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>Adicionar etapa</span>
                    </button>
                  </div>
                </div>

                {/* Connecting Arrow */}
                <div className="flex justify-center">
                  <ArrowDown className="h-5 w-5 text-slate-300" />
                </div>

                {/* STAGE 2: Resolver com IA */}
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-purple-600 text-xs font-bold text-white shadow-sm">
                      2
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">2. Resolver com IA</h3>
                      <p className="text-xs text-slate-500">
                        A IA busca a melhor resposta e realiza ações para resolver.
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 space-y-2.5">
                    {/* Purple Interactive AI Card */}
                    <div className="rounded-xl border border-purple-200 bg-purple-50/50 p-4 transition shadow-xs">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-100 text-purple-700">
                            <Sparkles className="h-4 w-4" />
                          </div>
                          <span className="text-xs font-bold text-slate-900">Buscar resposta e executar ações</span>
                        </div>
                        <ChevronRight className="h-4 w-4 text-slate-400" />
                      </div>

                      <button type="button" onClick={() => setViewLevel('knowledge')} className="mt-3 flex w-full items-center justify-between gap-3 rounded-xl border border-violet-200 bg-white p-3 text-left shadow-2xs transition hover:border-violet-400 hover:bg-violet-50">
                        <span className="flex min-w-0 items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><Database className="h-4 w-4" /></span><span className="min-w-0"><span className="block text-xs font-bold text-slate-900">Conhecimento e RAG</span><span className="block truncate text-[11px] text-slate-500">Abra para escolher documentos, enviar arquivos ou escrever informações.</span></span></span>
                        <span className="flex shrink-0 items-center gap-2"><Badge className={activeKnowledgeCount ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100' : 'bg-slate-100 text-slate-600 hover:bg-slate-100'}>{activeKnowledgeCount ? `${activeKnowledgeCount} fonte${activeKnowledgeCount === 1 ? '' : 's'}` : 'Configurar'}</Badge><ChevronRight className="h-4 w-4 text-slate-400" /></span>
                      </button>

                      <div className="mt-5 space-y-3 border-t border-purple-100 pt-4">
                        <div className="flex items-center justify-between gap-3">
                          <div><h4 className="text-xs font-bold text-slate-900">Procedimentos</h4><p className="mt-0.5 text-[10px] text-slate-500">Cada procedimento ensina a IA a resolver um tipo de solicitação.</p></div>
                          <Badge variant="outline" className="border-purple-200 bg-white text-purple-700">{doc.resolveStage.procedures.length}</Badge>
                        </div>

                        {doc.resolveStage.procedures.length ? <div className="space-y-2">{doc.resolveStage.procedures.map((proc, index) => (
                          <div key={proc.id} className="rounded-xl border border-purple-200 bg-white p-3 shadow-2xs transition hover:border-purple-300">
                            <div className="flex items-start gap-3">
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-purple-100 text-xs font-bold text-purple-700">{index + 1}</span>
                              <button type="button" onClick={() => handleOpenProcedure(proc.id)} className="min-w-0 flex-1 text-left">
                                <span className="block truncate text-xs font-bold text-slate-900">{proc.name}</span>
                                <span className="mt-1 block line-clamp-2 text-[10px] leading-relaxed text-slate-500">{proc.objective || proc.description || 'Defina quando usar e quais etapas a IA deve seguir.'}</span>
                                <span className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold text-purple-700">{proc.steps.length} etapa{proc.steps.length === 1 ? '' : 's'} <ChevronRight className="h-3 w-3" /></span>
                              </button>
                              {deleteProcedureId !== proc.id && <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Excluir procedimento ${proc.name}`} onClick={() => setDeleteProcedureId(proc.id)}><Trash2 className="h-3.5 w-3.5" /></Button>}
                            </div>
                            {deleteProcedureId === proc.id && <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5"><span className="text-[10px] font-medium text-red-800">Excluir “{proc.name}”? Esta ação remove todas as etapas.</span><span className="flex gap-1"><Button type="button" size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => setDeleteProcedureId(null)}>Cancelar</Button><Button type="button" size="sm" variant="destructive" className="h-7 text-[10px]" onClick={() => removeProcedure(proc.id)}>Excluir</Button></span></div>}
                          </div>
                        ))}</div> : <div className="rounded-xl border border-dashed border-purple-200 bg-white/70 p-4 text-center text-[11px] text-slate-500">Nenhum procedimento criado. Adicione o primeiro para ensinar uma tarefa à IA.</div>}

                        <button type="button" onClick={handleCreateNewProcedure} className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-purple-300 bg-white py-2.5 text-xs font-semibold text-purple-700 transition hover:bg-purple-100/60"><Plus className="h-3.5 w-3.5" />Adicionar procedimento</button>
                      </div>
                    </div>

                  </div>
                </div>

                {/* Connecting Arrow */}
                <div className="flex justify-center">
                  <ArrowDown className="h-5 w-5 text-slate-300" />
                </div>

                {/* STAGE 3: Concluir o atendimento */}
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 text-xs font-bold text-white shadow-sm">
                      3
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">3. Concluir o atendimento</h3>
                      <p className="text-xs text-slate-500">
                        Confirme a solução e encerre ou conecte com alguém do time.
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 space-y-3">
                    {/* Decision Box */}
                    <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <GitBranch className="h-4 w-4 text-slate-600" />
                          <span className="text-xs font-bold text-slate-900">{doc.concludeStage.confirmResolutionQuestion}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                            Sim
                          </span>
                          <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                            Não
                          </span>
                        </div>
                      </div>

                      {/* Two Branches */}
                      <div className="mt-3 grid grid-cols-2 gap-3 pt-2">
                        {/* Sim */}
                        <div className="space-y-1.5">
                          <span className="text-[10px] font-bold text-emerald-700">Sim</span>
                          <button type="button" onClick={() => setStageSettings('conclude')} className="flex w-full items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 text-left shadow-2xs">
                            <div className="flex items-center gap-2">
                              <MessageSquare className="h-3.5 w-3.5 text-emerald-700" />
                              <span className="text-xs font-semibold text-slate-900">Responder e concluir</span>
                            </div>
                            <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                          </button>
                        </div>

                        {/* Não */}
                        <div className="space-y-1.5">
                          <span className="text-[10px] font-bold text-amber-700">Não</span>
                          <button type="button" onClick={() => setStageSettings('conclude')} className="flex w-full items-center justify-between rounded-xl border border-amber-200 bg-amber-50/40 p-3 text-left shadow-2xs">
                            <div className="flex items-center gap-2">
                              <Headphones className="h-3.5 w-3.5 text-amber-700" />
                              <span className="text-xs font-semibold text-slate-900">{doc.concludeStage.handoffTeam ? `Chamar ${resources.teams.find((team) => team.id === doc.concludeStage.handoffTeam || team.name === doc.concludeStage.handoffTeam)?.name || 'equipe selecionada'}` : 'Selecionar equipe'}</span>
                            </div>
                            <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                          </button>
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setStageSettings('conclude')}
                      className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-200 py-2.5 text-xs font-medium text-emerald-600 hover:bg-emerald-50/50 hover:border-emerald-300 transition"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>Adicionar etapa</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : viewLevel === 'knowledge' ? (
              <div className="mx-auto max-w-4xl space-y-5">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <button type="button" onClick={() => setViewLevel('journey')} className="font-medium transition hover:text-emerald-700">Jornada conversacional</button>
                  <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                  <button type="button" onClick={() => setViewLevel('journey')} className="font-medium transition hover:text-emerald-700">Resolver com IA</button>
                  <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                  <span className="font-semibold text-slate-900">Conhecimento e RAG</span>
                </div>
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
                  <div><h2 className="text-lg font-bold text-slate-900">Conhecimento e RAG</h2><p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">Defina as informações que este agente pode consultar. Tudo é configurado nesta página e salvo automaticamente no rascunho.</p></div>
                  <Button type="button" variant="outline" size="sm" onClick={() => setViewLevel('journey')}><ChevronRight className="mr-1.5 h-3.5 w-3.5 rotate-180" />Voltar</Button>
                </div>
                <StudioKnowledgeSources document={doc} onChange={setDoc} collections={existingKnowledgeCollections} documents={knowledgeDocuments} />
              </div>
            ) : viewLevel === 'step' ? (
              <div className="mx-auto max-w-4xl space-y-5">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <button type="button" onClick={() => setViewLevel('journey')} className="font-medium transition hover:text-emerald-700">Jornada conversacional</button>
                  <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                  <button type="button" onClick={() => setViewLevel('procedure')} className="font-medium transition hover:text-emerald-700">{activeProcedure?.name}</button>
                  <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                  <span className="font-semibold text-slate-900">{editingStepData?.title || 'Editar etapa'}</span>
                </div>
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
                  <div><h2 className="text-lg font-bold text-slate-900">Editar etapa</h2><p className="mt-1 text-xs text-slate-500">Configure esta etapa com espaço e contexto, sem sair do procedimento.</p></div>
                  <Button type="button" variant="outline" size="sm" onClick={closeStepEditor}><ChevronRight className="mr-1.5 h-3.5 w-3.5 rotate-180" />Voltar ao procedimento</Button>
                </div>
                <div className="dark rounded-2xl border border-slate-800 bg-[#0f172a] p-5 text-slate-100 shadow-sm sm:p-6">
                  <div className="mb-5"><h3 className="text-base font-bold text-white">{editingStepData?.title}</h3><p className="mt-1 text-xs text-slate-400">Ajuste as configurações desta etapa. As mudanças só entram no procedimento quando você salvar.</p></div>
          {editingStepData && (
            <div className="space-y-4 py-3">
              <div>
                <Label className="text-xs text-slate-300">Título da Etapa</Label>
                <Input
                  value={editingStepData.title}
                  onChange={(e) =>
                    setEditingStepData((prev) => (prev ? { ...prev, title: e.target.value } : null))
                  }
                  className="mt-1 bg-slate-900 border-slate-700 text-xs text-white"
                />
              </div>

              {/* Collect Data Field Config */}
              {editingStepData.type === 'collect_data' && editingStepData.collectField && <StudioFieldEditor crmFields={resources.fields} field={editingStepData.collectField} onChange={(field) => setEditingStepData((previous) => previous ? { ...previous, collectField: field } : null)} />}

              {editingStepData.type === 'http_request' && editingStepData.httpRequest && (
                <div className="space-y-3 rounded-xl border border-orange-500/20 bg-orange-500/5 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-orange-300">Chamada de API</h4>
                      <p className="text-[10px] text-slate-400">Informe o endpoint. Credenciais nunca devem ser colocadas na URL.</p>
                    </div>
                    <Badge variant="outline" className="border-orange-500/30 text-[10px] text-orange-300">HTTP/REST</Badge>
                  </div>
                  <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                    <div>
                      <Label className="text-xs text-slate-300">Conexão segura <span className="text-slate-500">(opcional)</span></Label>
                      <select
                        value={editingStepData.httpRequest.connectionId || ''}
                        onChange={(event) => {
                          const connection = apiConnections.find((item) => item.id === event.target.value);
                          setEditingStepData((previous) => previous?.httpRequest ? {
                            ...previous,
                            httpRequest: {
                              ...previous.httpRequest,
                              connectionId: connection?.id || undefined,
                              authType: connection?.authType || 'none',
                            },
                          } : previous);
                        }}
                        className="mt-1 h-9 w-full rounded-md border border-slate-800 bg-slate-950 px-3 text-xs text-white"
                      >
                        <option value="">Sem conexão (URL pública)</option>
                        {apiConnections.map((connection) => <option key={connection.id} value={connection.id}>{connection.name} · {connection.baseUrl}</option>)}
                      </select>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={() => setIsAddApiConnectionOpen(true)} className="h-9 text-[11px]">
                      <Plus className="mr-1 h-3 w-3" />Nova conexão
                    </Button>
                  </div>
                  <div className="grid grid-cols-[110px_1fr] gap-2">
                    <div>
                      <Label className="text-xs text-slate-300">Método</Label>
                      <select
                        value={editingStepData.httpRequest.method}
                        onChange={(event) => setEditingStepData((previous) => previous?.httpRequest ? {
                          ...previous,
                          httpRequest: { ...previous.httpRequest, method: event.target.value as HttpRequestStepConfig['method'] },
                        } : previous)}
                        className="mt-1 h-9 w-full rounded-md border border-slate-800 bg-slate-950 px-2 text-xs text-white"
                      >
                        {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => <option key={method}>{method}</option>)}
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs text-slate-300">{editingStepData.httpRequest.connectionId ? 'Caminho do endpoint' : 'URL completa'}</Label>
                      <Input
                        value={editingStepData.httpRequest.url}
                        onChange={(event) => setEditingStepData((previous) => previous?.httpRequest ? {
                          ...previous,
                          httpRequest: { ...previous.httpRequest, url: event.target.value },
                        } : previous)}
                        placeholder={editingStepData.httpRequest.connectionId ? '/v1/clientes' : 'https://api.suaempresa.com/v1/clientes'}
                        className="mt-1 bg-slate-950 border-slate-800 text-xs text-white"
                      />
                    </div>
                  </div>
                  <details>
                    <summary className="cursor-pointer text-xs text-slate-400">Avançado · corpo JSON fixo (opcional)</summary>
                    <Textarea
                      value={editingStepData.httpRequest.bodyJson || ''}
                      onChange={(event) => setEditingStepData((previous) => previous?.httpRequest ? {
                        ...previous,
                        httpRequest: { ...previous.httpRequest, bodyJson: event.target.value },
                      } : previous)}
                      placeholder={'{"channel":"web"}'}
                      rows={3}
                      className="mt-1 font-mono bg-slate-950 border-slate-800 text-xs text-white"
                    />
                  </details>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3 text-[11px] text-slate-400">
                    Dados coletados podem ser enviados por mapeamentos guiados. A IA só usa campos coletados em etapas anteriores.
                  </div>
                </div>
              )}

              {editingStepData.type === 'mcp_tool_call' && editingStepData.mcpTool && (
                <div className="space-y-3 rounded-xl border border-violet-500/20 bg-violet-500/5 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="text-xs font-bold text-violet-300">Ferramenta MCP</h4>
                      <p className="text-[10px] text-slate-400">Escolha uma ferramenta disponível em um servidor conectado.</p>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={() => setIsAddMcpServerOpen(true)} className="h-7 text-[10px]">
                      <Plus className="mr-1 h-3 w-3" />Conectar MCP
                    </Button>
                  </div>
                  <div>
                    <Label className="text-xs text-slate-300">Ferramenta</Label>
                    <select
                      value={editingStepData.mcpTool.qualifiedToolName}
                      onChange={(event) => {
                        const tool = availableMcpTools.find((item) => item.name === event.target.value);
                        setEditingStepData((previous) => previous?.mcpTool ? {
                          ...previous,
                          mcpTool: {
                            ...previous.mcpTool,
                            serverId: tool?.serverId || '',
                            serverName: tool?.serverName,
                            qualifiedToolName: tool ? String(tool.name) : '',
                            friendlyToolName: tool?.displayName || 'Selecionar ferramenta MCP',
                            riskLevel: tool?.riskLevel === 'high' ? 'destructive' : tool?.riskLevel === 'medium' ? 'sensitive' : 'read_only',
                            requiresConfirmation: Boolean(tool?.requiresHumanApproval),
                            argumentMappings: [],
                            outputMappings: [],
                          },
                        } : previous);
                      }}
                      className="mt-1 h-9 w-full rounded-md border border-slate-800 bg-slate-950 px-3 text-xs text-white"
                    >
                      <option value="">Selecione uma ferramenta</option>
                      {availableMcpTools.map((tool) => (
                        <option key={tool.name} value={tool.name}>{tool.displayName || tool.name} · {tool.serverName}</option>
                      ))}
                    </select>
                  </div>
                  {editingStepData.mcpTool.qualifiedToolName ? (
                    <div className="flex flex-wrap gap-2 text-[10px]">
                      <Badge variant="outline" className="border-violet-500/30 text-violet-300">{editingStepData.mcpTool.serverName}</Badge>
                      <Badge variant="outline" className="border-slate-700 text-slate-300">{({ read_only: 'Somente consulta', write: 'Altera dados', sensitive: 'Dados sensíveis', destructive: 'Ação crítica' } as Record<string, string>)[editingStepData.mcpTool.riskLevel] || 'Requer revisão'}</Badge>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-slate-700 p-3 text-[11px] text-slate-400">
                      {mcpServers.length ? 'Sincronize o servidor para importar suas ferramentas.' : 'Nenhum servidor MCP conectado neste workspace.'}
                    </div>
                  )}
                </div>
              )}

              {(editingStepData.httpRequest || editingStepData.mcpTool) && <StudioIntegrationFields
                key={`${editingStepData.id}:${editingStepData.mcpTool?.qualifiedToolName || editingStepData.httpRequest?.connectionId || ''}`}
                agentId={config.id}
                step={editingStepData}
                onChange={setEditingStepData}
                data={availableStudioData(doc, activeProcedure, editingStepIndex ?? 0).filter((item) => item.guaranteed || item.sourceType === 'contact_property')}
                tool={mcpServers.flatMap((server) => server.tools).find((tool) => tool.qualifiedName === editingStepData.mcpTool?.qualifiedToolName)}
              />}

              <StudioStepOptions step={editingStepData} onChange={setEditingStepData} data={availableStudioData(doc, activeProcedure, editingStepIndex ?? 0)} procedure={activeProcedure} resources={resources} collections={knowledgeCollections} />
              {/* Message / Response Config */}
              {(editingStepData.type === 'respond' || editingStepData.type === 'message') && (
                <div>
                  <Label className="text-xs text-slate-300">Mensagem Enviada</Label>
                  <Textarea
                    value={editingStepData.messageText || ''}
                    onChange={(e) =>
                      setEditingStepData((prev) => (prev ? { ...prev, messageText: e.target.value } : null))
                    }
                    rows={3}
                    className="mt-1 bg-slate-900 border-slate-700 text-xs text-white"
                  />
                </div>
              )}
            </div>
          )}

                  <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-slate-800 pt-4">
                    <Button type="button" variant="ghost" size="sm" onClick={closeStepEditor} className="text-xs">Cancelar</Button>
                    <Button type="button" size="sm" onClick={saveStepEditor} className="bg-emerald-600 text-xs font-semibold text-white hover:bg-emerald-500">Salvar alterações</Button>
                  </div>
                </div>
              </div>
            ) : (
              /* ========================================================= */
              /* LEVEL 2: PROCEDURE STUDIO CANVAS                          */
              /* ========================================================= */
              <div className="mx-auto max-w-3xl space-y-6">
                {/* Breadcrumb */}
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <button
                    type="button"
                    onClick={() => setViewLevel('journey')}
                    className="hover:text-emerald-700 transition font-medium"
                  >
                    Jornada conversacional
                  </button>
                  <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                  <button
                    type="button"
                    onClick={() => setViewLevel('journey')}
                    className="hover:text-emerald-700 transition font-medium"
                  >
                    Resolver com IA
                  </button>
                  <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                  <span className="font-semibold text-slate-900">{activeProcedure?.name}</span>
                </div>

                {/* Proactive Assistant Suggestions Banner */}
                {assistanceSuggestions.length > 0 && (
                  <div className="rounded-2xl border border-sky-200 bg-sky-50/80 p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-500 text-white shrink-0 shadow-xs">
                          <Sparkles className="h-4 w-4" />
                        </div>
                        <div>
                          <h4 className="text-xs font-bold text-sky-950">{assistanceSuggestions[0].title}</h4>
                          <p className="mt-0.5 text-xs text-sky-800 leading-relaxed">
                            {assistanceSuggestions[0].description}
                          </p>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => handleApplyAssistance(assistanceSuggestions[0])}
                        className="h-8 bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold shrink-0 shadow-xs"
                      >
                        <Plus className="mr-1.5 h-3.5 w-3.5" />
                        Adicionar coleta
                      </Button>
                    </div>
                  </div>
                )}

                {/* Procedure Header Box */}
                <div className="flex flex-col gap-4 border-b border-slate-200 pb-4">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">Procedimento: {activeProcedure?.name}</h2>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {activeProcedure?.description || 'A IA segue estas etapas para resolver a solicitação do cliente.'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => setEditingProcedure(true)}>Definir procedimento</Button>
                    <Button variant="outline" size="sm" onClick={() => activeProcedure && updateProcedure({ ...activeProcedure, status: activeProcedure.status === 'archived' ? 'draft' : 'archived' })}>{activeProcedure?.status === 'archived' ? 'Reativar' : 'Arquivar'}</Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRestartChat}
                      className="h-8 rounded-lg border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-100"
                    >
                      <Play className="mr-1.5 h-3.5 w-3.5 text-emerald-600" />
                      Testar procedimento
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => void handleSaveDraft()}
                      disabled={isSaving}
                      className="h-8 rounded-lg bg-emerald-600 px-3.5 text-xs font-semibold text-white hover:bg-emerald-500 shadow-xs"
                    >
                      Salvar
                    </Button>
                  </div>
                </div>

                {/* Linear Steps Flow */}
                <div className="space-y-4">
                  {activeProcedure?.steps.map((step, idx) => {
                    const badgeInfo = getStepBadgeInfo(step);
                    const icon = getStepIcon(step);

                    return (
                      <React.Fragment key={step.id}>
                        {/* Step Card */}
                        <div className="relative">
                          <div
                            role="button"
                            tabIndex={0}
                            aria-label={`Configurar ${step.title}`}
                            onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openStepEditor(idx, step); } }}
                            onClick={() => openStepEditor(idx, step)}
                            className={cn(
                              'group flex flex-col items-stretch justify-between gap-3 rounded-xl border bg-white p-4 shadow-xs hover:shadow-sm cursor-pointer transition sm:flex-row sm:items-center',
                              step.type === 'mcp_tool_call' || step.type === 'http_request'
                                ? 'border-violet-200 hover:border-violet-300'
                                : 'border-slate-200 hover:border-slate-300'
                            )}
                          >
                            <div className="flex min-w-0 flex-1 items-center gap-4">
                              {/* Step Number Badge */}
                              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-xs font-bold text-white shadow-2xs">
                                {step.order || idx + 1}
                              </div>

                              {/* Icon Surface */}
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-50 border border-slate-100">
                                {icon}
                              </div>

                              {/* Title & Description */}
                              <div>
                                <div className="flex items-center gap-2">
                                  <h4 className="text-xs font-bold text-slate-900">{step.title}</h4>
                                </div>
                                <p className="text-[11px] text-slate-500">
                                  {step.subtitle || step.messageText || (step.collectField ? step.collectField.promptMessage : 'Clique para configurar esta etapa')}
                                </p>
                              </div>
                            </div>

                            <div className="flex shrink-0 items-center justify-end gap-3">
                              <Badge variant="outline" className={cn('text-[10px] font-semibold', badgeInfo.color)}>
                                {badgeInfo.label}
                              </Badge>
                              <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-600" aria-label={`Mover ${step.title} para cima`} disabled={idx === 0} onClick={() => moveStep(idx, -1)}><ArrowUp className="h-3.5 w-3.5" /></Button>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-600" aria-label={`Mover ${step.title} para baixo`} disabled={idx === activeProcedure.steps.length - 1} onClick={() => moveStep(idx, 1)}><ArrowDown className="h-3.5 w-3.5" /></Button>
                                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Duplicar ${step.title}`} onClick={() => duplicateStep(idx)}><Copy className="h-3.5 w-3.5" /></Button>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600" aria-label={`Remover ${step.title}`} onClick={() => removeStep(idx)}><Trash2 className="h-3.5 w-3.5" /></Button>
                              </div>
                            </div>
                          </div>

                          {/* Error / Handoff Branch if configured */}
                          {step.onFailHandoffTeam && (
                            <div className="mt-2 flex items-center justify-end pr-2">
                              <div className="flex items-center gap-2 text-[11px] text-slate-500">
                                <span className="font-medium text-slate-400">Se falhar</span>
                                <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-1.5 shadow-2xs">
                                  <Headphones className="h-3.5 w-3.5 text-amber-600" />
                                  <span className="text-xs font-semibold text-slate-900">
                                    Chamar {resources.teams.find((team) => team.id === step.onFailHandoffTeam || team.name === step.onFailHandoffTeam)?.name || 'equipe selecionada'}
                                  </span>
                                  <Badge
                                    variant="outline"
                                    className="bg-amber-100 text-amber-800 border-amber-300 text-[9px]"
                                  >
                                    Ação
                                  </Badge>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Arrow Down between steps */}
                        {idx < (activeProcedure?.steps.length || 0) - 1 && (
                          <div className="flex justify-center py-0.5">
                            <ArrowDown className="h-4 w-4 text-slate-300" />
                          </div>
                        )}
                      </React.Fragment>
                    );
                  })}

                  {/* Add Step Button */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="outline" className="w-full border-dashed text-emerald-700"><Plus className="mr-2 h-4 w-4" />Adicionar etapa</Button></DropdownMenuTrigger>
                    <DropdownMenuContent className="max-h-80 overflow-y-auto">{PROCEDURE_STEP_TYPES.map((type) => <DropdownMenuItem key={type} onSelect={() => handleAddStepToCurrentContext(type)}>{getStepIcon({ type } as ProcedureStep)}<span className="ml-2">{PROCEDURE_STEP_TYPE_LABELS[type].label}</span></DropdownMenuItem>)}</DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            )
          ) : activeTab === 'appearance' ? (
            /* ========================================================= */
            /* TAB: APARÊNCIA                                            */
            /* ========================================================= */
            <div className="mx-auto max-w-2xl space-y-6">
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-sm font-bold text-slate-900">Identidade Visual do Agente</h3>
                <p className="text-xs text-slate-500">Configure o nome, título e personalidade exibidos ao cliente.</p>

                <div className="mt-5 space-y-4">
                  <div>
                    <Label className="text-xs font-semibold text-slate-700">Nome do Agente</Label>
                    <Input
                      value={doc.name}
                      onChange={(e) => setDoc((p) => ({ ...p, name: e.target.value }))}
                      className="mt-1 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-semibold text-slate-700">Título / Cargo</Label>
                    <Input
                      value={doc.appearance.botTitle}
                      onChange={(e) =>
                        setDoc((p) => ({
                          ...p,
                          appearance: { ...p.appearance, botTitle: e.target.value },
                        }))
                      }
                      placeholder="Ex: Atendente Virtual"
                      className="mt-1 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-semibold text-slate-700">Imagem do agente na prévia e canais compatíveis</Label>
                    <Input value={doc.avatarUrl || ''} onChange={(event) => setDoc((current) => ({ ...current, avatarUrl: event.target.value }))} placeholder="https://.../avatar.png" className="mt-1 text-xs" />
                    <label className="mt-2 flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={doc.appearance.showAvatar} onChange={(event) => setDoc((current) => ({ ...current, appearance: { ...current.appearance, showAvatar: event.target.checked } }))} />Mostrar avatar quando o canal oferecer identidade visual</label>
                  </div>
                  <div>
                    <Label className="text-xs font-semibold text-slate-700">Tema de Cor</Label>
                    <div className="mt-2 flex gap-3">
                      {(['emerald', 'blue', 'purple', 'rose'] as const).map((color) => (
                        <button
                          key={color}
                          type="button"
                          aria-label={`Tema ${color}`}
                          aria-pressed={doc.appearance.colorTheme === color}
                          onClick={() =>
                            setDoc((p) => ({
                              ...p,
                              appearance: { ...p.appearance, colorTheme: color },
                            }))
                          }
                          className={cn(
                            'h-8 w-8 rounded-full border-2 transition',
                            color === 'emerald' && 'bg-emerald-500',
                            color === 'blue' && 'bg-sky-500',
                            color === 'purple' && 'bg-purple-500',
                            color === 'rose' && 'bg-rose-500',
                            doc.appearance.colorTheme === color ? 'border-slate-950 scale-110' : 'border-transparent'
                          )}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900"><strong>Compatibilidade por canal</strong><p className="mt-1">Nome, avatar e cor aparecem na prévia do Estúdio e podem ser usados por interfaces compatíveis, como o webchat. WhatsApp, Instagram e Messenger controlam a identidade visual no próprio canal; neles o agente publica somente o conteúdo da conversa.</p></div>
                </div>
              </div>
            </div>
          ) : activeTab === 'rules' ? (
            /* ========================================================= */
            /* TAB: REGRAS                                               */
            /* ========================================================= */
            <div className="mx-auto max-w-2xl space-y-6">
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-sm font-bold text-slate-900">Horário e Políticas de Atendimento</h3>
                <p className="text-xs text-slate-500">Defina o tom de voz e regras de operação fora do expediente.</p>

          <StudioPolicySettings document={doc} onChange={setDoc} models={models} />

                <div className="mt-5 space-y-4">
                  <label className="block text-xs font-semibold text-slate-700">Objetivo do agente<Textarea value={doc.objective || ''} onChange={(event) => setDoc((previous) => ({ ...previous, objective: event.target.value }))} className="mt-1 text-xs" placeholder="O que este agente deve resolver e quais são seus limites?" /></label>
                  <label className="block text-xs font-semibold text-slate-700">Idioma<select className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-xs" value={doc.language} onChange={(event) => setDoc((previous) => ({ ...previous, language: event.target.value }))}><option value="pt-BR">Português (Brasil)</option><option value="en">Inglês</option><option value="es">Espanhol</option></select></label>
                  <div>
                    <Label className="text-xs font-semibold text-slate-700">Tom de Voz</Label>
                    <Input
                      value={doc.rules.toneOfVoice}
                      onChange={(e) =>
                        setDoc((p) => ({
                          ...p,
                          rules: { ...p.rules, toneOfVoice: e.target.value },
                        }))
                      }
                      className="mt-1 text-xs"
                    />
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                    <div>
                      <Label className="text-xs font-semibold text-slate-900">Horário de Atendimento Ativo</Label>
                      <p className="text-[11px] text-slate-500">Enviar mensagem de ausência fora do horário.</p>
                    </div>
                    <Switch
                      checked={doc.rules.operatingHoursEnabled}
                      onCheckedChange={(c) =>
                        setDoc((p) => ({
                          ...p,
                          rules: { ...p.rules, operatingHoursEnabled: c },
                        }))
                      }
                    />
                  </div>
                  {doc.rules.operatingHoursEnabled && (
                    <div className="grid grid-cols-2 gap-3 pt-2">
                      <div>
                        <Label className="text-xs text-slate-600">Início</Label>
                        <Input
                          type="time"
                          value={doc.rules.operatingHoursStart}
                          onChange={(e) =>
                            setDoc((p) => ({
                              ...p,
                              rules: { ...p.rules, operatingHoursStart: e.target.value },
                            }))
                          }
                          className="mt-1 text-xs"
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-slate-600">Fim</Label>
                        <Input
                          type="time"
                          value={doc.rules.operatingHoursEnd}
                          onChange={(e) =>
                            setDoc((p) => ({
                              ...p,
                              rules: { ...p.rules, operatingHoursEnd: e.target.value },
                            }))
                          }
                          className="mt-1 text-xs"
                        />
                      </div>
                    </div>
                  )}
                  {doc.rules.operatingHoursEnabled && <div className="space-y-3">
                    <label className="block text-xs font-semibold text-slate-700">Fuso horário<Input className="mt-1 text-xs" value={doc.rules.timeZone || 'America/Sao_Paulo'} onChange={(event) => setDoc((previous) => ({ ...previous, rules: { ...previous.rules, timeZone: event.target.value } }))} /></label>
                    <fieldset className="text-xs"><legend className="mb-2 font-semibold text-slate-700">Dias de atendimento</legend><div className="flex flex-wrap gap-3">{['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((day, index) => <label key={day} className="flex items-center gap-1"><input type="checkbox" checked={(doc.rules.operatingDays || [1, 2, 3, 4, 5]).includes(index)} onChange={(event) => setDoc((previous) => ({ ...previous, rules: { ...previous.rules, operatingDays: event.target.checked ? [...(previous.rules.operatingDays || [1, 2, 3, 4, 5]), index] : (previous.rules.operatingDays || [1, 2, 3, 4, 5]).filter((value) => value !== index) } }))} />{day}</label>)}</div></fieldset>
                    <label className="block text-xs font-semibold text-slate-700">Mensagem fora do horário<Textarea className="mt-1 text-xs" value={doc.rules.outOfHoursMessage} onChange={(event) => setDoc((previous) => ({ ...previous, rules: { ...previous.rules, outOfHoursMessage: event.target.value } }))} /></label>
                  </div>}
                </div>
              </div>
            </div>
          ) : (
            /* ========================================================= */
            /* TAB: RESULTADOS                                           */
            /* ========================================================= */
            <div className="mx-auto max-w-3xl space-y-6">
              <h2 className="text-lg font-bold">Resultados do Estúdio</h2>
              <label className="block text-xs font-medium text-slate-600">Período<select className="ml-3 rounded-lg border border-slate-200 bg-white p-2" value={resultsPeriodDays} onChange={(event) => setResultsPeriodDays(Number(event.target.value))}>{[7, 30, 90].map((days) => <option key={days} value={days}>Últimos {days} dias</option>)}</select></label>
              {!results ? <p className="text-sm text-slate-500">Carregando…</p> : !results.success ? <p role="alert" className="text-sm text-amber-700">{results.error}</p> : <>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5"><div><h3 className="font-semibold">Runtime em uso</h3><p className="mt-1 text-xs text-slate-500">{results.currentRuntime === 'studio' ? 'Novos atendimentos usam o Estúdio de Agentes de IA.' : 'Novos atendimentos usam o modo anterior. O rascunho do Estúdio permanece disponível.'}</p></div>{results.canRollbackToLegacy && <Button variant="outline" size="sm" className="border-amber-300 text-amber-800" onClick={() => setRollbackOpen(true)}>Voltar ao modo anterior</Button>}</div>
                <StudioResultsMetrics agentId={config.id} results={results} onReviewed={() => setResultsRevision((value) => value + 1)} />
                <div className="rounded-2xl border border-slate-200 bg-white p-5"><h3 className="font-semibold">Versões publicadas</h3><p className="mt-1 text-xs text-slate-500">Cada versão guarda seus procedimentos e conhecimento. Alterar o rascunho não modifica versões anteriores.</p>
                  {results.releases.length ? <ul className="mt-4 space-y-3">{results.releases.map((release) => <li key={release.id} className="space-y-2 border-t border-slate-100 pt-3 text-xs"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">Versão {release.version} {release.revoked && <Badge variant="destructive" className="ml-1">Revogada</Badge>}</span><time>{new Date(release.createdAt).toLocaleString('pt-BR')}</time>{!release.revoked && <><Button variant="ghost" size="sm" onClick={() => setCompareVersion(release)}>Comparar com rascunho</Button><Button variant="outline" size="sm" onClick={() => setRestoreVersion(release)}>Recuperar como rascunho</Button><Button variant="ghost" size="sm" className="text-red-700" onClick={() => setRevocationTarget({ releaseId: release.id, version: release.version, label: `Versão ${release.version}` })}>Revogar versão</Button></>}</div>{release.knowledgeSources.length > 0 && <div className="rounded-lg bg-slate-50 p-2"><p className="mb-1 font-medium text-slate-600">Conhecimento fixado</p>{release.knowledgeSources.map((source: { id: string; name: string; revoked: boolean }) => <div key={source.id} className="flex items-center justify-between gap-2 py-1"><span>{source.name} {source.revoked && <span className="text-red-700">· revogada</span>}</span>{!release.revoked && !source.revoked && <Button variant="ghost" size="sm" className="h-6 text-[11px] text-red-700" onClick={() => setRevocationTarget({ releaseId: release.id, version: release.version, sourceId: source.id, label: source.name })}>Revogar fonte</Button>}</div>)}</div>}</li>)}</ul> : <p className="mt-3 text-xs text-slate-400">Nenhuma versão publicada.</p>}
                </div>
              </>}
            </div>
          )}
        </main>

        <div className="hidden min-h-0 lg:flex"><StudioConversationPreview document={doc} resetKey={previewResetKey} teams={resources.teams} /></div>
      </div>

      {previewOpen && <Dialog open onOpenChange={setPreviewOpen}><DialogContent className="dark h-[85dvh] max-w-sm overflow-hidden border-slate-800 bg-slate-950 p-0 lg:hidden"><DialogHeader className="sr-only"><DialogTitle>Testar agente</DialogTitle><DialogDescription>Teste ponta a ponta com IA, integrações e atendimento reais, ou simulação de ações</DialogDescription></DialogHeader><StudioConversationPreview document={doc} resetKey={previewResetKey} teams={resources.teams} /></DialogContent></Dialog>}
      {compareVersion && <StudioVersionComparison agentId={config.id} release={compareVersion} current={doc} onClose={() => setCompareVersion(null)} />}
      {restoreVersion && <Dialog open onOpenChange={(open) => { if (!open && !restoringVersion) setRestoreVersion(null); }}><DialogContent><DialogHeader><DialogTitle>Recuperar versão {restoreVersion.version}?</DialogTitle><DialogDescription>O conteúdo desta versão substituirá o rascunho atual. As publicações anteriores e os atendimentos em andamento permanecem intactos.</DialogDescription></DialogHeader><DialogFooter><Button variant="ghost" disabled={restoringVersion} onClick={() => setRestoreVersion(null)}>Cancelar</Button><Button disabled={restoringVersion || isSaving || isPublishing} onClick={handleRestoreVersion}>{restoringVersion ? 'Recuperando…' : 'Substituir rascunho'}</Button></DialogFooter></DialogContent></Dialog>}
      {rollbackOpen && <Dialog open onOpenChange={(open) => { if (!open && !rollingBack) { setRollbackOpen(false); setRollbackConfirmation(''); } }}><DialogContent><DialogHeader><DialogTitle>Voltar novos atendimentos ao modo anterior?</DialogTitle><DialogDescription>Esta operação cria uma nova versão auditável com a configuração anterior. Atendimentos do Estúdio já iniciados continuam na versão fixada; nenhuma versão ou rascunho será excluído.</DialogDescription></DialogHeader><label className="text-sm font-medium">Digite VOLTAR AO MODO ANTERIOR<Input className="mt-2" value={rollbackConfirmation} onChange={(event) => setRollbackConfirmation(event.target.value)} autoComplete="off" /></label><DialogFooter><Button variant="ghost" disabled={rollingBack} onClick={() => { setRollbackOpen(false); setRollbackConfirmation(''); }}>Cancelar</Button><Button variant="destructive" disabled={rollingBack || rollbackConfirmation !== 'VOLTAR AO MODO ANTERIOR'} onClick={handleLegacyRollback}>{rollingBack ? 'Voltando…' : 'Confirmar reversão'}</Button></DialogFooter></DialogContent></Dialog>}
      {revocationTarget && <Dialog open onOpenChange={(open) => { if (!open && !revoking) { setRevocationTarget(null); setRevocationReason(''); setRevocationConfirmation(''); } }}><DialogContent><DialogHeader><DialogTitle>Revogar {revocationTarget.label}?</DialogTitle><DialogDescription>{revocationTarget.sourceId ? 'Esta fonte deixará de ser consultada por esta versão. Outros procedimentos continuam disponíveis.' : 'Esta versão deixará de executar imediatamente, inclusive quando fixada em um fluxo normal. O histórico não será apagado; publique uma nova versão para corrigir.'}</DialogDescription></DialogHeader><label className="text-sm font-medium">Motivo da revogação<Textarea className="mt-2" value={revocationReason} onChange={(event) => setRevocationReason(event.target.value)} maxLength={1000} /></label><label className="text-sm font-medium">Digite {revocationTarget.sourceId ? 'REVOGAR FONTE' : 'REVOGAR VERSÃO'}<Input className="mt-2" value={revocationConfirmation} onChange={(event) => setRevocationConfirmation(event.target.value)} autoComplete="off" /></label><DialogFooter><Button variant="ghost" disabled={revoking} onClick={() => { setRevocationTarget(null); setRevocationReason(''); setRevocationConfirmation(''); }}>Cancelar</Button><Button variant="destructive" disabled={revoking || revocationReason.trim().length < 10 || revocationConfirmation !== (revocationTarget.sourceId ? 'REVOGAR FONTE' : 'REVOGAR VERSÃO')} onClick={handleRevocation}>{revoking ? 'Revogando…' : 'Confirmar revogação'}</Button></DialogFooter></DialogContent></Dialog>}
      {editingProcedure && activeProcedure && <StudioProcedureSettings key={activeProcedure.id} procedure={activeProcedure} onApply={updateProcedure} onClose={() => setEditingProcedure(false)} />}
      {stageSettings && <StudioStageSettings key={stageSettings} stage={stageSettings} document={doc} onChange={(edited) => setDoc((current) => ({ ...edited, draftRevision: current.draftRevision, publishedVersion: current.publishedVersion }))} onClose={() => setStageSettings(null)} resources={resources} />}
      <Dialog open={isAddApiConnectionOpen} onOpenChange={setIsAddApiConnectionOpen}>
        <DialogContent className="dark max-w-md border-slate-800 bg-[#0f172a] text-slate-100">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-white">Nova conexão de API</DialogTitle>
            <DialogDescription className="text-xs text-slate-400">
              A credencial fica criptografada no workspace e não aparece no procedimento.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-3">
            <div>
              <Label className="text-xs text-slate-300">Nome</Label>
              <Input value={newApiConnection.name} onChange={(event) => setNewApiConnection((previous) => ({ ...previous, name: event.target.value }))} placeholder="ERP Financeiro" className="mt-1 bg-slate-950 border-slate-800 text-xs text-white" />
            </div>
            <div>
              <Label className="text-xs text-slate-300">URL base</Label>
              <Input value={newApiConnection.baseUrl} onChange={(event) => setNewApiConnection((previous) => ({ ...previous, baseUrl: event.target.value }))} placeholder="https://api.suaempresa.com" className="mt-1 bg-slate-950 border-slate-800 text-xs text-white" />
            </div>
            <div>
              <Label className="text-xs text-slate-300">Autenticação</Label>
              <select value={newApiConnection.authType} onChange={(event) => setNewApiConnection((previous) => ({ ...previous, authType: event.target.value as AgentApiConnectionSummary['authType'] }))} className="mt-1 h-9 w-full rounded-md border border-slate-800 bg-slate-950 px-3 text-xs text-white">
                <option value="none">Sem autenticação</option>
                <option value="api_key">API Key</option>
                <option value="bearer_token">Bearer Token</option>
                <option value="basic_auth">Usuário e senha</option>
              </select>
            </div>
            {newApiConnection.authType === 'api_key' && (
              <div>
                <Label className="text-xs text-slate-300">Nome do header</Label>
                <Input value={newApiConnection.apiKeyHeader} onChange={(event) => setNewApiConnection((previous) => ({ ...previous, apiKeyHeader: event.target.value }))} className="mt-1 bg-slate-950 border-slate-800 text-xs text-white" />
              </div>
            )}
            {newApiConnection.authType === 'basic_auth' && (
              <div>
                <Label className="text-xs text-slate-300">Usuário</Label>
                <Input value={newApiConnection.username} onChange={(event) => setNewApiConnection((previous) => ({ ...previous, username: event.target.value }))} className="mt-1 bg-slate-950 border-slate-800 text-xs text-white" />
              </div>
            )}
            {newApiConnection.authType !== 'none' && (
              <div>
                <Label className="text-xs text-slate-300">{newApiConnection.authType === 'basic_auth' ? 'Senha' : 'Segredo'}</Label>
                <Input type="password" value={newApiConnection.secret} onChange={(event) => setNewApiConnection((previous) => ({ ...previous, secret: event.target.value }))} autoComplete="new-password" className="mt-1 bg-slate-950 border-slate-800 text-xs text-white" />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setIsAddApiConnectionOpen(false)} className="text-xs">Cancelar</Button>
            <Button size="sm" onClick={handleAddApiConnection} disabled={savingConnection || !newApiConnection.name.trim() || !newApiConnection.baseUrl.trim() || (newApiConnection.authType !== 'none' && !newApiConnection.secret)} className="bg-orange-600 text-xs font-semibold text-white hover:bg-orange-500">
              {savingConnection ? 'Salvando…' : 'Salvar conexão segura'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isAddMcpServerOpen} onOpenChange={setIsAddMcpServerOpen}>
        <DialogContent className="dark max-w-md border-slate-800 bg-[#0f172a] text-slate-100">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-white">Conectar servidor MCP</DialogTitle>
            <DialogDescription className="text-xs text-slate-400">
              O Dialogy testa a conexão e importa as ferramentas anunciadas pelo servidor.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-3">
            <div>
              <Label className="text-xs text-slate-300">Nome da conexão</Label>
              <Input value={newMcpServer.name} onChange={(event) => setNewMcpServer((previous) => ({ ...previous, name: event.target.value }))} placeholder="Financeiro MCP" className="mt-1 bg-slate-950 border-slate-800 text-xs text-white" />
            </div>
            <div>
              <Label className="text-xs text-slate-300">Transporte</Label>
              <select value={newMcpServer.transport} onChange={(event) => setNewMcpServer((previous) => ({ ...previous, transport: event.target.value as 'streamable_http' | 'sse' }))} className="mt-1 h-9 w-full rounded-md border border-slate-800 bg-slate-950 px-3 text-xs text-white">
                <option value="streamable_http">Streamable HTTP</option>
                <option value="sse">SSE</option>
              </select>
            </div>
            <div>
              <Label className="text-xs text-slate-300">Endpoint</Label>
              <Input value={newMcpServer.endpoint} onChange={(event) => setNewMcpServer((previous) => ({ ...previous, endpoint: event.target.value }))} placeholder="https://mcp.suaempresa.com/mcp" className="mt-1 bg-slate-950 border-slate-800 text-xs text-white" />
            </div>
            <label className="block text-xs text-slate-300">Token de acesso · opcional<Input type="password" autoComplete="new-password" value={newMcpServer.token || ''} onChange={(event) => setNewMcpServer((previous) => ({ ...previous, token: event.target.value }))} className="mt-1 bg-slate-950" /><span className="mt-1 block text-[11px] text-slate-400">Enviado como Bearer Token e armazenado criptografado.</span></label>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setIsAddMcpServerOpen(false)} className="text-xs">Cancelar</Button>
            <Button size="sm" onClick={handleAddMcpServer} disabled={connectingMcp || !newMcpServer.name.trim() || !newMcpServer.endpoint.trim()} className="bg-violet-600 text-xs font-semibold text-white hover:bg-violet-500">
              {connectingMcp ? 'Conectando…' : 'Conectar e importar ferramentas'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 4. PUBLISH CHECKLIST DIALOG */}
      <Dialog open={isPublishDialogOpen} onOpenChange={setIsPublishDialogOpen}>
        <DialogContent className="dark max-w-md border-slate-800 bg-[#0f172a] text-slate-100">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-white">Publicar Agente de IA</DialogTitle>
            <DialogDescription className="text-xs text-slate-400">
              Validamos a integridade de todas as etapas e procedimentos antes de ativar.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-3">
            {publicationValidation?.issues.map((issue, idx) => (
              <div
                key={idx}
                className={cn(
                  'flex items-start gap-2.5 rounded-xl border p-3 text-xs',
                  issue.severity === 'error'
                    ? 'border-red-500/30 bg-red-500/10 text-red-300'
                    : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                )}
              >
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">{issue.title}</p>
                  <p className="text-[11px] opacity-80 leading-relaxed">{issue.description}</p>
                </div>
              </div>
            ))}

            {publicationValidation?.valid && (
              <div className="flex items-center gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>Verificações locais concluídas. Conexões e permissões serão verificadas no servidor antes de ativar a versão.</span>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsPublishDialogOpen(false)}
              className="text-xs"
            >
              Voltar e editar
            </Button>
            <Button
              size="sm"
              onClick={handleConfirmPublish}
              disabled={!publicationValidation?.valid}
              className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold disabled:opacity-50"
            >
              Confirmar e Ativar Versão
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
