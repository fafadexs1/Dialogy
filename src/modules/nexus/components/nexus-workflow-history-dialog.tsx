'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock3, History, Loader2, RotateCcw } from 'lucide-react';

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
import { useToast } from '@/hooks/use-toast';
import type { WorkflowDefinition } from '@/services/workflow-runtime/types';

import { listNexusWorkflowVersions, restoreNexusWorkflowVersion } from '../actions/workflows';
import type { NexusWorkflowVersionSource, NexusWorkflowVersionSummary } from '../services/standalone-workflows';

const SOURCE_LABEL: Record<NexusWorkflowVersionSource, string> = {
  create: 'Criação',
  save: 'Rascunho salvo',
  publish: 'Publicação',
  restore: 'Restauração',
  duplicate: 'Duplicação',
  import: 'Importação',
};

function timestamp(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function NexusWorkflowHistoryDialog({
  workspaceId,
  workflowId,
  open,
  onOpenChange,
  onRestore,
}: {
  workspaceId: string;
  workflowId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRestore: (definition: WorkflowDefinition) => void;
}) {
  const { toast } = useToast();
  const [versions, setVersions] = useState<NexusWorkflowVersionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [candidate, setCandidate] = useState<NexusWorkflowVersionSummary | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await listNexusWorkflowVersions({ workspaceId, workflowId });
    setVersions(result.versions);
    if (result.error) toast({ title: 'Histórico indisponível', description: result.error, variant: 'destructive' });
    setLoading(false);
  }, [toast, workflowId, workspaceId]);

  useEffect(() => {
    if (open) void load();
  }, [load, open]);

  const restore = async () => {
    if (!candidate) return;
    setRestoring(true);
    const result = await restoreNexusWorkflowVersion({
      workspaceId,
      workflowId,
      versionId: candidate.id,
    });
    setRestoring(false);
    if (!result.success || !result.definition) {
      toast({ title: 'Não foi possível restaurar', description: result.error, variant: 'destructive' });
      return;
    }
    onRestore(result.definition);
    setCandidate(null);
    onOpenChange(false);
    toast({ title: `Revisão ${candidate.revision} restaurada`, description: 'O estado anterior virou um novo rascunho; nenhuma versão foi apagada.' });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="dark flex max-h-[88vh] w-[min(760px,95vw)] max-w-none flex-col overflow-hidden border-slate-700 bg-[#0b121a] p-0 text-slate-100">
          <DialogHeader className="border-b border-white/[0.07] bg-[#101b26] px-6 py-5">
            <DialogTitle className="flex items-center gap-2"><History className="h-5 w-5 text-cyan-300" />Histórico do fluxo</DialogTitle>
            <DialogDescription className="text-slate-400">Cada criação, salvamento, importação, publicação ou restauração preserva uma revisão imutável.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
            {loading ? (
              <div className="flex min-h-40 items-center justify-center text-sm text-slate-400"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Carregando revisões</div>
            ) : versions.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-400">Nenhuma revisão preservada ainda.</div>
            ) : (
              <div className="space-y-3">
                {versions.map((version, index) => (
                  <article key={version.id} className="flex flex-col gap-4 rounded-2xl border border-slate-700/70 bg-[#111b24] p-4 sm:flex-row sm:items-center">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-300/20 bg-cyan-300/10 text-sm font-bold text-cyan-200">{version.revision}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-slate-100">Revisão {version.revision}</span>
                        <Badge variant="outline" className="border-slate-600 text-[10px] text-slate-300">{SOURCE_LABEL[version.source]}</Badge>
                        {version.publishedRevision ? <Badge className="border-emerald-400/20 bg-emerald-400/10 text-[10px] text-emerald-200"><CheckCircle2 className="mr-1 h-3 w-3" />Produção v{version.publishedRevision}</Badge> : null}
                        {index === 0 ? <Badge className="border-cyan-400/20 bg-cyan-400/10 text-[10px] text-cyan-200">Atual</Badge> : null}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-slate-400">{version.description || 'Sem descrição.'}</p>
                      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500"><span>{version.nodeCount} blocos</span><span>{version.connectionCount} conexões</span><span className="inline-flex items-center gap-1"><Clock3 className="h-3 w-3" />{timestamp(version.createdAt)}</span></p>
                    </div>
                    <Button variant="outline" size="sm" disabled={index === 0} onClick={() => setCandidate(version)} className="shrink-0 border-slate-600 bg-white/[0.03] text-slate-200"><RotateCcw className="mr-2 h-3.5 w-3.5" />Restaurar</Button>
                  </article>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(candidate)} onOpenChange={(nextOpen) => { if (!nextOpen) setCandidate(null); }}>
        <AlertDialogContent className="dark border-slate-700 bg-[#111820] text-slate-100">
          <AlertDialogHeader>
            <AlertDialogTitle>Restaurar a revisão {candidate?.revision}?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">O rascunho atual será preservado no histórico e esta revisão passará a ser o novo rascunho. A versão publicada continuará ativa até uma nova publicação.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoring}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={restoring} onClick={(event) => { event.preventDefault(); void restore(); }} className="bg-cyan-300 text-slate-950 hover:bg-cyan-200">{restoring && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Restaurar revisão</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
