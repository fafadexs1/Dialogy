'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AlertTriangle, ArrowLeft, Loader2, RefreshCw } from 'lucide-react';

import { NativeWorkflowBuilder } from '@/components/workflow/native-workflow-builder';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useCurrentUser } from '@/hooks/use-online-status';
import { useAuth } from '@/providers/auth-provider';
import {
  DEFAULT_AUTOPILOT_MODEL,
  getAiModelRuntimeProvider,
  type AiModelCatalogEntry,
} from '@/lib/ai-models';
import { workflowFunctionalSignature, workflowLayoutSignature } from '@/services/workflow-runtime/signature';
import type { ModelConfiguration, WorkflowDefinition } from '@/services/workflow-runtime/types';
import type { KnowledgeBaseDocument, KnowledgeCollection } from '@/lib/types';
import type { AgentToolCatalogItem } from '@/services/agent-tools/catalog';
import { getPrimaryWorkflowModelId } from '@/services/workflow-runtime/model-selection';
import { nexusPortableFilename, serializeNexusPortableFlow } from '../services/flow-portability';

import {
  getNexusWorkflow,
  publishNexusWorkflow,
  resumeNexusWorkflowTest,
  runNexusWorkflowTest,
  saveNexusWorkflowDraft,
} from '../actions/workflows';
import { listNexusCredentials } from '../actions/credentials';
import type { NexusCredentialSummary } from '../services/credentials';
import type { NexusDialogyResources } from '../services/dialogy-resources';
import { bindStandaloneNexusWorkflow } from '../services/standalone-workflows';
import { LegacyNexusImportDialog } from './legacy-nexus-import-dialog';
import { NexusCredentialsDialog } from './nexus-credentials-dialog';
import { NexusDeploymentDialog } from './nexus-deployment-dialog';
import { NexusWorkflowExecutionsDialog } from './nexus-workflow-executions-dialog';
import { NexusWorkflowHistoryDialog } from './nexus-workflow-history-dialog';

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

function signature(value: WorkflowDefinition | null) {
  return value ? JSON.stringify(value) : '';
}

