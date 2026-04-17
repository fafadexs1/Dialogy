'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { AutopilotConfig, Workspace } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useCurrentUser } from '@/hooks/use-online-status';
import {
    getAutopilotConfig,
    createAutopilotAgent,
} from '@/actions/autopilot';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import {
    Loader2,
    Bot,
    Plus,
    ShieldCheck,
    Globe2,
    Lock,
    Sparkles,
    ArrowRight,
    BrainCircuit,
    Power,
} from 'lucide-react';

type AgentVisibilityMode = 'public' | 'private';

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

export default function AutopilotPage() {
    const router = useRouter();
    const { toast } = useToast();
    const user = useCurrentUser();

    const [loading, setLoading] = useState(true);
    const [agents, setAgents] = useState<AutopilotConfig[]>([]);
    const [workspace, setWorkspace] = useState<Workspace | null>(null);

    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
    const [isCreatingAgent, setIsCreatingAgent] = useState(false);
    const [newAgentName, setNewAgentName] = useState('');
    const [newAgentVisibility, setNewAgentVisibility] = useState<AgentVisibilityMode>('public');

    const fetchData = useCallback(async () => {
        if (!user?.activeWorkspaceId) return;

        setLoading(true);
        try {
            const data = await getAutopilotConfig(user.activeWorkspaceId);

            if (data.error) {
                toast({ title: 'Erro ao carregar', description: data.error, variant: 'destructive' });
                return;
            }

            setAgents(data.agents || []);
            setWorkspace(data.workspace || null);
        } finally {
            setLoading(false);
        }
    }, [toast, user?.activeWorkspaceId]);

    useEffect(() => {
        if (user?.activeWorkspaceId) {
            fetchData();
        }
    }, [fetchData, user?.activeWorkspaceId]);

    const headerStats = useMemo(() => {
        const activeAgents = agents.filter((agent) => agent.is_active).length;
        const privateAgents = agents.filter((agent) => agent.is_private).length;

        return [
            { label: 'Agentes', value: String(agents.length).padStart(2, '0') },
            { label: 'Ativos', value: String(activeAgents).padStart(2, '0') },
            { label: 'Privados', value: String(privateAgents).padStart(2, '0') },
        ];
    }, [agents]);

    const openCreateDialog = useCallback(() => {
        setNewAgentName(`Agente ${agents.length + 1}`);
        setNewAgentVisibility('public');
        setIsCreateDialogOpen(true);
    }, [agents.length]);

    const handleCreateAgent = async () => {
        if (!user?.activeWorkspaceId) return;

        setIsCreatingAgent(true);
        try {
            const result = await createAutopilotAgent(
                user.activeWorkspaceId,
                newAgentName.trim() || `Agente ${agents.length + 1}`,
                newAgentVisibility === 'private'
            );

            if (result.success && result.id) {
                toast({
                    title: 'Agente criado',
                    description: 'Redirecionando para configuração...',
                });
                setIsCreateDialogOpen(false);
                router.push(`/autopilot/${result.id}`);
            } else {
                toast({ title: 'Erro ao criar', description: result.error, variant: 'destructive' });
            }
        } finally {
            setIsCreatingAgent(false);
        }
    };

    if (loading && agents.length === 0) {
        return (
            <div className="flex h-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col bg-slate-50/50">
            <section className="bg-white border-b">
                <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-8 px-4 py-10 sm:px-6 lg:px-8">
                    <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                        <div className="max-w-3xl space-y-4">
                            <div className="inline-flex items-center gap-2 rounded-full bg-teal-50 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-teal-700 border border-teal-100">
                                <Sparkles className="h-3 w-3" />
                                Dialogy Autopilot
                            </div>
                            <div className="space-y-2">
                                <h1 className="text-4xl font-extrabold tracking-tight text-slate-900">
                                    Seus Agentes de IA
                                </h1>
                                <p className="text-lg text-slate-500 leading-relaxed">
                                    Gerencie e configure agentes inteligentes para automatizar seu atendimento. 
                                    Cada agente pode ter sua própria base de conhecimento e habilidades únicas.
                                </p>
                            </div>
                            <Button onClick={openCreateDialog} size="lg" className="rounded-full gap-2 px-8 shadow-sm">
                                <Plus className="h-5 w-5" />
                                Novo Agente
                            </Button>
                        </div>

                        <div className="flex gap-4">
                            {headerStats.map((stat) => (
                                <div key={stat.label} className="bg-slate-100/50 rounded-2xl p-4 min-w-[120px] border border-slate-200/50">
                                    <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                                        {stat.label}
                                    </div>
                                    <div className="mt-1 text-2xl font-bold text-slate-900">{stat.value}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </section>

            <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col px-4 py-8 sm:px-6 lg:px-8">
                {agents.length > 0 ? (
                    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                        {agents.map((agent) => (
                            <Card
                                key={agent.id}
                                role="button"
                                tabIndex={0}
                                onClick={() => router.push(`/autopilot/${agent.id}`)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault();
                                        router.push(`/autopilot/${agent.id}`);
                                    }
                                }}
                                className="group relative overflow-hidden border-slate-200 bg-white hover:border-teal-400 hover:shadow-xl hover:shadow-teal-900/5 transition-all duration-300 cursor-pointer rounded-2xl"
                            >
                                <CardContent className="p-6 space-y-6">
                                    <div className="flex items-start justify-between">
                                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900 text-white group-hover:bg-teal-600 transition-colors">
                                            <BrainCircuit className="h-6 w-6" />
                                        </div>
                                        <div className="flex gap-2">
                                            {agent.is_primary && (
                                                <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-[10px]">
                                                    Principal
                                                </Badge>
                                            )}
                                            <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200 text-[10px]">
                                                {agent.is_private ? <Lock className="h-3 w-3 mr-1" /> : <Globe2 className="h-3 w-3 mr-1" />}
                                                {agent.is_private ? 'Privado' : 'Público'}
                                            </Badge>
                                        </div>
                                    </div>

                                    <div className="space-y-1">
                                        <h3 className="text-xl font-bold text-slate-900 group-hover:text-teal-700 transition-colors">
                                            {agent.name}
                                        </h3>
                                        <p className="text-sm text-slate-500 font-medium">
                                            {getModelLabel(agent.ai_model)}
                                        </p>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                                            <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Status</div>
                                            <div className="mt-1 flex items-center gap-1.5 font-bold text-sm">
                                                <div className={cn("h-2 w-2 rounded-full", agent.is_active ? "bg-emerald-500" : "bg-slate-300")} />
                                                {agent.is_active ? 'ATIVO' : 'PAUSADO'}
                                            </div>
                                        </div>
                                        <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                                            <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Documentos</div>
                                            <div className="mt-1 font-bold text-sm">
                                                {agent.knowledge_base_documents?.length || 0} docs
                                            </div>
                                        </div>
                                    </div>

                                    <div className="pt-2 flex items-center justify-between text-xs font-bold text-slate-400">
                                        <span>Última alteração recente</span>
                                        <span className="flex items-center gap-1 text-teal-600 group-hover:translate-x-1 transition-transform">
                                            Configurar <ArrowRight className="h-4 w-4" />
                                        </span>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center py-20 px-6 text-center bg-white rounded-3xl border-2 border-dashed border-slate-200">
                        <div className="h-20 w-20 bg-slate-50 rounded-full flex items-center justify-center mb-6">
                            <Bot className="h-10 w-10 text-slate-300" />
                        </div>
                        <h2 className="text-2xl font-bold text-slate-900 mb-2">Nenhum agente criado</h2>
                        <p className="text-slate-500 max-w-sm mb-8">
                            Comece criando seu primeiro agente inteligente para automatizar seu workflow.
                        </p>
                        <Button onClick={openCreateDialog} size="lg" className="rounded-full px-10">
                            Criar Primeiro Agente
                        </Button>
                    </div>
                )}
            </main>

            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
                <DialogContent className="sm:max-w-[425px] rounded-3xl p-0 overflow-hidden border-0 shadow-2xl">
                    <DialogHeader className="p-6 bg-slate-900 text-white">
                        <DialogTitle className="text-xl font-bold">Novo Agente</DialogTitle>
                        <DialogDescription className="text-slate-400">
                            Configure o nome e a visibilidade básica.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="p-6 space-y-6">
                        <div className="space-y-2">
                            <Label htmlFor="new-agent-name" className="text-slate-900 font-bold">Nome do Agente</Label>
                            <Input
                                id="new-agent-name"
                                value={newAgentName}
                                onChange={(e) => setNewAgentName(e.target.value)}
                                placeholder="Ex: Atendimento Comercial"
                                className="rounded-xl border-slate-200 h-11"
                            />
                        </div>

                        <div className="space-y-3">
                            <Label className="text-slate-900 font-bold">Visibilidade</Label>
                            <RadioGroup
                                value={newAgentVisibility}
                                onValueChange={(v) => setNewAgentVisibility(v as AgentVisibilityMode)}
                                className="grid gap-4"
                            >
                                <Label className="flex items-center gap-4 rounded-xl border border-slate-200 p-4 cursor-pointer hover:bg-slate-50 transition-colors [&:has(button[data-state=checked])]:border-teal-500 [&:has(button[data-state=checked])]:bg-teal-50/30">
                                    <RadioGroupItem value="public" id="public" />
                                    <div className="space-y-0.5">
                                        <div className="font-bold text-slate-900">Público</div>
                                        <div className="text-xs text-slate-500">Visível para todos no workspace</div>
                                    </div>
                                </Label>
                                <Label className="flex items-center gap-4 rounded-xl border border-slate-200 p-4 cursor-pointer hover:bg-slate-50 transition-colors [&:has(button[data-state=checked])]:border-teal-500 [&:has(button[data-state=checked])]:bg-teal-50/30">
                                    <RadioGroupItem value="private" id="private" />
                                    <div className="space-y-0.5">
                                        <div className="font-bold text-slate-900">Privado</div>
                                        <div className="text-xs text-slate-500">Apenas você pode ver e usar</div>
                                    </div>
                                </Label>
                            </RadioGroup>
                        </div>
                    </div>

                    <DialogFooter className="p-6 border-t bg-slate-50">
                        <Button variant="ghost" onClick={() => setIsCreateDialogOpen(false)} className="rounded-full">
                            Cancelar
                        </Button>
                        <Button onClick={handleCreateAgent} disabled={isCreatingAgent} className="rounded-full px-8">
                            {isCreatingAgent ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                            Criar Agente
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
