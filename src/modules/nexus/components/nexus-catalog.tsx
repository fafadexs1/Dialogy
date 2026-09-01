'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, ArrowRight, Bot, CheckCircle2, Copy, Loader2, MoreHorizontal, Plus, RotateCcw, Sparkles, Workflow } from 'lucide-react';

import { createAutopilotAgent, getAutopilotConfig } from '@/actions/autopilot';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useToast } from '@/hooks/use-toast';
import { useCurrentUser } from '@/hooks/use-online-status';
import type { AutopilotConfig, Workspace } from '@/lib/types';
import { useAuth } from '@/providers/auth-provider';

import {
  archiveNexusWorkflow,
  createNexusWorkflow,
  duplicateNexusWorkflow,
  listNexusWorkflows,
  restoreArchivedNexusWorkflow,
} from '../actions/workflows';
import type { NexusWorkflowSummary, NexusWorkflowTemplate } from '../services/standalone-workflows';

type CreationKind = 'workflow' | 'agent';

const TRIGGER_LABELS: Record<string, string> = {
  'trigger.received_message': 'Mensagem',
  'trigger.webhook': 'Webhook',
  'trigger.internal_event': 'Evento interno',
  'trigger.schedule': 'Agendamento',
  'trigger.manual': 'Manual',
};

