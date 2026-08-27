'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity, Ban, Bot, CheckCircle2, Clock3, Eye, Loader2, RefreshCw, Wrench, XCircle } from 'lucide-react';

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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { WorkflowExecutionDebugger } from '@/components/workflow/workflow-execution-debugger';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

import { cancelNexusWorkflowExecution, listNexusWorkflowExecutions } from '../actions/workflows';
import type { NexusWorkflowExecutionSummary } from '../services/standalone-workflows';

const ACTIVE_STATUS = new Set(['queued', 'running', 'waiting']);

const STATUS_META: Record<NexusWorkflowExecutionSummary['status'], { label: string; className: string }> = {
  queued: { label: 'Na fila', className: 'border-slate-400/25 bg-slate-400/10 text-slate-200' },
  running: { label: 'Executando', className: 'border-cyan-400/25 bg-cyan-400/10 text-cyan-200' },
  waiting: { label: 'Aguardando', className: 'border-amber-400/25 bg-amber-400/10 text-amber-200' },
  completed: { label: 'Concluída', className: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200' },
  failed: { label: 'Falhou', className: 'border-red-400/25 bg-red-400/10 text-red-200' },
  cancelled: { label: 'Cancelada', className: 'border-slate-500/25 bg-slate-500/10 text-slate-300' },
};

function timestamp(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value));
}

function duration(execution: NexusWorkflowExecutionSummary) {
  const end = new Date(execution.finishedAt || execution.updatedAt).getTime();
  const elapsed = Math.max(0, end - new Date(execution.startedAt).getTime());
  if (elapsed < 1_000) return `${elapsed} ms`;
  if (elapsed < 60_000) return `${(elapsed / 1_000).toFixed(1)} s`;
  return `${Math.floor(elapsed / 60_000)} min ${Math.floor((elapsed % 60_000) / 1_000)} s`;
}

