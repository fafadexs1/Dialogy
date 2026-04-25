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
  Bot,
} from 'lucide-react';

import type { AutopilotConfig, AutopilotUsageLog, KnowledgeBaseDocument, NexusFlowInstance, Workspace } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useCurrentUser } from '@/hooks/use-online-status';
import {
  getAutopilotConfig,
  saveAutopilotConfig,
  deleteAutopilotRule,
  toggleAutopilotRule,
  getAutopilotUsageLogs,
  deleteAutopilotAgent,
  setPrimaryAutopilotAgent,
} from '@/actions/autopilot';
import { getAiModelCatalogAction } from '@/actions/ai-models';
import {
  DEFAULT_AUTOPILOT_MODEL,
  getAiModelLabel,
  getAutopilotSelectableModels,
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
import { AutomationForm } from '@/components/autopilot/automation-form';
import { Dialog, DialogContent } from '@/components/ui/dialog';

function buildDocumentSignature(documents: KnowledgeBaseDocument[] | null | undefined) {
  return JSON.stringify(
    (documents || []).map((doc) => ({
      id: doc.id,
      name: doc.name,
      content: doc.content,
      tokens: doc.tokens || 0,
    }))
  );
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
  const [hasGlobalKey, setHasGlobalKey] = useState(false);
  const [workspaceDefaultAiModel, setWorkspaceDefaultAiModel] = useState<string | null>(null);
  const [workspaceHasGeminiConfig, setWorkspaceHasGeminiConfig] = useState(false);

  const [agentName, setAgentName] = useState('');
  const [aiModel, setAiModel] = useState(DEFAULT_AUTOPILOT_MODEL);
  const [isActive, setIsActive] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [isPrimary, setIsPrimary] = useState(false);
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [knowledgeBase, setKnowledgeBase] = useState('');
  const [defaultFallbackReply, setDefaultFallbackReply] = useState('');
  const [escalationPolicy, setEscalationPolicy] = useState('');
  const [closingPolicy, setClosingPolicy] = useState('');
  const [knowledgeDocuments, setKnowledgeDocuments] = useState<KnowledgeBaseDocument[]>([]);

  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isRuleModalOpen, setIsRuleModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<NexusFlowInstance | null>(null);

  const estimateTokens = useCallback((content: string) => {
    const normalized = content?.trim() || '';
    if (normalized.length === 0) return 0;
    return Math.max(1, Math.ceil(normalized.length / 4));
  }, []);

  const selectableModels = useMemo(
    () => getAutopilotSelectableModels(modelCatalog),
    [modelCatalog]
  );

  const fetchData = useCallback(async () => {
    if (!user?.activeWorkspaceId || !agentId) return;

    setLoading(true);
    try {
      const [autopilotData, catalogData] = await Promise.all([
        getAutopilotConfig(user.activeWorkspaceId, agentId),
        getAiModelCatalogAction(),
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
      const nextSelectableModels = getAutopilotSelectableModels(nextCatalog);
      const fallbackModel = nextSelectableModels[0]?.id || DEFAULT_AUTOPILOT_MODEL;

      setConfig(autopilotData.config);
      setInstances(autopilotData.rules || []);
      setWorkspace(autopilotData.workspace || null);
      setHasGlobalKey(!!autopilotData.hasGlobalKey);
      setWorkspaceDefaultAiModel(autopilotData.workspaceDefaultAiModel || null);
      setWorkspaceHasGeminiConfig(Boolean(autopilotData.workspaceHasGeminiConfig));
      setModelCatalog(nextCatalog);

      setAgentName(autopilotData.config.name || '');
      setAiModel(autopilotData.config.ai_model || fallbackModel);
      setIsActive(Boolean(autopilotData.config.is_active));
      setIsPrivate(Boolean(autopilotData.config.is_private));
      setIsPrimary(Boolean(autopilotData.config.is_primary));
      setGeminiApiKey(autopilotData.config.gemini_api_key || '');
      setKnowledgeBase(autopilotData.config.knowledge_base || '');
      setDefaultFallbackReply(autopilotData.config.default_fallback_reply || '');
      setEscalationPolicy(autopilotData.config.escalation_policy || '');
      setClosingPolicy(autopilotData.config.closing_policy || '');
      setKnowledgeDocuments(autopilotData.config.knowledge_base_documents || []);

      const logsData = await getAutopilotUsageLogs(autopilotData.config.id);
      setUsageLogs(logsData.logs || []);
    } finally {
      setLoading(false);
    }
  }, [agentId, router, toast, user?.activeWorkspaceId]);

  useEffect(() => {
    if (user?.activeWorkspaceId && agentId) {
      void fetchData();
    }
  }, [fetchData, user?.activeWorkspaceId, agentId]);

  const documentSignature = useMemo(() => buildDocumentSignature(knowledgeDocuments), [knowledgeDocuments]);
  const configDocumentSignature = useMemo(
    () => buildDocumentSignature(config?.knowledge_base_documents),
    [config?.knowledge_base_documents]
  );

  const savedModelValue = config?.ai_model || selectableModels[0]?.id || DEFAULT_AUTOPILOT_MODEL;

  const isDirty = useMemo(() => {
    if (!config) return false;

    return (
      agentName !== (config.name || '') ||
      aiModel !== savedModelValue ||
      isActive !== Boolean(config.is_active) ||
      isPrivate !== Boolean(config.is_private) ||
      geminiApiKey !== (config.gemini_api_key || '') ||
      knowledgeBase !== (config.knowledge_base || '') ||
      defaultFallbackReply !== (config.default_fallback_reply || '') ||
      escalationPolicy !== (config.escalation_policy || '') ||
      closingPolicy !== (config.closing_policy || '') ||
      documentSignature !== configDocumentSignature
    );
  }, [
    agentName,
    aiModel,
    config,
    closingPolicy,
    configDocumentSignature,
    defaultFallbackReply,
    documentSignature,
    escalationPolicy,
    geminiApiKey,
    isActive,
    isPrivate,
    knowledgeBase,
    savedModelValue,
  ]);

  const handleSaveConfig = async () => {
    if (!config || !user?.activeWorkspaceId) return;

    setIsSaving(true);
    try {
      const formData = new FormData();
      formData.append('workspaceId', user.activeWorkspaceId);
      formData.append('configId', config.id);
      formData.append('agentName', agentName);
      formData.append('aiModel', aiModel);
      formData.append('geminiApiKey', geminiApiKey);
      formData.append('isActive', isActive ? 'on' : 'off');
      formData.append('isPrivate', isPrivate ? 'on' : 'off');
      formData.append('knowledgeBase', knowledgeBase);
      formData.append('defaultFallbackReply', defaultFallbackReply);
      formData.append('escalationPolicy', escalationPolicy);
      formData.append('closingPolicy', closingPolicy);
      formData.append('knowledgeBaseDocuments', JSON.stringify(knowledgeDocuments));

      const result = await saveAutopilotConfig({ success: false }, formData);

      if (result.success) {
        toast({ title: 'Agente salvo', description: 'As mudanças já estão refletidas no workspace.' });
        await fetchData();
      } else {
        toast({ title: 'Erro ao salvar', description: result.error, variant: 'destructive' });
      }
    } catch (error: any) {
      toast({ title: 'Erro inesperado', description: error.message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleKnowledgeUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    setIsUploading(true);
    try {
      const additions: KnowledgeBaseDocument[] = [];
      for (const file of Array.from(files)) {
        const text = (await file.text()).trim();
        additions.push({
          id: globalThis.crypto?.randomUUID?.() || `${file.name}-${Date.now()}`,
          name: file.name,
          content: text,
          tokens: estimateTokens(text),
        });
      }
      setKnowledgeDocuments((prev) => [...prev, ...additions]);
      toast({ title: 'Arquivos carregados', description: 'Revise e salve para reindexar o agente.' });
    } catch {
      toast({ title: 'Falha ao ler arquivos', variant: 'destructive' });
    } finally {
      setIsUploading(false);
    }
  };

  const handleAddManualDoc = () => {
    const newDoc: KnowledgeBaseDocument = {
      id: globalThis.crypto?.randomUUID?.() || `manual-${Date.now()}`,
      name: `Nota ${(knowledgeDocuments.length + 1).toString().padStart(2, '0')}`,
      content: '',
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

  const handleRemoveDoc = (id: string) => {
    setKnowledgeDocuments((prev) => prev.filter((doc) => doc.id !== id));
  };

  const handleToggleRule = async (id: string, enabled: boolean) => {
    const result = await toggleAutopilotRule(id, enabled);
    if (result.success) {
      setInstances((prev) => prev.map((rule) => (rule.id === id ? { ...rule, enabled } : rule)));
      toast({ title: enabled ? 'Regra ativada' : 'Regra desativada' });
    }
  };

  const handleDeleteRule = async (id: string) => {
    if (!confirm('Excluir esta regra permanentemente?')) return;
    const result = await deleteAutopilotRule(id);
    if (result.success) {
      setInstances((prev) => prev.filter((rule) => rule.id !== id));
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
      await fetchData();
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
                  {agentName || config.name}
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
                Alterações pendentes
              </Badge>
            ) : (
              <Badge className="rounded-full border-0 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                Sincronizado
              </Badge>
            )}

            <Button
              onClick={handleSaveConfig}
              disabled={isSaving || !isDirty}
              className="rounded-full px-5"
            >
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Salvar alterações
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1600px] min-w-0 flex-1 flex-col">
        <Tabs defaultValue="overview" className="flex min-h-0 flex-1 flex-col gap-4">
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm">
            <TabsTrigger value="overview" className="gap-2 rounded-xl px-4 py-2">
              <LayoutDashboard className="h-4 w-4" /> Visão geral
            </TabsTrigger>
            <TabsTrigger value="knowledge" className="gap-2 rounded-xl px-4 py-2">
              <Database className="h-4 w-4" /> Conhecimento
            </TabsTrigger>
            <TabsTrigger value="rules" className="gap-2 rounded-xl px-4 py-2">
              <Zap className="h-4 w-4" /> Habilidades
            </TabsTrigger>
            <TabsTrigger value="settings" className="gap-2 rounded-xl px-4 py-2">
              <Settings2 className="h-4 w-4" /> Ajustes
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
                          Workspace com padrão Gemini
                        </Badge>
                      )}
                    </div>

                    <div className="space-y-3">
                      <h2 className="text-3xl font-bold tracking-tight text-foreground">{agentName || config.name}</h2>
                      <p className="max-w-3xl text-sm leading-7 text-muted-foreground sm:text-base">
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
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Chave global</div>
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

                  <AutopilotStats usageLogs={usageLogs} loading={loading} />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="knowledge" className="mt-0 min-w-0 pb-10">
              <AutopilotKnowledge
                documents={knowledgeDocuments}
                onUpload={handleKnowledgeUpload}
                onRemove={handleRemoveDoc}
                onUpdateContent={handleUpdateDoc}
                onUpdateName={handleUpdateDocName}
                onAddManual={handleAddManualDoc}
                isUploading={isUploading}
              />
            </TabsContent>

            <TabsContent value="rules" className="mt-0 min-w-0 pb-10">
              <AutopilotRules
                rules={instances}
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
                isActive={isActive}
                setIsActive={setIsActive}
                isPrivate={isPrivate}
                setIsPrivate={setIsPrivate}
                isPrimary={isPrimary}
                onSetPrimary={handleSetPrimary}
                geminiApiKey={geminiApiKey}
                setGeminiApiKey={setGeminiApiKey}
                hasGlobalKey={hasGlobalKey}
                workspaceHasGeminiConfig={workspaceHasGeminiConfig}
                workspaceDefaultAiModel={workspaceDefaultAiModel}
                modelOptions={selectableModels}
                onSave={handleSaveConfig}
                isSaving={isSaving}
                onDelete={handleDeleteAgent}
                workspace={workspace}
              />
            </TabsContent>
          </div>
        </Tabs>
      </main>

      <Dialog open={isRuleModalOpen} onOpenChange={setIsRuleModalOpen}>
        <DialogContent className="flex h-[90vh] max-h-[90vh] max-w-3xl flex-col overflow-hidden rounded-[28px] border border-border bg-background p-0 shadow-2xl">
          {config && (
            <AutomationForm
              configId={config.id}
              instance={editingRule}
              onClose={() => setIsRuleModalOpen(false)}
              onSuccess={() => {
                setIsRuleModalOpen(false);
                void fetchData();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
