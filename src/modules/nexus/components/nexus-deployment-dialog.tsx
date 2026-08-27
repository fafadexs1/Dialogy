'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bot, Copy, KeyRound, Loader2, Play, RefreshCw, Rocket } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import type { WorkflowDefinition } from '@/services/workflow-runtime/types';

import {
  getNexusDeploymentAction,
  rotateNexusWebhookTokenAction,
  runPublishedNexusWorkflowAction,
} from '../actions/runtime';
import type { NexusDialogyResourceOption } from '../services/dialogy-resources';

type Deployment = NonNullable<Awaited<ReturnType<typeof getNexusDeploymentAction>>['deployment']>;

export function NexusDeploymentDialog({
  workspaceId,
  workflowId,
  definition,
  systemAgents,
  open,
  onOpenChange,
  onSaveSenderSystemAgent,
}: {
  workspaceId: string;
  workflowId: string;
  definition: WorkflowDefinition;
  systemAgents: NexusDialogyResourceOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaveSenderSystemAgent: (senderSystemAgentId: string) => Promise<boolean>;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [savingSender, setSavingSender] = useState(false);
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [senderSystemAgentId, setSenderSystemAgentId] = useState('');
  const [token, setToken] = useState('');
  const [manualPayload, setManualPayload] = useState('{}');
  const [lastRun, setLastRun] = useState<Record<string, unknown> | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const result = await getNexusDeploymentAction({ workspaceId, workflowId });
      if (!result.success || !result.deployment) {
        toast({ title: 'Implantação indisponível', description: result.error, variant: 'destructive' });
        return;
      }
      setDeployment(result.deployment);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setSenderSystemAgentId(String(definition.metadata?.senderSystemAgentId || ''));
      void load();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspaceId, workflowId, definition.metadata?.senderSystemAgentId]);

  const saveSender = async () => {
    if (!senderSystemAgentId) return;
    setSavingSender(true);
    try {
      const saved = await onSaveSenderSystemAgent(senderSystemAgentId);
      if (saved) {
        toast({
          title: 'Agente remetente salvo',
          description: 'Publique uma nova versão para aplicar esta identidade às próximas execuções.',
        });
      }
    } finally {
      setSavingSender(false);
    }
  };

  const webhookUrl = useMemo(() => {
    if (!deployment?.webhookPath) return '';
    if (typeof window === 'undefined') return deployment.webhookPath;
    return `${window.location.origin}${deployment.webhookPath}`;
  }, [deployment?.webhookPath]);

  const copy = async (value: string, label: string) => {
    await navigator.clipboard.writeText(value);
    toast({ title: `${label} copiado` });
  };

  const rotate = async () => {
    setRotating(true);
    try {
      const result = await rotateNexusWebhookTokenAction({ workspaceId, workflowId });
      if (!result.success || !result.token) {
        toast({ title: 'Falha ao gerar token', description: result.error, variant: 'destructive' });
        return;
      }
      setToken(result.token);
      setDeployment((current) => current ? { ...current, webhookConfigured: true } : current);
      toast({ title: 'Novo token gerado', description: 'Copie agora. Por segurança, ele não será exibido novamente.' });
    } finally {
      setRotating(false);
    }
  };

  const run = async () => {
    let payload: Record<string, unknown>;
    try {
      const parsed = JSON.parse(manualPayload) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      payload = parsed as Record<string, unknown>;
    } catch {
      toast({ title: 'Payload inválido', description: 'Informe um objeto JSON.', variant: 'destructive' });
      return;
    }
    setRunning(true);
    try {
      const result = await runPublishedNexusWorkflowAction({ workspaceId, workflowId, payload });
      setLastRun(result as Record<string, unknown>);
      toast({
        title: result.success ? 'Execução concluída' : 'Falha na execução',
        description: result.success ? `${result.executionId} · ${result.status}` : result.error,
        variant: result.success ? 'default' : 'destructive',
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Rocket className="h-5 w-5" />Implantação do fluxo</DialogTitle>
          <DialogDescription>Execute a versão publicada e conecte o gatilho diretamente ao runtime da Dialogy.</DialogDescription>
        </DialogHeader>
        {loading || !deployment ? <div className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />Carregando implantação…</div> : <div className="space-y-5 py-2">
          <section className="space-y-3 rounded-2xl border border-violet-500/20 bg-violet-500/[0.04] p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-600 dark:text-violet-300"><Bot className="h-4 w-4" /></div>
              <div><p className="text-sm font-semibold">Agente do fluxo</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">As mensagens serão enviadas por este agente. Se ele for um Atendente Inteligente com IA ativa, sua IA será executada quando o fluxo chegar a um bloco Agente de IA.</p></div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="nexus-sender-system-agent">Agente do sistema</Label>
              <Select value={senderSystemAgentId || undefined} onValueChange={setSenderSystemAgentId} disabled={systemAgents.length === 0 || savingSender}>
                <SelectTrigger id="nexus-sender-system-agent" className="h-11 rounded-xl bg-background"><SelectValue placeholder={systemAgents.length === 0 ? 'Nenhum agente ativo no workspace' : 'Selecione quem enviará as mensagens'} /></SelectTrigger>
                <SelectContent>{systemAgents.map((agent) => <SelectItem key={agent.id} value={agent.id}><span className="font-medium">{agent.label}</span>{agent.description ? <span className="ml-2 text-xs text-muted-foreground">· {agent.description}</span> : null}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {!senderSystemAgentId ? <p className="text-xs font-medium text-amber-600 dark:text-amber-300">Selecione um agente antes de publicar um fluxo que envia mensagens.</p> : null}
            <div className="flex justify-end"><Button type="button" size="sm" onClick={() => void saveSender()} disabled={!senderSystemAgentId || senderSystemAgentId === String(definition.metadata?.senderSystemAgentId || '') || savingSender}>{savingSender ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Bot className="mr-2 h-4 w-4" />}Salvar remetente</Button></div>
          </section>

          <div className="grid gap-3 rounded-2xl border bg-muted/20 p-4 sm:grid-cols-3">
            <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Estado</p><p className="mt-1 text-sm font-semibold">{deployment.status}</p></div>
            <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Gatilho</p><p className="mt-1 font-mono text-xs">{deployment.triggerType || '—'}</p></div>
            <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Versão</p><p className="mt-1 text-sm font-semibold">v{deployment.publishedRevision}</p></div>
          </div>

          {deployment.triggerType === 'trigger.webhook' ? <section className="space-y-3 rounded-2xl border p-4">
            <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold">Webhook autenticado</p><p className="mt-1 text-xs text-muted-foreground">Envie o token como Bearer ou no header X-Nexus-Key.</p></div><Button variant="outline" size="sm" onClick={() => void rotate()} disabled={rotating}>{rotating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}{deployment.webhookConfigured ? 'Girar token' : 'Gerar token'}</Button></div>
            <div className="flex gap-2"><code className="min-w-0 flex-1 truncate rounded-lg bg-muted px-3 py-2 text-xs">{webhookUrl}</code><Button size="icon" variant="ghost" onClick={() => void copy(webhookUrl, 'URL')}><Copy className="h-4 w-4" /></Button></div>
            {token ? <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3"><p className="text-xs font-medium text-amber-700 dark:text-amber-200">Este token será mostrado somente agora.</p><div className="mt-2 flex gap-2"><code className="min-w-0 flex-1 break-all rounded-lg bg-background px-3 py-2 text-xs">{token}</code><Button size="icon" variant="ghost" onClick={() => void copy(token, 'Token')}><Copy className="h-4 w-4" /></Button></div></div> : null}
          </section> : null}

          {deployment.triggerType === 'trigger.schedule' ? <section className="rounded-2xl border p-4"><p className="text-sm font-semibold">Agendamento publicado</p><div className="mt-3 grid grid-cols-2 gap-3"><div><p className="text-[10px] uppercase text-muted-foreground">Cron</p><code className="text-xs">{String(deployment.triggerConfig.cron || '—')}</code></div><div><p className="text-[10px] uppercase text-muted-foreground">Fuso</p><code className="text-xs">{String(deployment.triggerConfig.timezone || 'UTC')}</code></div></div></section> : null}

          {deployment.triggerType === 'trigger.manual' ? <section className="space-y-3 rounded-2xl border p-4"><div><p className="text-sm font-semibold">Executar versão publicada</p><p className="mt-1 text-xs text-muted-foreground">O payload entra no fluxo como input.</p></div><div className="space-y-2"><Label htmlFor="nexus-manual-payload">Payload JSON</Label><Textarea id="nexus-manual-payload" value={manualPayload} onChange={(event) => setManualPayload(event.target.value)} rows={5} className="font-mono text-xs" /></div><Button onClick={() => void run()} disabled={running || deployment.status !== 'published'}>{running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}Executar agora</Button>{lastRun ? <pre className="max-h-44 overflow-auto rounded-xl bg-slate-950 p-3 text-[10px] text-slate-200">{JSON.stringify(lastRun, null, 2)}</pre> : null}</section> : null}

          {deployment.triggerType === 'trigger.received_message' ? <section className="rounded-2xl border p-4"><p className="text-sm font-semibold">Mensagem recebida</p><p className="mt-1 text-xs text-muted-foreground">Este fluxo será acionado pelo roteador de mensagens do workspace e poderá aguardar respostas no mesmo atendimento.</p></section> : null}
        </div>}
        <DialogFooter><Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Atualizar</Button><Button onClick={() => onOpenChange(false)}>Fechar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
