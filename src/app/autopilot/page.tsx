'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type { AutopilotConfig, AutopilotUsageLog, KnowledgeBaseDocument, NexusFlowInstance, Workspace } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useCurrentUser } from '@/hooks/use-online-status';
import {
    getAutopilotConfig,
    saveAutopilotConfig,
    deleteAutopilotRule,
    toggleAutopilotRule,
    getAutopilotUsageLogs,
    createAutopilotAgent,
    deleteAutopilotAgent,
    setPrimaryAutopilotAgent
} from '@/actions/autopilot';

// UI Components
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Loader2, LayoutDashboard, Database, Zap, Settings2 } from 'lucide-react';

// Sub-components
import { AutopilotHeader } from '@/components/autopilot/autopilot-header';
import { AutopilotStats } from '@/components/autopilot/autopilot-stats';
import { AutopilotKnowledge } from '@/components/autopilot/autopilot-knowledge';
import { AutopilotRules } from '@/components/autopilot/autopilot-rules';
import { AutopilotSettings } from '@/components/autopilot/autopilot-settings';
import { AutomationForm } from '@/components/autopilot/automation-form';

export default function AutopilotPage() {
    const { toast } = useToast();
    const user = useCurrentUser();

    // State
    const [loading, setLoading] = useState(true);
    const [config, setConfig] = useState<AutopilotConfig | null>(null);
    const [instances, setInstances] = useState<NexusFlowInstance[]>([]);
    const [usageLogs, setUsageLogs] = useState<AutopilotUsageLog[]>([]);
    const [agents, setAgents] = useState<AutopilotConfig[]>([]);
    const [workspace, setWorkspace] = useState<Workspace | null>(null);
    const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
    const [hasGlobalKey, setHasGlobalKey] = useState(false);

    // Form/Edit States
    const [agentName, setAgentName] = useState('');
    const [aiModel, setAiModel] = useState('googleai/gemini-2.0-flash');
    const [isActive, setIsActive] = useState(false);
    const [isPrivate, setIsPrivate] = useState(false);
    const [isPrimary, setIsPrimary] = useState(false);
    const [geminiApiKey, setGeminiApiKey] = useState('');
    const [knowledgeBase, setKnowledgeBase] = useState('');
    const [knowledgeDocuments, setKnowledgeDocuments] = useState<KnowledgeBaseDocument[]>([]);

    // UI States
    const [isSaving, setIsSaving] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [isRuleModalOpen, setIsRuleModalOpen] = useState(false);
    const [editingRule, setEditingRule] = useState<NexusFlowInstance | null>(null);

    const estimateTokens = useCallback((content: string) => {
        const normalized = content?.trim() || '';
        if (normalized.length === 0) return 0;
        return Math.max(1, Math.ceil(normalized.length / 4));
    }, []);

    const fetchData = useCallback(async (preferredAgentId?: string) => {
        if (!user?.activeWorkspaceId) return;

        setLoading(true);
        try {
            const data = await getAutopilotConfig(user.activeWorkspaceId, preferredAgentId || selectedAgentId || undefined);

            if (data.error) {
                toast({ title: "Erro ao carregar", description: data.error, variant: 'destructive' });
                return;
            }

            setAgents(data.agents || []);
            setConfig(data.config);
            setInstances(data.rules || []);
            setWorkspace(data.workspace || null);
            setHasGlobalKey(!!data.hasGlobalKey);

            if (data.config) {
                setSelectedAgentId(data.config.id);
                setAgentName(data.config.name || '');
                setAiModel(data.config.ai_model || 'googleai/gemini-2.0-flash');
                setIsActive(Boolean(data.config.is_active));
                setIsPrivate(Boolean(data.config.is_private));
                setIsPrimary(Boolean(data.config.is_primary));
                setGeminiApiKey(data.config.gemini_api_key || '');
                setKnowledgeBase(data.config.knowledge_base || '');
                setKnowledgeDocuments(data.config.knowledge_base_documents || []);

                // Fetch stats separately to not block UI
                getAutopilotUsageLogs(data.config.id).then(logsData => {
                    setUsageLogs(logsData.logs || []);
                });
            } else {
                // No config / No agents
                setSelectedAgentId(null);
                setAgentName('');
                setUsageLogs([]);
            }
        } finally {
            setLoading(false);
        }
    }, [user?.activeWorkspaceId, selectedAgentId, toast]);

    // Initial Load
    useEffect(() => {
        if (user?.activeWorkspaceId) {
            fetchData();
        }
    }, [user?.activeWorkspaceId, fetchData]);

    // --- Actions ---

    const handleCreateAgent = async () => {
        if (!user?.activeWorkspaceId) return;
        const nextName = `Agente ${agents.length + 1}`;
        const result = await createAutopilotAgent(user.activeWorkspaceId, nextName);
        if (result.success && result.id) {
            toast({ title: 'Agente criado!', description: 'Configure o novo agente.' });
            fetchData(result.id);
        } else {
            toast({ title: 'Erro ao criar', description: result.error, variant: 'destructive' });
        }
    };

    const handleDeleteAgent = async () => {
        if (!config || !confirm('Tem certeza? Isso apagará este agente e todas as suas automações. Esta ação não pode ser desfeita.')) return;

        const result = await deleteAutopilotAgent(config.id);
        if (result.success) {
            toast({ title: 'Agente excluído' });
            // Select another agent or reset
            const remaining = agents.filter(a => a.id !== config.id);
            if (remaining.length > 0) {
                fetchData(remaining[0].id);
            } else {
                // Determine no agents left state
                setConfig(null);
                setAgents([]);
                setSelectedAgentId(null);
            }
        } else {
            toast({ title: 'Erro ao excluir', description: result.error, variant: 'destructive' });
        }
    };

    const handleAgentSelect = (id: string) => {
        fetchData(id);
    };

    const handleSetPrimary = async () => {
        if (!config || !user?.activeWorkspaceId) return;
        const result = await setPrimaryAutopilotAgent(config.id);
        if (result.success) {
            toast({ title: 'Agente definido como principal' });
            fetchData(config.id);
        } else {
            toast({ title: 'Erro ao definir principal', description: result.error, variant: 'destructive' });
        }
    };

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
            // Re-serialize documents
            formData.append('knowledgeBaseDocuments', JSON.stringify(knowledgeDocuments));

            // We need to adapt the saveAutopilotConfig to accept FormData or object
            // The existing action takes FormData.
            const result = await saveAutopilotConfig({ success: false }, formData);

            if (result.success) {
                toast({ title: 'Configurações Salvas!' });
                fetchData(config.id);
            } else {
                toast({ title: 'Erro ao salvar', description: result.error, variant: 'destructive' });
            }
        } catch (e: any) {
            toast({ title: 'Erro inesperado', description: e.message, variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    };

    // --- Knowledge Actions ---

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
            setKnowledgeDocuments(prev => [...prev, ...additions]);
            toast({ title: 'Arquivos carregados', description: 'Não esqueça de salvar as alterações.' });
        } catch (error) {
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
        setKnowledgeDocuments(prev => [...prev, newDoc]);
    };

    const handleUpdateDoc = (id: string, content: string) => {
        setKnowledgeDocuments(prev => prev.map(doc => doc.id === id ? { ...doc, content, tokens: estimateTokens(content) } : doc));
    };

    const handleUpdateDocName = (id: string, name: string) => {
        setKnowledgeDocuments(prev => prev.map(doc => doc.id === id ? { ...doc, name } : doc));
    };

    const handleRemoveDoc = (id: string) => {
        setKnowledgeDocuments(prev => prev.filter(doc => doc.id !== id));
    };

    // --- Rules Actions ---

    const handleToggleRule = async (id: string, enabled: boolean) => {
        const result = await toggleAutopilotRule(id, enabled);
        if (result.success) {
            setInstances(prev => prev.map(r => r.id === id ? { ...r, enabled } : r));
            toast({ title: enabled ? 'Regra ativada' : 'Regra desativada' });
        }
    };

    const handleDeleteRule = async (id: string) => {
        if (!confirm('Excluir esta regra permanentemente?')) return;
        const result = await deleteAutopilotRule(id);
        if (result.success) {
            setInstances(prev => prev.filter(r => r.id !== id));
            toast({ title: 'Regra removida' });
        }
    };

    // --- Render ---

    if (loading && !config) {
        return <div className="flex h-full items-center justify-center"><Loader2 className="animate-spin h-8 w-8 text-primary" /></div>;
    }

    return (
        <div className="flex flex-col h-full bg-muted/5">
            <AutopilotHeader
                agents={agents}
                selectedAgentId={selectedAgentId}
                onAgentSelect={handleAgentSelect}
                onCreateAgent={handleCreateAgent}
            />

            <main className="flex-1 overflow-hidden p-4 sm:p-6">
                {!config ? (
                    <div className="flex flex-col items-center justify-center h-full text-center max-w-md mx-auto">
                        <div className="h-24 w-24 rounded-full bg-blue-500/10 flex items-center justify-center mb-6">
                            <Zap className="h-12 w-12 text-blue-500" />
                        </div>
                        <h2 className="text-2xl font-bold mb-2">Vamos criar seu primeiro Agente?</h2>
                        <p className="text-muted-foreground mb-6">Você ainda não tem um copiloto configurado. Clique no botão acima ou abaixo para começar.</p>
                        <button onClick={handleCreateAgent} className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium shadow-lg hover:shadow-xl transition-all">
                            Criar Agente Agora
                        </button>
                    </div>
                ) : (
                    <Tabs defaultValue="overview" className="h-full flex flex-col">
                        <div className="flex-shrink-0 mb-6">
                            <TabsList className="grid w-full grid-cols-4 max-w-2xl bg-muted/50 p-1">
                                <TabsTrigger value="overview" className="gap-2"><LayoutDashboard className="h-4 w-4" /> Visão Geral</TabsTrigger>
                                <TabsTrigger value="knowledge" className="gap-2"><Database className="h-4 w-4" /> Conhecimento</TabsTrigger>
                                <TabsTrigger value="rules" className="gap-2"><Zap className="h-4 w-4" /> Habilidades</TabsTrigger>
                                <TabsTrigger value="settings" className="gap-2"><Settings2 className="h-4 w-4" /> Ajustes</TabsTrigger>
                            </TabsList>
                        </div>

                        <div className="flex-1 overflow-y-auto pr-2 min-h-0">
                            <TabsContent value="overview" className="mt-0 space-y-6">
                                <AutopilotStats usageLogs={usageLogs} loading={loading} />
                                {/* Quick Toggle for convenience */}
                                <div className="flex items-center justify-between p-6 bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl text-white shadow-lg">
                                    <div>
                                        <h3 className="text-xl font-bold mb-1">Status do Agente</h3>
                                        <p className="opacity-90">{isActive ? 'O agente está operando normalmente.' : 'O agente está pausado e não responderá.'}</p>
                                    </div>
                                    <button
                                        onClick={() => {
                                            setIsActive(!isActive);
                                            // Trigger save immediately for UX or require "Save" button?
                                            // Let's rely on global save for simplicity, but update UI
                                            toast({ title: 'Alteração pendente. Clique em Salvar na aba Ajustes para persistir.', variant: 'default' });
                                        }}
                                        className={`px-4 py-2 rounded-lg font-semibold transition-colors ${isActive ? 'bg-white text-blue-600' : 'bg-black/30 text-white hover:bg-black/40'}`}
                                    >
                                        {isActive ? 'Ativado' : 'Desativado'}
                                    </button>
                                </div>
                            </TabsContent>

                            <TabsContent value="knowledge" className="mt-0 h-full">
                                <AutopilotKnowledge
                                    documents={knowledgeDocuments}
                                    onUpload={handleKnowledgeUpload}
                                    onRemove={handleRemoveDoc}
                                    onUpdateContent={handleUpdateDoc}
                                    onUpdateName={handleUpdateDocName}
                                    onAddManual={handleAddManualDoc}
                                    isUploading={isUploading}
                                />
                                <div className="fixed bottom-6 right-6 z-50">
                                    <button
                                        onClick={handleSaveConfig}
                                        disabled={isSaving}
                                        className="h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-2xl flex items-center justify-center hover:scale-105 transition-transform"
                                        title="Salvar Alterações"
                                    >
                                        {isSaving ? <Loader2 className="h-6 w-6 animate-spin" /> : <Database className="h-6 w-6" />}
                                    </button>
                                </div>
                            </TabsContent>

                            <TabsContent value="rules" className="mt-0 pb-20">
                                <AutopilotRules
                                    rules={instances}
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
                )}
            </main>

            <Dialog open={isRuleModalOpen} onOpenChange={setIsRuleModalOpen}>
                <DialogContent className="max-w-2xl h-[85vh] p-0 gap-0">
                    {config && (
                        <AutomationForm
                            configId={config.id}
                            instance={editingRule}
                            onClose={() => setIsRuleModalOpen(false)}
                            onSuccess={() => {
                                setIsRuleModalOpen(false);
                                fetchData(config.id); // Refresh rules list
                            }}
                        />
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