export function StandaloneNexusFlowEditor() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const user = useCurrentUser();
  const { user: authUser, isLoading: isAuthLoading } = useAuth();
  const workflowId = params.id;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [definition, setDefinition] = useState<WorkflowDefinition | null>(null);
  const [loadedDefinition, setLoadedDefinition] = useState<WorkflowDefinition | null>(null);
  const [models, setModels] = useState<AiModelCatalogEntry[]>([]);
  const [publishedRevision, setPublishedRevision] = useState(0);
  const [hasUnpublishedChanges, setHasUnpublishedChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [credentials, setCredentials] = useState<NexusCredentialSummary[]>([]);
  const [knowledgeDocuments, setKnowledgeDocuments] = useState<KnowledgeBaseDocument[]>([]);
  const [knowledgeCollections, setKnowledgeCollections] = useState<KnowledgeCollection[]>([]);
  const [tools, setTools] = useState<AgentToolCatalogItem[]>([]);
  const [resources, setResources] = useState<NexusDialogyResources>({
    teams: [], tags: [], members: [], systemAgents: [], intelligentAgents: [], instances: [], workflows: [],
  });
  const [credentialsOpen, setCredentialsOpen] = useState(false);
  const [deploymentOpen, setDeploymentOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [executionsOpen, setExecutionsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [pendingSaveSource, setPendingSaveSource] = useState<'save' | 'import'>('save');
  const loadedKeyRef = useRef<string>('');

  const load = useCallback(async () => {
    if (!user?.activeWorkspaceId || !workflowId) return;
    setLoading((prev) => (definition ? false : prev));
    setLoadError(null);
    try {
      const [result, credentialResult] = await Promise.all([
        getNexusWorkflow(user.activeWorkspaceId, workflowId),
        listNexusCredentials(user.activeWorkspaceId),
      ]);
      if (!result.workflow) throw new Error(result.error || 'Fluxo não encontrado.');
      setDefinition(result.workflow.draftDefinition);
      setLoadedDefinition(result.workflow.draftDefinition);
      setPublishedRevision(result.workflow.publishedRevision);
      setHasUnpublishedChanges(Boolean(result.workflow.hasUnpublishedChanges));
      setModels(result.models);
      setKnowledgeDocuments(result.knowledgeDocuments);
      setKnowledgeCollections(result.knowledgeCollections);
      setTools(result.tools);
      setResources(result.resources);
      setCredentials(credentialResult.credentials);
      if (credentialResult.error) {
        toast({
          title: 'Credenciais indisponíveis',
          description: credentialResult.error,
          variant: 'destructive',
        });
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Não foi possível abrir o fluxo.');
    } finally {
      setLoading(false);
    }
  }, [definition, toast, user?.activeWorkspaceId, workflowId]);

  useEffect(() => {
    if (isAuthLoading) return;
    if (!authUser) {
      setLoading(false);
      setLoadError('Sua sessão expirou. Entre novamente para abrir este fluxo.');
      return;
    }
    if (user?.activeWorkspaceId && workflowId) {
      const key = `${user.activeWorkspaceId}:${workflowId}`;
      if (loadedKeyRef.current === key) return;
      loadedKeyRef.current = key;
      void load();
      return;
    }
    const timeout = window.setTimeout(() => {
      setLoading(false);
      setLoadError('Não foi possível carregar o workspace ativo desta sessão.');
    }, 5_000);
    return () => window.clearTimeout(timeout);
  }, [authUser, isAuthLoading, load, user?.activeWorkspaceId, workflowId]);

  const isDirty = workflowLayoutSignature(definition) !== workflowLayoutSignature(loadedDefinition);
  const isFunctionallyDirty = workflowFunctionalSignature(definition) !== workflowFunctionalSignature(loadedDefinition);
  const hasDraft = hasUnpublishedChanges || isFunctionallyDirty;
  const selectedModel = getPrimaryWorkflowModelId(definition) || models[0]?.id || DEFAULT_AUTOPILOT_MODEL;
  const defaultModel = useMemo(() => modelConfiguration(selectedModel), [selectedModel]);

  const save = useCallback(async (definitionOverride?: WorkflowDefinition) => {
    const definitionToSave = definitionOverride || definition;
    if (!definitionToSave || !user?.activeWorkspaceId) return false;
    setSaving(true);
    try {
      const result = await saveNexusWorkflowDraft({
        workspaceId: user.activeWorkspaceId,
        workflowId,
        definition: definitionToSave,
        source: pendingSaveSource,
      });
      if (!result.success || !result.definition) {
        toast({ title: 'Erro ao salvar', description: result.error, variant: 'destructive' });
        return false;
      }
      setDefinition(result.definition);
      setLoadedDefinition(result.definition);
      setHasUnpublishedChanges(true);
      setPendingSaveSource('save');
      toast({ title: 'Rascunho salvo', description: 'O fluxo independente foi salvo no Nexus.' });
      return true;
    } finally {
      setSaving(false);
    }
  }, [definition, pendingSaveSource, toast, user?.activeWorkspaceId, workflowId]);

  const exportFlow = useCallback(() => {
    if (!definition) return;
    const blob = new Blob([serializeNexusPortableFlow(definition)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = nexusPortableFilename(definition.name);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    toast({ title: 'Fluxo exportado', description: 'O JSON nativo preserva blocos, conexões e configurações sem incluir segredos.' });
  }, [definition, toast]);

  const publish = useCallback(async () => {
    if (!definition || !user?.activeWorkspaceId) return;
    setPublishing(true);
    try {
      if (isDirty) {
        const saved = await save(definition);
        if (!saved) return;
      }
      const result = await publishNexusWorkflow({
        workspaceId: user.activeWorkspaceId,
        workflowId,
        definition,
      });
      if (!result.success) {
        toast({ title: 'Publicação bloqueada', description: result.error, variant: 'destructive' });
        return;
      }
      const rebound = bindStandaloneNexusWorkflow({
        definition,
        id: workflowId,
        workspaceId: user.activeWorkspaceId,
      });
      setDefinition(rebound);
      setLoadedDefinition(rebound);
      setHasUnpublishedChanges(false);
      setPublishedRevision(result.revision || publishedRevision + 1);
      toast({ title: 'Fluxo publicado', description: `Versão v${result.revision} pronta no runtime da Dialogy.` });
    } finally {
      setPublishing(false);
    }
  }, [definition, isDirty, publishedRevision, save, toast, user?.activeWorkspaceId, workflowId]);

  if (loading && !definition) {
    return (
      <div className="flex min-h-[calc(100dvh-4rem)] items-center justify-center bg-[#f8fafc] text-slate-700">
        <Loader2 className="mr-3 h-6 w-6 animate-spin text-slate-700" />
        Carregando fluxo Nexus...
      </div>
    );
  }

  if (loadError || !definition || !user?.activeWorkspaceId) {
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
      <NativeWorkflowBuilder
        surface="standalone"
        definition={definition}
        defaultModel={defaultModel}
        modelOptions={models}
        knowledgeDocuments={knowledgeDocuments}
        knowledgeCollections={knowledgeCollections}
        tools={tools}
        toolsLoading={false}
        isSaving={saving}
        isPublishing={publishing}
        isDirty={isDirty}
        hasDraft={hasDraft}
        onChange={setDefinition}
        onBack={() => router.push('/nexus')}
        onOpenSettings={() => setDeploymentOpen(true)}
        onOpenModelSettings={() => router.push('/integrations/ai')}
        onOpenPanel={(panel) => {
          if (panel === 'executions' || panel === 'analytics') setExecutionsOpen(true);
          else if (panel === 'versions') setHistoryOpen(true);
          else if (panel === 'settings') setDeploymentOpen(true);
          else if (panel === 'capabilities') router.push('/integrations/mcp');
          else if (panel === 'knowledge') router.push('/autopilot');
        }}
        onExport={exportFlow}
        onImport={() => setImportOpen(true)}
        credentialOptions={credentials}
        dialogyResources={resources}
        onManageCredentials={() => setCredentialsOpen(true)}
        onTest={async (payload) => {
          const result = await runNexusWorkflowTest({
            workspaceId: user.activeWorkspaceId!,
            workflowId,
            definition,
            message: payload.message.trim(),
            fixtures: payload.fixtures,
          });
          if (!result.success) toast({ title: 'Falha no teste', description: result.error, variant: 'destructive' });
          return result;
        }}
        onResumeTest={async (payload) => {
          const result = await resumeNexusWorkflowTest({
            workspaceId: user.activeWorkspaceId!,
            workflowId,
            resumeToken: payload.resumeToken,
            customerMessage: payload.message.trim(),
            definition,
          });
          if (!result.success) toast({ title: 'Falha ao continuar o teste', description: result.error, variant: 'destructive' });
          return result;
        }}
        onTestNode={async (startNodeId, payload) => {
          const result = await runNexusWorkflowTest({
            workspaceId: user.activeWorkspaceId!,
            workflowId,
            definition,
            message: payload.message.trim() || 'Teste isolado do Nexus.',
            startNodeId,
            fixtures: payload.fixtures,
          });
          if (!result.success) toast({ title: 'Falha no teste isolado', description: result.error, variant: 'destructive' });
          return result;
        }}
        onSave={() => void save()}
        onPublish={() => void publish()}
      />
      <LegacyNexusImportDialog
        disabled={saving || publishing}
        workspaceId={user.activeWorkspaceId}
        configId={workflowId}
        name={definition.name}
        model={defaultModel}
        mcpTools={tools.filter((tool) => tool.source === 'mcp')}
        open={importOpen}
        onOpenChange={setImportOpen}
        hideTrigger
        onApply={(workflow, report) => {
          setDefinition(bindStandaloneNexusWorkflow({
            definition: workflow,
            id: workflowId,
            workspaceId: user.activeWorkspaceId!,
            name: definition.name,
          }));
          setPendingSaveSource('import');
          toast({
            title: 'Fluxo antigo convertido',
            description: `${report.importedNodes} blocos foram importados para este fluxo independente.`,
          });
        }}
      />
      <NexusCredentialsDialog
        workspaceId={user.activeWorkspaceId}
        open={credentialsOpen}
        onOpenChange={setCredentialsOpen}
        onChange={setCredentials}
      />
      <NexusDeploymentDialog
        workspaceId={user.activeWorkspaceId}
        workflowId={workflowId}
        definition={definition}
        systemAgents={resources.systemAgents}
        open={deploymentOpen}
        onOpenChange={setDeploymentOpen}
        onSaveSenderSystemAgent={async (senderSystemAgentId) => {
          const nextDefinition: WorkflowDefinition = {
            ...definition,
            metadata: {
              ...(definition.metadata || {}),
              senderSystemAgentId,
            },
            updatedAt: new Date().toISOString(),
          };
          setDefinition(nextDefinition);
          return save(nextDefinition);
        }}
      />
      <NexusWorkflowHistoryDialog
        workspaceId={user.activeWorkspaceId}
        workflowId={workflowId}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        onRestore={(workflow) => {
          setDefinition(workflow);
          setLoadedDefinition(workflow);
          setPendingSaveSource('save');
        }}
      />
      <NexusWorkflowExecutionsDialog
        workspaceId={user.activeWorkspaceId}
        workflowId={workflowId}
        open={executionsOpen}
        onOpenChange={setExecutionsOpen}
      />
    </div>
  );
}