export function NexusCatalog() {
  const router = useRouter();
  const { toast } = useToast();
  const user = useCurrentUser();
  const { user: authUser, isLoading: isAuthLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [workflows, setWorkflows] = useState<NexusWorkflowSummary[]>([]);
  const [agents, setAgents] = useState<AutopilotConfig[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<CreationKind>('workflow');
  const [template, setTemplate] = useState<NexusWorkflowTemplate>('blank');
  const [busyWorkflowId, setBusyWorkflowId] = useState<string | null>(null);
  const [archiveCandidate, setArchiveCandidate] = useState<NexusWorkflowSummary | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async () => {
    if (!user?.activeWorkspaceId) return;
    setLoading(true);
    try {
      const [workflowData, agentData] = await Promise.all([
        listNexusWorkflows(user.activeWorkspaceId, { includeArchived: true }),
        getAutopilotConfig(user.activeWorkspaceId),
      ]);
      if (workflowData.error) toast({ title: 'Erro ao carregar fluxos', description: workflowData.error, variant: 'destructive' });
      if (agentData.error) toast({ title: 'Erro ao carregar agentes', description: agentData.error, variant: 'destructive' });
      setWorkflows(workflowData.workflows);
      setAgents(agentData.agents || []);
      setWorkspace(agentData.workspace || null);
    } finally {
      setLoading(false);
    }
  }, [toast, user?.activeWorkspaceId]);

  useEffect(() => {
    if (isAuthLoading) return;
    if (!authUser) {
      setLoading(false);
      return;
    }
    if (user?.activeWorkspaceId) {
      void load();
      return;
    }
    const timeout = window.setTimeout(() => setLoading(false), 5_000);
    return () => window.clearTimeout(timeout);
  }, [authUser, isAuthLoading, load, user?.activeWorkspaceId]);

  const activeWorkflows = useMemo(() => workflows.filter((flow) => flow.status !== 'archived'), [workflows]);
  const archivedWorkflows = useMemo(() => workflows.filter((flow) => flow.status === 'archived'), [workflows]);

  const stats = useMemo(() => [
    { label: 'Fluxos', value: activeWorkflows.length },
    { label: 'Publicados', value: activeWorkflows.filter((flow) => flow.status === 'published').length },
    { label: 'Agentes', value: agents.length },
  ], [activeWorkflows, agents.length]);

  const openCreate = () => {
    setName(`Fluxo ${activeWorkflows.length + 1}`);
    setKind('workflow');
    setTemplate('blank');
    setCreateOpen(true);
  };

  const createItem = async () => {
    if (!user?.activeWorkspaceId) return;
    setCreating(true);
    try {
      if (kind === 'workflow') {
        const result = await createNexusWorkflow({ workspaceId: user.activeWorkspaceId, name, template });
        if (!result.success || !result.id) {
          toast({ title: 'Erro ao criar o fluxo', description: result.error, variant: 'destructive' });
          return;
        }
        setCreateOpen(false);
        router.push(`/nexus/flows/${result.id}`);
        return;
      }
      const result = await createAutopilotAgent(user.activeWorkspaceId, name.trim() || `Agente ${agents.length + 1}`, false);
      if (!result.success || !result.id) {
        toast({ title: 'Erro ao criar o agente', description: result.error, variant: 'destructive' });
        return;
      }
      setCreateOpen(false);
      router.push(`/autopilot/${result.id}`);
    } finally {
      setCreating(false);
    }
  };

  const duplicateFlow = async (flow: NexusWorkflowSummary) => {
    if (!user?.activeWorkspaceId) return;
    setBusyWorkflowId(flow.id);
    const result = await duplicateNexusWorkflow({
      workspaceId: user.activeWorkspaceId,
      workflowId: flow.id,
    });
    setBusyWorkflowId(null);
    if (!result.success || !result.id) {
      toast({ title: 'Não foi possível duplicar', description: result.error, variant: 'destructive' });
      return;
    }
    toast({ title: 'Fluxo duplicado', description: 'A cópia foi criada como rascunho independente.' });
    await load();
  };

  const archiveFlow = async () => {
    if (!archiveCandidate || !user?.activeWorkspaceId) return;
    setBusyWorkflowId(archiveCandidate.id);
    const result = await archiveNexusWorkflow({
      workspaceId: user.activeWorkspaceId,
      workflowId: archiveCandidate.id,
    });
    setBusyWorkflowId(null);
    if (!result.success) {
      toast({ title: 'Não foi possível arquivar', description: result.error, variant: 'destructive' });
      return;
    }
    toast({ title: 'Fluxo arquivado', description: 'Ele deixou o catálogo ativo sem apagar versões ou execuções.' });
    setArchiveCandidate(null);
    await load();
  };

  const restoreFlow = async (flow: NexusWorkflowSummary) => {
    if (!user?.activeWorkspaceId) return;
    setBusyWorkflowId(flow.id);
    const result = await restoreArchivedNexusWorkflow({
      workspaceId: user.activeWorkspaceId,
      workflowId: flow.id,
    });
    setBusyWorkflowId(null);
    if (!result.success) {
      toast({ title: 'Não foi possível restaurar', description: result.error, variant: 'destructive' });
      return;
    }
    toast({ title: 'Fluxo restaurado', description: flow.publishedRevision > 0 ? 'A versão publicada voltou a ficar ativa.' : 'O fluxo voltou como rascunho.' });
    await load();
  };

  if (loading && workflows.length === 0 && agents.length === 0) {
    return <div className="flex h-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (!isAuthLoading && !authUser) {
    return <div className="flex h-full items-center justify-center p-6"><div className="max-w-md rounded-3xl border bg-card p-8 text-center"><h1 className="text-xl font-semibold">Sua sessão expirou</h1><p className="mt-2 text-sm text-muted-foreground">Entre novamente para abrir os fluxos do Nexus.</p><Button className="mt-5" onClick={() => router.push('/login')}>Ir para o login</Button></div></div>;
  }

  if (!loading && authUser && !user?.activeWorkspaceId) {
    return <div className="flex h-full items-center justify-center p-6"><div className="max-w-md rounded-3xl border bg-card p-8 text-center"><h1 className="text-xl font-semibold">Workspace indisponível</h1><p className="mt-2 text-sm text-muted-foreground">Não foi possível carregar o workspace ativo desta sessão. Atualize a página ou selecione outro workspace.</p><Button className="mt-5" variant="outline" onClick={() => window.location.reload()}>Atualizar página</Button></div></div>;
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-6 overflow-x-hidden overflow-y-auto overscroll-y-contain bg-background px-4 py-4 [scrollbar-gutter:stable] sm:px-6 lg:px-8">
      <section className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 rounded-[28px] border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-4xl space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-primary"><Sparkles className="h-3.5 w-3.5" />Nexus nativo</div>
            <div className="space-y-2"><h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Fluxos, automações e agentes</h1><p className="max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">Monte processos determinísticos, híbridos ou com IA. Fluxos comuns existem por conta própria; agentes são apenas um dos recursos disponíveis.</p></div>
            <div className="flex flex-wrap gap-3"><Button onClick={openCreate} size="lg" className="rounded-full px-6"><Plus className="mr-2 h-4 w-4" />Novo no Nexus</Button><Badge variant="outline" className="rounded-full px-4 py-2 text-xs">Workspace: {workspace?.name || 'Sem nome'}</Badge></div>
          </div>
          <div className="grid grid-cols-3 gap-3 xl:w-[420px]">{stats.map((stat) => <div key={stat.label} className="rounded-2xl border border-border bg-muted/30 p-4"><div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{stat.label}</div><div className="mt-2 text-2xl font-bold">{String(stat.value).padStart(2, '0')}</div></div>)}</div>
        </div>
      </section>

      <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-8">
        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-xl font-semibold">Fluxos de automação</h2><p className="text-sm text-muted-foreground">Canvas independente para regras, integrações e operações. IA é opcional.</p></div>{archivedWorkflows.length > 0 ? <Button type="button" variant="outline" size="sm" onClick={() => setShowArchived((value) => !value)}><Archive className="mr-2 h-4 w-4" />{showArchived ? 'Ocultar arquivados' : `Arquivados (${archivedWorkflows.length})`}</Button> : null}</div>
          {activeWorkflows.length > 0 ? <div className="grid gap-5 sm:grid-cols-2 2xl:grid-cols-3">{activeWorkflows.map((flow) => (
            <Card key={flow.id} role="button" tabIndex={0} onClick={() => router.push(`/nexus/flows/${flow.id}`)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') router.push(`/nexus/flows/${flow.id}`); }} className="group cursor-pointer rounded-[26px] transition hover:border-primary/40 hover:shadow-lg">
              <CardContent className="flex h-full flex-col gap-5 p-6">
                <div className="flex items-start justify-between gap-3"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/15 text-cyan-600"><Workflow className="h-5 w-5" /></div><div className="flex items-center gap-2"><Badge variant={flow.status === 'published' ? 'default' : 'outline'} className="rounded-full">{flow.status === 'published' ? `Publicado · v${flow.publishedRevision}` : 'Rascunho'}</Badge><DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" disabled={busyWorkflowId === flow.id} onClick={(event) => event.stopPropagation()} aria-label={`Ações de ${flow.name}`} className="h-8 w-8 rounded-full">{busyWorkflowId === flow.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}</Button></DropdownMenuTrigger><DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}><DropdownMenuItem onSelect={() => void duplicateFlow(flow)}><Copy className="mr-2 h-4 w-4" />Duplicar fluxo</DropdownMenuItem><DropdownMenuItem onSelect={() => setArchiveCandidate(flow)} className="text-amber-600 focus:text-amber-600"><Archive className="mr-2 h-4 w-4" />Arquivar</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div></div>
                <div><h3 className="truncate text-xl font-semibold">{flow.name}</h3><p className="mt-1 text-sm text-muted-foreground">{flow.nodeCount} blocos · {flow.triggerTypes.map((type) => TRIGGER_LABELS[type] || type).join(', ')}</p></div>
                <div className="mt-auto flex items-center justify-between border-t border-border/60 pt-4 text-sm"><span className="flex items-center gap-2 text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-emerald-500" />Workflow Runtime V2</span><span className="inline-flex items-center gap-1 font-medium text-primary transition group-hover:translate-x-1">Abrir canvas <ArrowRight className="h-4 w-4" /></span></div>
              </CardContent>
            </Card>
          ))}</div> : <button type="button" onClick={openCreate} className="flex min-h-48 w-full items-center justify-center rounded-[26px] border border-dashed border-border bg-card p-8 text-center transition hover:border-primary/40"><span><Workflow className="mx-auto h-9 w-9 text-muted-foreground" /><span className="mt-3 block font-semibold">Criar o primeiro fluxo independente</span><span className="mt-1 block text-sm text-muted-foreground">Comece em branco, por webhook, agendamento ou mensagem.</span></span></button>}
          {showArchived && archivedWorkflows.length > 0 ? <div className="space-y-3 rounded-[26px] border border-dashed border-border bg-muted/15 p-4 sm:p-5"><div><h3 className="font-semibold">Fluxos arquivados</h3><p className="text-xs text-muted-foreground">Versões e execuções continuam preservadas. Restaure para editar ou voltar a executar.</p></div><div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">{archivedWorkflows.map((flow) => <Card key={flow.id} className="rounded-2xl opacity-85"><CardContent className="flex items-center gap-3 p-4"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"><Archive className="h-4 w-4" /></div><div className="min-w-0 flex-1"><p className="truncate font-medium">{flow.name}</p><p className="text-xs text-muted-foreground">{flow.nodeCount} blocos · arquivado</p></div><Button type="button" variant="outline" size="sm" disabled={busyWorkflowId === flow.id} onClick={() => void restoreFlow(flow)}>{busyWorkflowId === flow.id ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-2 h-3.5 w-3.5" />}Restaurar</Button></CardContent></Card>)}</div></div> : null}
        </section>

        {agents.length > 0 && <section className="space-y-4"><div><h2 className="text-xl font-semibold">Agentes inteligentes</h2><p className="text-sm text-muted-foreground">Automações orientadas a agentes, com conhecimento, ferramentas e guardrails.</p></div><div className="grid gap-5 sm:grid-cols-2 2xl:grid-cols-3">{agents.map((agent) => <Card key={agent.id} role="button" tabIndex={0} onClick={() => router.push(`/autopilot/${agent.id}`)} className="group cursor-pointer rounded-[26px] transition hover:border-primary/40 hover:shadow-lg"><CardContent className="flex items-center gap-4 p-6"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-500/15 text-violet-600"><Bot className="h-5 w-5" /></div><div className="min-w-0 flex-1"><h3 className="truncate font-semibold">{agent.name}</h3><p className="text-sm text-muted-foreground">{agent.is_active ? 'Publicado' : 'Em preparação'} · Agente Dialogy</p></div><ArrowRight className="h-4 w-4 text-primary" /></CardContent></Card>)}</div></section>}
      </main>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent className="rounded-[28px] sm:max-w-[620px]"><DialogHeader><DialogTitle>Novo no Nexus</DialogTitle><DialogDescription>Escolha se você quer montar um processo comum ou uma automação orientada a agente.</DialogDescription></DialogHeader><div className="space-y-5 py-2">
        <RadioGroup value={kind} onValueChange={(value) => setKind(value as CreationKind)} className="grid gap-3 sm:grid-cols-2"><Label className="flex cursor-pointer gap-3 rounded-2xl border p-4 [&:has(button[data-state=checked])]:border-primary [&:has(button[data-state=checked])]:bg-primary/5"><RadioGroupItem value="workflow" /><span><span className="block font-medium">Fluxo de automação</span><span className="mt-1 block text-xs text-muted-foreground">Regras e operações; IA opcional.</span></span></Label><Label className="flex cursor-pointer gap-3 rounded-2xl border p-4 [&:has(button[data-state=checked])]:border-primary [&:has(button[data-state=checked])]:bg-primary/5"><RadioGroupItem value="agent" /><span><span className="block font-medium">Agente inteligente</span><span className="mt-1 block text-xs text-muted-foreground">Atendimento orientado a IA.</span></span></Label></RadioGroup>
        <div className="space-y-2"><Label htmlFor="new-nexus-name">Nome</Label><Input id="new-nexus-name" value={name} onChange={(event) => setName(event.target.value)} /></div>
        {kind === 'workflow' && <div className="space-y-2"><Label htmlFor="new-nexus-template">Ponto de partida</Label><select id="new-nexus-template" value={template} onChange={(event) => setTemplate(event.target.value as NexusWorkflowTemplate)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="blank">Em branco · execução manual</option><option value="webhook">Webhook</option><option value="schedule">Agendamento</option><option value="message">Mensagem recebida</option></select></div>}
      </div><DialogFooter><Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancelar</Button><Button onClick={createItem} disabled={creating}>{creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}{kind === 'workflow' ? 'Criar fluxo' : 'Criar agente'}</Button></DialogFooter></DialogContent></Dialog>

      <AlertDialog open={Boolean(archiveCandidate)} onOpenChange={(open) => { if (!open) setArchiveCandidate(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Arquivar “{archiveCandidate?.name}”?</AlertDialogTitle><AlertDialogDescription>O fluxo sairá do catálogo ativo. Suas versões, configuração publicada e execuções serão preservadas no banco.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel disabled={Boolean(busyWorkflowId)}>Cancelar</AlertDialogCancel><AlertDialogAction disabled={Boolean(busyWorkflowId)} onClick={(event) => { event.preventDefault(); void archiveFlow(); }} className="bg-amber-600 text-white hover:bg-amber-500">{busyWorkflowId && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Arquivar fluxo</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
