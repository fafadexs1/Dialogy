'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AlertTriangle, ArrowLeft, GitBranch, Loader2, RefreshCw, Sparkles } from 'lucide-react';

import {
  createAutopilotNativeWorkflowDraft,
  generateAutopilotNativeWorkflowWithAi,
  getAgentToolCatalogAction,
  getAutopilotConfig,
  publishAutopilotDraft,
  resumeAutopilotNativeWorkflowTest,
  runAutopilotNativeWorkflowTest,
  saveAutopilotDraft,
} from '@/actions/autopilot';
import { NativeAiBuilderDialog } from '@/components/workflow/native-ai-builder-dialog';
import { NativeWorkflowBuilder } from '@/components/workflow/native-workflow-builder';
import { LegacyNexusImportDialog } from './legacy-nexus-import-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useCurrentUser } from '@/hooks/use-online-status';
import {
  DEFAULT_AUTOPILOT_MODEL,
  getAiModelRuntimeProvider,
  type AiModelCatalogEntry,
} from '@/lib/ai-models';
import type {
  AutopilotConfig,
  AutopilotConfigDraftSnapshot,
  KnowledgeCollection,
} from '@/lib/types';
import type { AgentToolCatalogItem } from '@/services/agent-tools/catalog';
import { workflowFunctionalSignature } from '@/services/workflow-runtime/signature';
import type { NativeWorkflowTemplate } from '@/services/workflow-runtime/native-templates';
import type { ModelConfiguration, WorkflowDefinition } from '@/services/workflow-runtime/types';
import { listAttachedWorkflowToolNames } from '@/services/workflow-runtime/native-agent-tools';
import { getPrimaryWorkflowModelId } from '@/services/workflow-runtime/model-selection';

const DEFAULT_KNOWLEDGE_COLLECTION: KnowledgeCollection = {
  id: 'general',
  name: 'Geral',
  description: 'Conteúdo compartilhado entre os agentes do fluxo.',
  isDefault: true,
};

const MANAGEMENT_TAB: Record<
  'procedures' | 'knowledge' | 'capabilities' | 'analytics' | 'executions' | 'decision' | 'settings' | 'playground' | 'versions',
  string
> = {
  procedures: 'domain',
  knowledge: 'knowledge',
  capabilities: 'overview',
  analytics: 'analytics',
  executions: 'analytics',
  decision: 'analytics',
  settings: 'settings',
  playground: 'playground',
  versions: 'versions',
};

function normalizeCollections(collections?: KnowledgeCollection[] | null) {
  const parsed = Array.isArray(collections) ? collections : [];
  return parsed.some((collection) => collection.id === DEFAULT_KNOWLEDGE_COLLECTION.id)
    ? parsed
    : [DEFAULT_KNOWLEDGE_COLLECTION, ...parsed];
}

function snapshotFromConfig(config: AutopilotConfig): AutopilotConfigDraftSnapshot {
  return {
    name: config.name || '',
    gemini_api_key: null,
    ai_model: config.ai_model || null,
    transcription_model: config.transcription_model || null,
    knowledge_base: config.knowledge_base || null,
    knowledge_base_documents: config.knowledge_base_documents || [],
    knowledge_collections: normalizeCollections(config.knowledge_collections),
    is_active: Boolean(config.is_active),
    is_private: Boolean(config.is_private),
    default_fallback_reply: config.default_fallback_reply || null,
    escalation_policy: config.escalation_policy || null,
    closing_policy: config.closing_policy || null,
    inactivity_timeout_seconds: config.inactivity_timeout_seconds || null,
    enabled_tool_names: config.enabled_tool_names || [],
    flow_graph: config.flow_graph || null,
    workflow_runtime_v2_mode: config.workflow_runtime_v2_mode || 'off',
    workflow_builder_mode: config.workflow_builder_mode || 'legacy',
    workflow_definition: config.workflow_definition || null,
    workflow_migration: null,
  };
}

function mergeDraftSnapshot(
  config: AutopilotConfig,
  draft?: AutopilotConfigDraftSnapshot | null,
): AutopilotConfigDraftSnapshot {
  const fallback = snapshotFromConfig(config);
  if (!draft) return fallback;
  return {
    ...fallback,
    ...draft,
    gemini_api_key: null,
    knowledge_base_documents: Array.isArray(draft.knowledge_base_documents)
      ? draft.knowledge_base_documents
      : fallback.knowledge_base_documents,
    knowledge_collections: normalizeCollections(draft.knowledge_collections || fallback.knowledge_collections),
    enabled_tool_names: Array.isArray(draft.enabled_tool_names)
      ? draft.enabled_tool_names
      : fallback.enabled_tool_names,
    workflow_definition: draft.workflow_definition || fallback.workflow_definition || null,
  };
}