export function NexusWorkflowExecutionsDialog({
  workspaceId,
  workflowId,
  open,
  onOpenChange,
}: {
  workspaceId: string;
  workflowId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [executions, setExecutions] = useState<NexusWorkflowExecutionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null);
  const [cancelCandidate, setCancelCandidate] = useState<NexusWorkflowExecutionSummary | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await listNexusWorkflowExecutions({ workspaceId, workflowId });
    setExecutions(result.executions);
    if (result.error) toast({ title: 'Execuções indisponíveis', description: result.error, variant: 'destructive' });
    setLoading(false);
  }, [toast, workflowId, workspaceId]);

  useEffect(() => {
    if (open) void load();
    else {
      setSelectedExecutionId(null);
      setCancelCandidate(null);
    }
  }, [load, open]);

  const cancel = async (execution: NexusWorkflowExecutionSummary) => {
    setCancellingId(execution.id);
    const result = await cancelNexusWorkflowExecution({ workspaceId, workflowId, executionId: execution.id });
    setCancellingId(null);
    if (!result.success) {
      toast({ title: 'Não foi possível cancelar', description: result.error, variant: 'destructive' });
      return;
    }
    toast({ title: 'Execução cancelada' });
    setCancelCandidate(null);
    await load();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className={cn(
          'dark flex max-h-[90vh] max-w-none flex-col overflow-hidden border-slate-700 bg-[#0b121a] p-0 text-slate-100',
          selectedExecutionId ? 'w-[min(1180px,96vw)]' : 'w-[min(900px,96vw)]',
        )}>
          {selectedExecutionId ? (
            <div className="h-[min(820px,88vh)] min-h-0">
              <DialogHeader className="sr-only">
                <DialogTitle>Detalhes da execução</DialogTitle>
                <DialogDescription>Eventos, entradas, saídas e estado persistido da execução.</DialogDescription>
              </DialogHeader>
              <WorkflowExecutionDebugger
                executionId={selectedExecutionId}
                embedded
                onBack={() => setSelectedExecutionId(null)}
              />
            </div>
          ) : (
            <>
              <DialogHeader className="border-b border-white/[0.07] bg-[#101b26] px-6 py-5">
                <div className="flex items-start justify-between gap-4 pr-8">
                  <div><DialogTitle className="flex items-center gap-2"><Activity className="h-5 w-5 text-cyan-300" />Execuções do fluxo</DialogTitle><DialogDescription className="mt-1 text-slate-400">Produção e testes persistidos pelo Workflow Runtime V2. Abra uma execução para inspecionar cada evento.</DialogDescription></div>
                  <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} className="border-slate-600 bg-white/[0.03] text-slate-200"><RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />Atualizar</Button>
                </div>
              </DialogHeader>
              <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
                {loading && executions.length === 0 ? (
                  <div className="flex min-h-40 items-center justify-center text-sm text-slate-400"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Carregando execuções</div>
                ) : executions.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-400">Este fluxo ainda não possui execuções persistidas.</div>
                ) : (
                  <div className="space-y-3">
                    {executions.map((execution) => {
                      const meta = STATUS_META[execution.status];
                      return (
                        <article key={execution.id} className="rounded-2xl border border-slate-700/70 bg-[#111b24] p-4">
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2"><Badge className={meta.className}>{execution.status === 'completed' ? <CheckCircle2 className="mr-1 h-3 w-3" /> : execution.status === 'failed' ? <XCircle className="mr-1 h-3 w-3" /> : null}{meta.label}</Badge><Badge variant="outline" className="border-slate-600 text-[10px] text-slate-300">{execution.workflowVersion}</Badge><span className="truncate font-mono text-[10px] text-slate-500">{execution.id}</span></div>
                              <div className="mt-3 grid gap-2 text-[11px] text-slate-400 sm:grid-cols-2 lg:grid-cols-4"><span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" />{timestamp(execution.startedAt)}</span><span>Duração: {duration(execution)}</span><span>{execution.totalSteps} etapas</span><span>{execution.totalTokens == null ? 'Sem uso de tokens' : `${execution.totalTokens} tokens`}</span></div>
                              <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-slate-500"><span className="inline-flex items-center gap-1"><Bot className="h-3 w-3" />{execution.totalModelCalls} chamadas de modelo</span><span className="inline-flex items-center gap-1"><Wrench className="h-3 w-3" />{execution.totalToolCalls} ferramentas</span>{execution.conversationId ? <span>Conversa: {execution.conversationId}</span> : null}</div>
                              {execution.failureMessage ? <p className="mt-3 rounded-lg border border-red-400/15 bg-red-400/[0.06] px-3 py-2 text-xs text-red-200">{execution.failureMessage}</p> : null}
                            </div>
                            <div className="flex shrink-0 flex-wrap items-center gap-2">
                              <Button variant="outline" size="sm" onClick={() => setSelectedExecutionId(execution.id)} className="border-cyan-400/25 bg-cyan-400/[0.06] text-cyan-100 hover:bg-cyan-400/10"><Eye className="mr-2 h-3.5 w-3.5" />Inspecionar</Button>
                              {ACTIVE_STATUS.has(execution.status) ? <Button variant="outline" size="sm" disabled={cancellingId === execution.id} onClick={() => setCancelCandidate(execution)} className="border-red-400/30 bg-red-400/[0.06] text-red-200 hover:bg-red-400/10"><Ban className="mr-2 h-3.5 w-3.5" />{cancellingId === execution.id ? 'Cancelando…' : 'Cancelar'}</Button> : null}
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(cancelCandidate)} onOpenChange={(nextOpen) => { if (!nextOpen) setCancelCandidate(null); }}>
        <AlertDialogContent className="dark border-slate-700 bg-[#111820] text-slate-100">
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar esta execução?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">O runtime interromperá os próximos blocos. Os eventos já gravados continuarão disponíveis para inspeção.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(cancellingId)}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={Boolean(cancellingId) || !cancelCandidate}
              onClick={(event) => {
                event.preventDefault();
                if (cancelCandidate) void cancel(cancelCandidate);
              }}
              className="bg-red-600 text-white hover:bg-red-500"
            >
              {cancellingId ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Ban className="mr-2 h-4 w-4" />}
              Cancelar execução
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
