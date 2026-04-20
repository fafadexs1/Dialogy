'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader2,
  BrainCircuit,
  Plus,
  Sparkles,
  ArrowRight,
  Globe2,
  Lock,
  Bot,
  ShieldCheck,
  CheckCircle2,
} from 'lucide-react';

import type { AutopilotConfig, Workspace } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useCurrentUser } from '@/hooks/use-online-status';
import { getAutopilotConfig, createAutopilotAgent } from '@/actions/autopilot';
import { getAiModelCatalogAction } from '@/actions/ai-models';
import { getAiModelLabel, type AiModelCatalogEntry } from '@/lib/ai-models';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

type AgentVisibilityMode = 'public' | 'private';

export default function AutopilotPage() {
  const router = useRouter();
  const { toast } = useToast();
  const user = useCurrentUser();

  const [loading, setLoading] = useState(true);
  const [agents, setAgents] = useState<AutopilotConfig[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [modelCatalog, setModelCatalog] = useState<AiModelCatalogEntry[]>([]);

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isCreatingAgent, setIsCreatingAgent] = useState(false);
  const [newAgentName, setNewAgentName] = useState('');
  const [newAgentVisibility, setNewAgentVisibility] = useState<AgentVisibilityMode>('public');

  const fetchData = useCallback(async () => {
    if (!user?.activeWorkspaceId) return;

    setLoading(true);
    try {
      const [autopilotData, catalogData] = await Promise.all([
        getAutopilotConfig(user.activeWorkspaceId),
        getAiModelCatalogAction(),
      ]);

      if (autopilotData.error) {
        toast({ title: 'Erro ao carregar', description: autopilotData.error, variant: 'destructive' });
        return;
      }

      if (catalogData.error) {
        toast({ title: 'Catálogo indisponível', description: catalogData.error, variant: 'destructive' });
      }

      setAgents(autopilotData.agents || []);
      setWorkspace(autopilotData.workspace || null);
      setModelCatalog(catalogData.models || []);
    } finally {
      setLoading(false);
    }
  }, [toast, user?.activeWorkspaceId]);

  useEffect(() => {
    if (user?.activeWorkspaceId) {
      void fetchData();
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
        toast({ title: 'Agente criado', description: 'Redirecionando para configuração...' });
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
    <div className="flex h-full min-w-0 flex-col gap-6 bg-background px-4 py-4 sm:px-6 lg:px-8">
      <section className="mx-auto flex w-full max-w-[1600px] min-w-0 flex-col gap-6 rounded-[28px] border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 max-w-4xl space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              Dialogy Autopilot
            </div>

            <div className="space-y-2">
              <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                Seus agentes de IA
              </h1>
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
                Configure agentes com identidade própria, base de conhecimento e regras operacionais. A interface agora respeita
                tema, responsividade e o catálogo global de modelos.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button onClick={openCreateDialog} size="lg" className="rounded-full px-6">
                <Plus className="mr-2 h-4 w-4" />
                Novo agente
              </Button>
              <Badge variant="outline" className="rounded-full px-4 py-2 text-xs">
                Workspace: {workspace?.name || 'Sem nome'}
              </Badge>
            </div>
          </div>

          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3 xl:w-[420px]">
            {headerStats.map((stat) => (
              <div key={stat.label} className="rounded-2xl border border-border bg-muted/30 p-4">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {stat.label}
                </div>
                <div className="mt-2 text-2xl font-bold text-foreground">{stat.value}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <main className="mx-auto flex w-full max-w-[1600px] min-w-0 flex-1 flex-col">
        {agents.length > 0 ? (
          <div className="grid min-w-0 gap-5 sm:grid-cols-2 2xl:grid-cols-3">
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
                className="group min-w-0 cursor-pointer overflow-hidden rounded-[26px] border border-border bg-card shadow-sm transition-all duration-200 hover:border-primary/40 hover:shadow-lg"
              >
                <CardContent className="flex h-full flex-col gap-6 p-6">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
                      <BrainCircuit className="h-5 w-5" />
                    </div>

                    <div className="flex flex-wrap justify-end gap-2">
                      {agent.is_primary && (
                        <Badge className="rounded-full border-0 bg-amber-500/15 text-amber-700 dark:text-amber-300">
                          Principal
                        </Badge>
                      )}
                      <Badge variant="outline" className="rounded-full">
                        {agent.is_private ? <Lock className="mr-1 h-3 w-3" /> : <Globe2 className="mr-1 h-3 w-3" />}
                        {agent.is_private ? 'Privado' : 'Público'}
                      </Badge>
                    </div>
                  </div>

                  <div className="min-w-0 space-y-2">
                    <h3 className="truncate text-xl font-semibold text-foreground">{agent.name}</h3>
                    <p className="text-sm text-muted-foreground">
                      {getAiModelLabel(agent.ai_model, modelCatalog)}
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-border bg-muted/30 p-4">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Status</div>
                      <div className="mt-2 flex items-center gap-2 text-sm font-medium text-foreground">
                        <span className={cn('h-2.5 w-2.5 rounded-full', agent.is_active ? 'bg-emerald-500' : 'bg-muted-foreground/40')} />
                        {agent.is_active ? 'Ativo' : 'Pausado'}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-border bg-muted/30 p-4">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Conhecimento</div>
                      <div className="mt-2 text-sm font-medium text-foreground">
                        {(agent.knowledge_base_documents?.length || 0).toLocaleString()} documentos
                      </div>
                    </div>
                  </div>

                  <div className="mt-auto flex items-center justify-between gap-3 border-t border-border/60 pt-4 text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      {agent.is_active ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      ) : (
                        <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span>{agent.is_active ? 'Pronto para operar' : 'Aguardando ativação'}</span>
                    </div>
                    <span className="inline-flex items-center gap-1 font-medium text-primary transition-transform group-hover:translate-x-1">
                      Configurar <ArrowRight className="h-4 w-4" />
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="flex min-h-[420px] items-center justify-center rounded-[28px] border border-dashed border-border bg-card shadow-sm">
            <CardContent className="flex max-w-lg flex-col items-center justify-center gap-4 px-6 py-14 text-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Bot className="h-10 w-10" />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold text-foreground">Nenhum agente criado</h2>
                <p className="text-sm leading-6 text-muted-foreground">
                  Crie o primeiro agente inteligente para centralizar conhecimento, resposta automática e modo sugestão em uma interface estável.
                </p>
              </div>
              <Button onClick={openCreateDialog} size="lg" className="rounded-full px-8">
                <Plus className="mr-2 h-4 w-4" />
                Criar primeiro agente
              </Button>
            </CardContent>
          </Card>
        )}
      </main>

      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="overflow-hidden rounded-[28px] border border-border bg-background p-0 shadow-2xl sm:max-w-[520px]">
          <DialogHeader className="border-b border-border bg-muted/30 px-6 py-5">
            <DialogTitle className="text-xl text-foreground">Novo agente</DialogTitle>
            <DialogDescription>
              Configure o nome inicial e a visibilidade do agente.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 px-6 py-6">
            <div className="space-y-2">
              <Label htmlFor="new-agent-name">Nome do agente</Label>
              <Input
                id="new-agent-name"
                value={newAgentName}
                onChange={(e) => setNewAgentName(e.target.value)}
                placeholder="Ex: Atendimento Comercial"
              />
            </div>

            <div className="space-y-3">
              <Label>Visibilidade</Label>
              <RadioGroup
                value={newAgentVisibility}
                onValueChange={(value) => setNewAgentVisibility(value as AgentVisibilityMode)}
                className="grid gap-3"
              >
                <Label className="flex cursor-pointer items-center gap-4 rounded-2xl border border-border bg-card px-4 py-4 transition-colors hover:bg-muted/30 [&:has(button[data-state=checked])]:border-primary/40 [&:has(button[data-state=checked])]:bg-primary/5">
                  <RadioGroupItem value="public" id="agent-public" />
                  <div className="space-y-1">
                    <div className="font-medium text-foreground">Público</div>
                    <div className="text-xs text-muted-foreground">Disponível para todos do workspace.</div>
                  </div>
                </Label>

                <Label className="flex cursor-pointer items-center gap-4 rounded-2xl border border-border bg-card px-4 py-4 transition-colors hover:bg-muted/30 [&:has(button[data-state=checked])]:border-primary/40 [&:has(button[data-state=checked])]:bg-primary/5">
                  <RadioGroupItem value="private" id="agent-private" />
                  <div className="space-y-1">
                    <div className="font-medium text-foreground">Privado</div>
                    <div className="text-xs text-muted-foreground">Visível apenas para o criador.</div>
                  </div>
                </Label>
              </RadioGroup>
            </div>
          </div>

          <DialogFooter className="border-t border-border bg-muted/20 px-6 py-4">
            <Button variant="ghost" onClick={() => setIsCreateDialogOpen(false)} className="rounded-full">
              Cancelar
            </Button>
            <Button onClick={handleCreateAgent} disabled={isCreatingAgent} className="rounded-full px-6">
              {isCreatingAgent ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Criar agente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