function snapshotSignature(snapshot: AutopilotConfigDraftSnapshot | null) {
  if (!snapshot) return '';
  return JSON.stringify({
    ...snapshot,
    gemini_api_key: null,
    enabled_tool_names: [...(snapshot.enabled_tool_names || [])].sort(),
    knowledge_collections: normalizeCollections(snapshot.knowledge_collections),
  });
}

function functionalSnapshotSignature(snapshot: AutopilotConfigDraftSnapshot | null) {
  if (!snapshot) return '';
  return JSON.stringify({
    name: snapshot.name,
    ai_model: snapshot.ai_model,
    transcription_model: snapshot.transcription_model,
    knowledge_base: snapshot.knowledge_base,
    knowledge_base_documents: snapshot.knowledge_base_documents,
    knowledge_collections: normalizeCollections(snapshot.knowledge_collections),
    is_active: snapshot.is_active,
    is_private: snapshot.is_private,
    default_fallback_reply: snapshot.default_fallback_reply,
    escalation_policy: snapshot.escalation_policy,
    closing_policy: snapshot.closing_policy,
    inactivity_timeout_seconds: snapshot.inactivity_timeout_seconds,
    enabled_tool_names: [...(snapshot.enabled_tool_names || [])].sort(),
    workflow_definition: snapshot.workflow_definition
      ? workflowFunctionalSignature(snapshot.workflow_definition)
      : null,
    flow_graph: snapshot.flow_graph,
  });
}

function modelConfiguration(model: string): ModelConfiguration {
  return {
    provider: getAiModelRuntimeProvider(model),
    model,
    temperature: 0.2,
    maxOutputTokens: 2048,
    supportsTools: true,
    supportsStructuredOutput: true,
    supportsStreaming: true,
    timeoutMs: 60_000,
    maxRetries: 2,
  };
}

function appendSnapshotToFormData(input: {
  workspaceId: string;
  configId: string;
  snapshot: AutopilotConfigDraftSnapshot;
}) {
  const { workspaceId, configId, snapshot } = input;
  const formData = new FormData();
  formData.append('workspaceId', workspaceId);
  formData.append('configId', configId);
  formData.append('agentName', snapshot.name);
  formData.append('aiModel', snapshot.ai_model || '');
  formData.append('isActive', snapshot.is_active ? 'on' : 'off');
  formData.append('isPrivate', snapshot.is_private ? 'on' : 'off');
  formData.append('knowledgeBase', snapshot.knowledge_base || '');
  formData.append('defaultFallbackReply', snapshot.default_fallback_reply || '');
  formData.append('escalationPolicy', snapshot.escalation_policy || '');
  formData.append('closingPolicy', snapshot.closing_policy || '');
  formData.append('inactivityTimeoutSeconds', snapshot.inactivity_timeout_seconds ? String(snapshot.inactivity_timeout_seconds) : '');
  formData.append('enabledToolNames', JSON.stringify(snapshot.enabled_tool_names || []));
  formData.append('knowledgeBaseDocuments', JSON.stringify(snapshot.knowledge_base_documents || []));
  formData.append('knowledgeCollections', JSON.stringify(normalizeCollections(snapshot.knowledge_collections)));
  formData.append('flowGraph', JSON.stringify(snapshot.flow_graph || null));
  formData.append('workflowRuntimeV2Mode', snapshot.workflow_runtime_v2_mode || 'shadow');
  formData.append('workflowBuilderMode', 'native_v2');
  formData.append('workflowDefinition', JSON.stringify(snapshot.workflow_definition || null));
  return formData;
}

