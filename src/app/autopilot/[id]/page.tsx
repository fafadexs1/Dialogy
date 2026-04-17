'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
    Loader2,
    LayoutDashboard,
    Database,
    Zap,
    Settings2,
    CheckCircle2,
    Save,
    ArrowLeft,
    Power,
    ShieldCheck,
} from 'lucide-react';
import { AutopilotStats } from '@/components/autopilot/autopilot-stats';
import { AutopilotKnowledge } from '@/components/autopilot/autopilot-knowledge';
import { AutopilotRules } from '@/components/autopilot/autopilot-rules';
import { AutopilotSettings } from '@/components/autopilot/autopilot-settings';
import { AutomationForm } from '@/components/autopilot/automation-form';
import { Dialog, DialogContent } from '@/components/ui/dialog';

const DEFAULT_MODEL = 'googleai/gemini-2.0-flash';

function getModelLabel(model?: string | null) {
    switch (model) {
        case 'googleai/gemini-3-flash-preview':
            return 'Gemini 3 Flash';
        case 'googleai/gemini-1.5-pro':
            return 'Gemini 1.5 Pro';
        case 'googleai/gemini-2.0-flash':
        default:
            return 'Gemini 2.0 Flash';
    }
}

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
    const [hasGlobalKey, setHasGlobalKey] = useState(false);

    const [agentName, setAgentName] = useState('');
    const [aiModel, setAiModel] = useState(DEFAULT_MODEL);
    const [isActive, setIsActive] = useState(false);
    const [isPrivate, setIsPrivate] = useState(false);
    const [isPrimary, setIsPrimary] = useState(false);
    const [geminiApiKey, setGeminiApiKey] = useState('');
    const [knowledgeBase, setKnowledgeBase] = useState('');
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

    const fetchData = useCallback(async () => {
        if (!user?.activeWorkspaceId || !agentId) return;

        setLoading(true);
        try {
            const data = await getAutopilotConfig(user.activeWorkspaceId, agentId);

            if (data.error) {
                toast({ title: 'Erro ao carregar', description: data.error, variant: 'destructive' });
                router.push('/autopilot');
                return;
            }

            if (!data.config) {
                router.push('/autopilot');
                return;
            }

            setConfig(data.config);
            setInstances(data.rules || []);
            setWorkspace(data.workspace || null);
            setHasGlobalKey(!!data.hasGlobalKey);

            setAgentName(data.config.name || '');
            setAiModel(data.config.ai_model || DEFAULT_MODEL);
            setIsActive(Boolean(data.config.is_active));
            setIsPrivate(Boolean(data.config.is_private));
            setIsPrimary(Boolean(data.config.is_primary));
            setGeminiApiKey(data.config.gemini_api_key || '');
            setKnowledgeBase(data.config.knowledge_base || '');
            setKnowledgeDocuments(data.config.knowledge_base_documents || []);

            getAutopilotUsageLogs(data.config.id).then((logsData) => {
                setUsageLogs(logsData.logs || []);
            });
        } finally {
            setLoading(false);
        }
    }, [agentId, router, toast, user?.activeWorkspaceId]);

    useEffect(() => {
        if (user?.activeWorkspaceId && agentId) {
            fetchData();
        }
    }, [fetchData, user?.activeWorkspaceId, agentId]);

    const documentSignature = useMemo(() => buildDocumentSignature(knowledgeDocuments), [knowledgeDocuments]);
    const configDocumentSignature = useMemo(
        () => buildDocumentSignature(config?.knowledge_base_documents),
        [config?.knowledge_base_documents]
    );

    const isDirty = useMemo(() => {
        if (!config) return false;

        return (
            agentName !== (config.name || '') ||
            aiModel !== (config.ai_model || DEFAULT_MODEL) ||
            isActive !== Boolean(config.is_active) ||
            isPrivate !== Boolean(config.is_private) ||
            geminiApiKey !== (config.gemini_api_key || '') ||
            knowledgeBase !== (config.knowledge_base || '') ||
            documentSignature !== configDocumentSignature
        );
    }, [
        agentName,
        aiModel,
        config,
        configDocumentSignature,
        documentSignature,
        geminiApiKey,
        isActive,
        isPrivate,
        knowledgeBase,
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
            formData.append('knowledgeBaseDocuments', JSON.stringify(knowledgeDocuments));

            const result = await saveAutopilotConfig({ success: false }, formData);

            if (result.success) {
                toast({ title: 'Agente salvo', description: 'As mudanças já estão refletidas no workspace.' });
                fetchData();
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
        } catch (_error) {
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
            fetchData();
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
        <div className="flex h-full flex-col bg-slate-50/50">
            <header className="border-b bg-white px-4 py-4 sm:px-6 lg:px-8">
                <div className="mx-auto flex max-w-[1600px] items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => router.push('/autopilot')}
                            className="rounded-full"
                        >
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                        <div>
                            <h1 className="text-xl font-bold text-slate-950">{agentName || config.name}</h1>
                            <div className="flex items-center gap-2">
                                <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                                    {getModelLabel(aiModel)}
                                </Badge>
                                {isActive ? (
                                    <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-600">
                                        <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                        ATIVO
                                    </span>
                                ) : (
                                    <span className="flex items-center gap-1 text-[10px] font-medium text-slate-400">
                                        <div className="h-1.5 w-1.5 rounded-full bg-slate-300" />
                                        PAUSADO
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        {isDirty ? (
                            <Badge className="border-0 bg-amber-100 text-amber-700 hover:bg-amber-100">
                                Alterações pendentes
                            </Badge>
                        ) : (
                            <Badge className="border-0 bg-emerald-50 text-emerald-700 hover:bg-emerald-50">
                                <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                                Sincronizado
                            </Badge>
                        )}
                        <Button
                            onClick={handleSaveConfig}
                            disabled={isSaving || !isDirty}
                            className="gap-2 rounded-full px-5 shadow-sm"
                        >
                            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                            Salvar Alterações
                        </Button>
                    </div>
                </div>
            </header>

            <main className="mx-auto w-full max-w-[1600px] flex-1 overflow-hidden p-4 sm:p-6 lg:p-8">
                <Tabs defaultValue="overview" className="flex h-full flex-col gap-6">
                    <TabsList className="inline-flex h-12 w-fit items-center justify-center rounded-xl bg-white p-1 shadow-sm border">
                        <TabsTrigger value="overview" className="gap-2 rounded-lg px-6 data-[state=active]:bg-slate-100 data-[state=active]:text-slate-950">
                            <LayoutDashboard className="h-4 w-4" /> Visão Geral
                        </TabsTrigger>
                        <TabsTrigger value="knowledge" className="gap-2 rounded-lg px-6 data-[state=active]:bg-slate-100 data-[state=active]:text-slate-950">
                            <Database className="h-4 w-4" /> Conhecimento
                        </TabsTrigger>
                        <TabsTrigger value="rules" className="gap-2 rounded-lg px-6 data-[state=active]:bg-slate-100 data-[state=active]:text-slate-950">
                            <Zap className="h-4 w-4" /> Habilidades
                        </TabsTrigger>
                        <TabsTrigger value="settings" className="gap-2 rounded-lg px-6 data-[state=active]:bg-slate-100 data-[state=active]:text-slate-950">
                            <Settings2 className="h-4 w-4" /> Ajustes
                        </TabsTrigger>
                    </TabsList>

                    <div className="min-h-0 flex-1 overflow-y-auto pr-2">
                        <TabsContent value="overview" className="mt-0 space-y-6">
                            <div className="grid gap-6 lg:grid-cols-3">
                                <Card className="lg:col-span-2 border-0 shadow-sm bg-white">
                                    <CardContent className="p-8 space-y-6">
                                        <div className="flex flex-wrap items-center gap-3">
                                            <Badge variant={isPrivate ? "secondary" : "outline"} className="rounded-full">
                                                {isPrivate ? 'Privado' : 'Público'}
                                            </Badge>
                                            <Badge variant={isActive ? "default" : "secondary"} className="rounded-full">
                                                {isActive ? 'Ativo' : 'Pausado'}
                                            </Badge>
                                            {isPrimary && (
                                                <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 border-0 rounded-full">
                                                    Agente Principal
                                                </Badge>
                                            )}
                                        </div>

                                        <div className="space-y-3">
                                            <h2 className="text-3xl font-bold tracking-tight text-slate-950">{agentName || config.name}</h2>
                                            <p className="text-slate-600 leading-relaxed max-w-2xl">
                                                {knowledgeBase?.trim() 
                                                    ? knowledgeBase.trim() 
                                                    : 'Defina a persona do agente na aba de Ajustes para orientar tom, regras de atendimento e objetivo operacional.'}
                                            </p>
                                        </div>

                                        <div className="pt-4 flex items-center gap-3">
                                            <Button 
                                                onClick={() => setIsActive(!isActive)}
                                                variant={isActive ? "outline" : "default"}
                                                className="rounded-full px-8"
                                            >
                                                {isActive ? 'Pausar Operação' : 'Ativar Agora'}
                                            </Button>
                                            {!isPrimary && (
                                                <Button 
                                                    onClick={handleSetPrimary}
                                                    variant="secondary"
                                                    className="rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200"
                                                >
                                                    Tornar Principal
                                                </Button>
                                            )}
                                        </div>
                                    </CardContent>
                                </Card>

                                <div className="space-y-6">
                                    <Card className="border-0 shadow-sm bg-white">
                                        <CardContent className="p-6">
                                            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-4">
                                                Estatísticas da Base
                                            </div>
                                            <div className="space-y-4">
                                                <div className="flex justify-between items-end">
                                                    <div>
                                                        <div className="text-3xl font-bold text-slate-950">{knowledgeDocuments.length}</div>
                                                        <div className="text-xs text-slate-500">Documentos</div>
                                                    </div>
                                                    <div className="h-10 w-10 bg-teal-50 rounded-xl flex items-center justify-center text-teal-600">
                                                        <Database className="h-5 w-5" />
                                                    </div>
                                                </div>
                                                <div className="flex justify-between items-end">
                                                    <div>
                                                        <div className="text-3xl font-bold text-slate-950">{instances.filter(i => i.enabled).length}</div>
                                                        <div className="text-xs text-slate-500">Habilidades Ativas</div>
                                                    </div>
                                                    <div className="h-10 w-10 bg-orange-50 rounded-xl flex items-center justify-center text-orange-600">
                                                        <Zap className="h-5 w-5" />
                                                    </div>
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>

                                    <AutopilotStats usageLogs={usageLogs} loading={loading} />
                                </div>
                            </div>
                        </TabsContent>

                        <TabsContent value="knowledge" className="mt-0">
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

                        <TabsContent value="rules" className="mt-0 pb-10">
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

                        <TabsContent value="settings" className="mt-0 pb-10">
                            <AutopilotSettings
                                agentName={agentName}
                                setAgentName={setAgentName}
                                aiModel={aiModel}
                                setAiModel={setAiModel}
                                knowledgeBase={knowledgeBase}
                                setKnowledgeBase={setKnowledgeBase}
                                isActive={isActive}
                                setIsActive={setIsActive}
                                isPrivate={isPrivate}
                                setIsPrivate={setIsPrivate}
                                isPrimary={isPrimary}
                                onSetPrimary={handleSetPrimary}
                                geminiApiKey={geminiApiKey}
                                setGeminiApiKey={setGeminiApiKey}
                                hasGlobalKey={hasGlobalKey}
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
                <DialogContent className="h-[85vh] max-w-2xl gap-0 p-0">
                    {config && (
                        <AutomationForm
                            configId={config.id}
                            instance={editingRule}
                            onClose={() => setIsRuleModalOpen(false)}
                            onSuccess={() => {
                                setIsRuleModalOpen(false);
                                fetchData();
                            }}
                        />
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