export function NexusFlowEditor() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const user = useCurrentUser();
  const flowId = params.id;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [config, setConfig] = useState<AutopilotConfig | null>(null);
  const [snapshot, setSnapshot] = useState<AutopilotConfigDraftSnapshot | null>(null);
  const [loadedSnapshot, setLoadedSnapshot] = useState<AutopilotConfigDraftSnapshot | null>(null);
  const [modelOptions, setModelOptions] = useState<AiModelCatalogEntry[]>([]);
  const [tools, setTools] = useState<AgentToolCatalogItem[]>([]);
  const [toolsLoading, setToolsLoading] = useState(true);
  const [hasDraft, setHasDraft] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateBusy, setTemplateBusy] = useState(false);
  const loadedKeyRef = useRef<string>('');

  const load = useCallback(async () => {
    if (!user?.activeWorkspaceId || !flowId) return;
    setLoading((prev) => (config ? false : prev));
    setToolsLoading((prev) => (tools.length > 0 ? false : prev));
    setLoadError(null);
    try {
      const data = await getAutopilotConfig(user.activeWorkspaceId, flowId);
      if (data.error) throw new Error(data.error);
      if (!data.config || data.config.id !== flowId) {
        setConfig(null);
        setLoadError('Este fluxo não existe ou não está disponível neste workspace.');
        return;
      }
      const nextSnapshot = mergeDraftSnapshot(data.config, data.draft?.snapshot);
      setConfig(data.config);
      setSnapshot(nextSnapshot);
      setLoadedSnapshot(nextSnapshot);
      setHasDraft(Boolean(data.draft));
      setModelOptions(data.workspaceConfiguredAiModels || []);
      if (!nextSnapshot.workflow_definition) setTemplateOpen(true);
      setLoading(false);

      const catalog = await getAgentToolCatalogAction(user.activeWorkspaceId);
      if (catalog.error) {
        toast({ title: 'Catálogo de ferramentas indisponível', description: catalog.error, variant: 'destructive' });
      } else {
        setTools(catalog.tools || []);
      }
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'Não foi possível abrir o fluxo.');
    } finally {
      setLoading(false);
      setToolsLoading(false);
    }
  }, [config, flowId, toast, tools.length, user?.activeWorkspaceId]);

  useEffect(() => {
    if (user?.activeWorkspaceId && flowId) {
      const key = `${user.activeWorkspaceId}:${flowId}`;
      if (loadedKeyRef.current === key) return;
      loadedKeyRef.current = key;
      void load();
    }
  }, [flowId, load, user?.activeWorkspaceId]);

  const definition = snapshot?.workflow_definition || null;
  const selectedModel = getPrimaryWorkflowModelId(definition) || snapshot?.ai_model || DEFAULT_AUTOPILOT_MODEL;
  const defaultModel = useMemo(() => modelConfiguration(selectedModel), [selectedModel]);
  const isDirty = snapshotSignature(snapshot) !== snapshotSignature(loadedSnapshot);
  const isFunctionallyDirty = functionalSnapshotSignature(snapshot) !== functionalSnapshotSignature(loadedSnapshot);
  const canPublishDraft = hasDraft || isFunctionallyDirty;

  const applyDefinition = useCallback((nextDefinition: WorkflowDefinition) => {
    setSnapshot((current) => current ? {
      ...current,
      ai_model: getPrimaryWorkflowModelId(nextDefinition) || current.ai_model,
      enabled_tool_names: listAttachedWorkflowToolNames(nextDefinition),
      workflow_builder_mode: 'native_v2',
      workflow_runtime_v2_mode: current.workflow_runtime_v2_mode === 'primary' ? 'primary' : 'shadow',
      workflow_definition: nextDefinition,
    } : current);
  }, []);

  const save = useCallback(async () => {
    if (!config || !snapshot || !user?.activeWorkspaceId) return false;
    setSaving(true);
    try {
      const result = await saveAutopilotDraft(
        { success: false },
        appendSnapshotToFormData({ workspaceId: user.activeWorkspaceId, configId: config.id, snapshot }),
      );
      if (!result.success) {
        toast({ title: 'Erro ao salvar o rascunho', description: result.error, variant: 'destructive' });
        return false;
      }
      setLoadedSnapshot(snapshot);
      setHasDraft(true);
      toast({ title: 'Rascunho salvo', description: 'O canvas nativo foi salvo na Dialogy.' });
      return true;
    } finally {
      setSaving(false);
    }
  }, [config, snapshot, toast, user?.activeWorkspaceId]);

  const publish = useCallback(async () => {
    if (!config || !snapshot || !user?.activeWorkspaceId) return;
    setPublishing(true);
    try {
      if (isDirty) {
        const saved = await saveAutopilotDraft(
          { success: false },
          appendSnapshotToFormData({ workspaceId: user.activeWorkspaceId, configId: config.id, snapshot }),
        );
        if (!saved.success) {
          toast({ title: 'Erro ao salvar antes de publicar', description: saved.error, variant: 'destructive' });
          return;
        }
      }
      const result = await publishAutopilotDraft(config.id);
      if (!result.success) {
        toast({ title: 'Erro ao publicar', description: result.error, variant: 'destructive' });
        return;
      }
      toast({ title: 'Automação publicada', description: result.warning || (result.versionNumber ? `Versão v${result.versionNumber} publicada.` : 'Fluxo promovido para produção.') });
      await load();
    } finally {
      setPublishing(false);
    }
  }, [config, isDirty, load, snapshot, toast, user?.activeWorkspaceId]);

  const createTemplate = async (template: NativeWorkflowTemplate) => {
    setTemplateBusy(true);
    try {
      const result = await createAutopilotNativeWorkflowDraft({ configId: flowId, template });
      if (!result.success || !result.workflow) {
        toast({ title: 'Não foi possível criar o template', description: result.error, variant: 'destructive' });
        return;
      }
      const nextSnapshot: AutopilotConfigDraftSnapshot = {
        ...(snapshot || snapshotFromConfig(config!)),
        ai_model: getPrimaryWorkflowModelId(result.workflow) || snapshot?.ai_model || config?.ai_model || DEFAULT_AUTOPILOT_MODEL,
        enabled_tool_names: listAttachedWorkflowToolNames(result.workflow),
        workflow_builder_mode: 'native_v2',
        workflow_runtime_v2_mode: 'shadow',
        workflow_definition: result.workflow,
        workflow_migration: null,
      };
      setSnapshot(nextSnapshot);
      setLoadedSnapshot(nextSnapshot);
      setHasDraft(true);
      setTemplateOpen(false);
    } finally {
      setTemplateBusy(false);
    }
  };

  if (loading && !config) {
    return (
      <div className="flex min-h-[calc(100dvh-4rem)] items-center justify-center bg-[#f8fafc] text-slate-700">
        <Loader2 className="mr-3 h-6 w-6 animate-spin text-slate-700" />
        Carregando o Nexus...
      </div>
    );
  }

  if (loadError || !config || !snapshot) {
    return (
      <div className="flex min-h-[calc(100dvh-4rem)] items-center justify-center bg-[#080d14] p-6">
        <div className="max-w-xl rounded-3xl border border-amber-500/20 bg-[#111923] p-8 text-center text-slate-200">
          <AlertTriangle className="mx-auto h-9 w-9 text-amber-400" />
          <h1 className="mt-4 text-xl font-semibold">Não foi possível abrir o fluxo</h1>
          <p className="mt-2 text-sm text-slate-400">{loadError}</p>
          <div className="mt-6 flex justify-center gap-3"><Button variant="outline" onClick={() => router.push('/nexus')}><ArrowLeft className="mr-2 h-4 w-4" />Voltar</Button><Button onClick={() => void load()}><RefreshCw className="mr-2 h-4 w-4" />Tentar novamente</Button></div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {definition ? (
        <>
          <NativeWorkflowBuilder
            definition={definition}
            defaultModel={defaultModel}
            modelOptions={modelOptions}
            knowledgeDocuments={snapshot.knowledge_base_documents}
            knowledgeCollections={normalizeCollections(snapshot.knowledge_collections)}
            tools={tools}
            toolsLoading={toolsLoading}
            isSaving={saving}
            isPublishing={publishing}
            isDirty={isDirty}
            hasDraft={canPublishDraft}
            onChange={applyDefinition}
            onBack={() => router.push('/nexus')}
            onOpenSettings={() => router.push(`/autopilot/${flowId}?tab=settings`)}
            onOpenModelSettings={() => router.push('/integrations/ai')}
            onOpenPanel={(panel) => router.push(`/autopilot/${flowId}?tab=${MANAGEMENT_TAB[panel]}`)}
            onTest={async (payload) => {
              const result = await runAutopilotNativeWorkflowTest({
                configId: config.id,
                customerMessage: payload.message.trim(),
                workflowDefinition: definition,
                fixtures: payload.fixtures,
              });
              if (!result.success) {
                toast({ title: 'Falha no teste', description: result.error, variant: 'destructive' });
              }
              return result;
            }}
            onResumeTest={async (payload) => {
              const result = await resumeAutopilotNativeWorkflowTest({
                configId: config.id,
                resumeToken: payload.resumeToken,
                customerMessage: payload.message.trim(),
                workflowDefinition: definition,
              });
              if (!result.success) {
                toast({ title: 'Falha ao continuar o teste', description: result.error, variant: 'destructive' });
              }
              return result;
            }}
            onTestNode={async (startNodeId, payload) => {
              const result = await runAutopilotNativeWorkflowTest({
                configId: config.id,
                customerMessage: payload.message.trim() || 'Teste isolado iniciado pelo Nexus.',
                workflowDefinition: definition,
                startNodeId,
                fixtures: payload.fixtures,
              });
              if (!result.success) {
                toast({ title: 'Falha no teste isolado', description: result.error, variant: 'destructive' });
              }
              return result;
            }}
            onSave={() => void save()}
            onPublish={() => void publish()}
          />
          <NativeAiBuilderDialog
            definition={definition}
            disabled={saving || publishing}
            configuredModelLabel={modelOptions.find((model) => model.id === selectedModel)?.label || selectedModel}
            knowledgeDocumentCount={snapshot.knowledge_base_documents.length}
            availableToolCount={tools.length}
            onGenerate={(conversation) => generateAutopilotNativeWorkflowWithAi({
              configId: config.id,
              conversation,
              currentWorkflow: definition,
              enabledToolNames: snapshot.enabled_tool_names,
            })}
            onApply={(proposal) => {
              if (!proposal.validation.valid) {
                toast({ title: 'Proposta bloqueada', description: 'A proposta não passou no validador da Dialogy.', variant: 'destructive' });
                return;
              }
              applyDefinition(proposal.workflow);
              toast({ title: 'Proposta aplicada', description: 'Revise e teste o rascunho antes de publicar.' });
            }}
          />
          <LegacyNexusImportDialog
            disabled={saving || publishing}
            workspaceId={user?.activeWorkspaceId || config.workspace_id}
            configId={config.id}
            name={snapshot.name}
            model={defaultModel}
            mcpTools={tools.filter((tool) => tool.source === 'mcp')}
            onApply={(workflow, report) => {
              applyDefinition(workflow);
              toast({
                title: 'Fluxo antigo convertido',
                description: `${report.importedNodes} blocos foram trazidos para o runtime da Dialogy. Revise e salve o rascunho.`,
              });
            }}
          />
        </>
      ) : (
        <div className="flex min-h-[calc(100dvh-4rem)] items-center justify-center bg-[#080d14] p-6">
          <div className="w-full max-w-3xl rounded-3xl border border-cyan-500/20 bg-[#101821] p-8 text-center shadow-2xl">
            <GitBranch className="mx-auto h-10 w-10 text-cyan-400" />
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-400">Nexus nativo</p>
            <h1 className="mt-3 text-2xl font-semibold text-white">Crie a definição desta automação</h1>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-400">O fluxo será salvo como Workflow V2 e executado pela IA da Dialogy.</p>
            <Button onClick={() => setTemplateOpen(true)} className="mt-6 bg-cyan-500 text-slate-950 hover:bg-cyan-400"><Sparkles className="mr-2 h-4 w-4" />Escolher template</Button>
          </div>
        </div>
      )}

      <Dialog open={templateOpen} onOpenChange={setTemplateOpen}>
        <DialogContent className="max-w-3xl border-white/10 bg-[#111419] text-slate-100">
          <DialogTitle>Começar um fluxo nativo</DialogTitle>
          <DialogDescription className="text-slate-400">Todos os templates usam modelos, memória, ferramentas e políticas da Dialogy.</DialogDescription>
          <div className="grid gap-4 py-3 sm:grid-cols-3">
            {([
              ['single_agent', 'Agente único', 'Modelo, memória, conhecimento e guardrail conectados.'],
              ['routed_team', 'Equipe roteada', 'Roteador de IA distribuindo trabalho entre especialistas.'],
              ['blank', 'Em branco', 'Canvas livre para construir bloco a bloco.'],
            ] as const).map(([template, title, description]) => (
              <button key={template} type="button" onClick={() => void createTemplate(template)} disabled={templateBusy} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-left transition hover:border-cyan-400/40 hover:bg-cyan-500/[0.06] disabled:opacity-50">
                <span className="block font-semibold text-slate-100">{title}</span><span className="mt-2 block text-sm leading-6 text-slate-400">{description}</span>
              </button>
            ))}
          </div>
          {templateBusy && <div className="flex items-center justify-center text-sm text-slate-400"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Criando o workflow na Dialogy…</div>}
          <div className="flex justify-between"><Badge variant="outline" className="border-cyan-500/20 text-cyan-300">Workflow Runtime V2</Badge><Button variant="ghost" onClick={() => router.push('/nexus')}>Cancelar</Button></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
