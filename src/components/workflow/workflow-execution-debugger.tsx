'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Bot, CheckCircle2, Clock3, Database, Loader2, RefreshCw, Send, Wrench, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export type DebugEvent = {
  id: string;
  sequence: number;
  type: string;
  nodeId?: string;
  toolName?: string;
  safeSummary?: string;
  payload?: Record<string, unknown>;
  createdAt: string;
};

export type DebugExecution = {
  id: string;
  workflowId: string;
  workflowVersion: string;
  status: string;
  currentNodeId?: string | null;
  previousNodeId?: string | null;
  variables?: Record<string, unknown>;
  context?: Record<string, unknown>;
  nodeResults?: Record<string, Record<string, unknown>>;
  executionPath?: Array<Record<string, unknown> & { nodeId?: string }>;
  counters?: Record<string, number>;
  waitingReason?: string | null;
  failure?: Record<string, unknown> | null;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string | null;
};

export type DebugPayload = {
  execution: DebugExecution;
  events: DebugEvent[];
};

const STATUS_META: Record<string, { label: string; className: string }> = {
  queued: { label: 'Na fila', className: 'border-[var(--wf-border)] bg-slate-500/10 text-[var(--wf-text)]' },
  running: { label: 'Executando', className: 'border-sky-500/30 bg-sky-500/10 text-sky-200' },
  waiting: { label: 'Aguardando', className: 'border-amber-500/30 bg-amber-500/10 text-amber-200' },
  completed: { label: 'Concluído', className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' },
  failed: { label: 'Falhou', className: 'border-red-500/30 bg-red-500/10 text-red-200' },
  cancelled: { label: 'Cancelado', className: 'border-[var(--wf-border)] bg-slate-500/10 text-[var(--wf-muted)]' },
};

function eventIcon(type: string) {
  if (type.startsWith('tool.')) return Wrench;
  if (type.startsWith('agent.')) return Bot;
  if (type === 'message.delta') return Send;
  if (type.endsWith('.failed')) return XCircle;
  if (type.endsWith('.completed')) return CheckCircle2;
  if (type.endsWith('.waiting')) return Clock3;
  if (type.startsWith('execution.')) return Database;
  return Clock3;
}

function eventTone(type: string) {
  if (type.endsWith('.failed')) return 'border-red-500/30 bg-red-500/10 text-red-300';
  if (type.endsWith('.completed')) return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  if (type.startsWith('tool.')) return 'border-red-500/30 bg-red-500/10 text-red-300';
  if (type.startsWith('agent.')) return 'border-violet-500/30 bg-violet-500/10 text-violet-300';
  if (type.endsWith('.waiting')) return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  return 'border-sky-500/30 bg-sky-500/10 text-sky-300';
}

function elapsedLabel(startedAt: string, eventAt: string) {
  const elapsed = Math.max(0, new Date(eventAt).getTime() - new Date(startedAt).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  const seconds = Math.floor((elapsed % 60_000) / 1_000);
  const milliseconds = elapsed % 1_000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
}

function JsonPanel({ title, value }: { title: string; value: unknown }) {
  return (
    <section className="rounded-xl border border-[var(--wf-border)] bg-[var(--wf-panel)]">
      <div className="border-b border-[var(--wf-border)] px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[var(--wf-muted)]">
        {title}
      </div>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-5 text-[var(--wf-text)]">
        {JSON.stringify(value ?? null, null, 2)}
      </pre>
    </section>
  );
}

export function WorkflowExecutionDebugger({
  executionId,
  onBack,
  onSnapshot,
  onEventSelect,
  embedded = false,
}: {
  executionId: string;
  onBack?: () => void;
  onSnapshot?: (payload: DebugPayload) => void;
  onEventSelect?: (event: DebugEvent) => void;
  embedded?: boolean;
}) {
  const [payload, setPayload] = useState<DebugPayload | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await fetch(`/api/workflows/executions/${encodeURIComponent(executionId)}`, {
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(response.status === 404 ? 'Execução não encontrada.' : 'Falha ao carregar a execução.');
      const next = await response.json() as DebugPayload;
      setPayload(next);
      setSelectedEventId((current) => current || next.events.at(-1)?.id || null);
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar a execução.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [executionId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (payload) onSnapshot?.(payload);
  }, [onSnapshot, payload]);

  useEffect(() => {
    if (!payload || ['completed', 'failed', 'cancelled'].includes(payload.execution.status)) return;
    const after = payload.events.at(-1)?.sequence ?? -1;
    const source = new EventSource(
      `/api/workflows/executions/${encodeURIComponent(executionId)}/events?after=${after}`,
    );
    const onWorkflow = (message: MessageEvent<string>) => {
      try {
        const event = JSON.parse(message.data) as DebugEvent;
        setPayload((current) => {
          if (!current || current.events.some((candidate) => candidate.id === event.id)) return current;
          return {
            ...current,
            events: [...current.events, event].sort((left, right) => left.sequence - right.sequence),
          };
        });
        setSelectedEventId(event.id);
        void load(true);
      } catch {
        // A malformed event is ignored; the next refresh still reconciles from persistence.
      }
    };
    source.addEventListener('workflow', onWorkflow as EventListener);
    source.onerror = () => source.close();
    return () => {
      source.removeEventListener('workflow', onWorkflow as EventListener);
      source.close();
    };
  }, [executionId, load, payload?.events, payload?.execution.status]);

  const selectedEvent = useMemo(
    () => payload?.events.find((event) => event.id === selectedEventId) || payload?.events.at(-1) || null,
    [payload?.events, selectedEventId],
  );
  const selectedNodeResult = selectedEvent?.nodeId
    ? payload?.execution.nodeResults?.[selectedEvent.nodeId]
    : undefined;
  const selectedStep = selectedEvent?.nodeId
    ? [...(payload?.execution.executionPath || [])]
        .reverse()
        .find((step) => step.nodeId === selectedEvent.nodeId)
    : undefined;
  const statusMeta = STATUS_META[payload?.execution.status || 'queued'] || STATUS_META.queued;

  if (loading) {
    return (
      <div className={cn('flex items-center justify-center bg-[var(--wf-panel)] text-[var(--wf-muted)]', embedded ? 'h-full min-h-[260px]' : 'min-h-[520px]')}>
        <Loader2 className="mr-3 h-5 w-5 animate-spin text-sky-400" />
        Carregando execução
      </div>
    );
  }

  if (error || !payload) {
    return (
      <div className={cn('flex items-center justify-center bg-[var(--wf-panel)] p-8', embedded ? 'h-full min-h-[260px]' : 'min-h-[520px]')}>
        <div className="max-w-md rounded-2xl border border-red-500/20 bg-red-500/[0.06] p-6 text-center">
          <AlertTriangle className="mx-auto h-6 w-6 text-red-300" />
          <p className="mt-3 text-sm text-red-100">{error || 'Execução indisponível.'}</p>
          <Button variant="outline" onClick={() => void load()} className="mt-5 border-[var(--wf-border)] bg-[var(--wf-panel)]">
            <RefreshCw className="mr-2 h-4 w-4" />
            Tentar novamente
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--wf-panel)] text-[var(--wf-text)]">
      <header className={cn('flex flex-wrap items-center justify-between gap-4 border-b border-[var(--wf-border)] bg-[var(--wf-panel)]', embedded ? 'px-4 py-2.5' : 'px-6 py-4')}>
        <div className="flex min-w-0 items-center gap-3">
          {onBack && (
            <Button variant="ghost" size="icon" onClick={onBack} className="rounded-xl border border-[var(--wf-border)]">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-sky-400">Depurador de execução</p>
            {!embedded && <h1 className="truncate text-base font-semibold">{payload.execution.workflowId}</h1>}
            <p className="truncate font-mono text-xs text-[var(--wf-muted)]">{payload.execution.id}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge className={cn('border', statusMeta.className)}>{statusMeta.label}</Badge>
          <Button variant="ghost" size="icon" onClick={() => void load()} className="rounded-xl text-[var(--wf-muted)]">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className={cn('grid grid-cols-2 border-b border-[var(--wf-border)] sm:grid-cols-4', embedded ? 'gap-2 px-4 py-2' : 'gap-3 px-6 py-4')}>
        {[
          ['Passos', payload.execution.counters?.totalSteps || 0],
          ['Modelo', payload.execution.counters?.totalModelCalls || 0],
          ['Tools', payload.execution.counters?.totalToolCalls || 0],
          ['Tokens', payload.execution.counters?.totalTokens || 0],
        ].map(([label, value]) => (
          <div key={String(label)} className={cn('rounded-xl border border-[var(--wf-border)] bg-[var(--wf-panel)]', embedded ? 'px-3 py-1.5' : 'px-4 py-3')}>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--wf-muted)]">{label}</p>
            <p className={cn('font-semibold text-[var(--wf-text)]', embedded ? 'text-sm' : 'mt-1 text-lg')}>{value}</p>
          </div>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(340px,0.8fr)_minmax(420px,1.2fr)]">
        <section className="min-h-0 overflow-y-auto border-r border-[var(--wf-border)] p-5">
          <div className="space-y-2">
            {payload.events.map((event) => {
              const Icon = eventIcon(event.type);
              const selected = event.id === selectedEvent?.id;
              return (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => {
                    setSelectedEventId(event.id);
                    onEventSelect?.(event);
                  }}
                  className={cn(
                    'grid w-full grid-cols-[72px_34px_minmax(0,1fr)] items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors',
                    selected
                      ? 'border-sky-500/35 bg-sky-500/[0.08]'
                      : 'border-[var(--wf-border)] bg-[var(--wf-panel)] hover:bg-white/[0.04]',
                  )}
                >
                  <span className="pt-1 font-mono text-xs text-[var(--wf-muted)]">
                    {elapsedLabel(payload.execution.startedAt, event.createdAt)}
                  </span>
                  <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg border', eventTone(event.type))}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium text-[var(--wf-text)]">
                      {event.safeSummary || event.type}
                    </span>
                    <span className="mt-1 block truncate font-mono text-xs text-[var(--wf-muted)]">
                      {event.nodeId || event.toolName || event.type}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="min-h-0 overflow-y-auto p-5">
          {selectedEvent ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-[var(--wf-border)] bg-[var(--wf-panel)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-sky-400">{selectedEvent.type}</p>
                    <h2 className="mt-1 text-sm font-semibold text-[var(--wf-text)]">
                      {selectedEvent.safeSummary || 'Evento do runtime'}
                    </h2>
                  </div>
                  <span className="font-mono text-xs text-[var(--wf-muted)]">#{selectedEvent.sequence}</span>
                </div>
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                <JsonPanel title="Input" value={selectedStep?.input} />
                <JsonPanel title="Output" value={selectedNodeResult?.output || selectedStep?.output} />
                <JsonPanel title="Estado anterior" value={selectedStep?.stateBefore} />
                <JsonPanel title="State patch" value={selectedNodeResult?.statePatch || selectedStep?.statePatch} />
                <JsonPanel title="Estado posterior" value={selectedStep?.stateAfter} />
                <JsonPanel title="Métricas e evento" value={{
                  metrics: selectedNodeResult?.metrics,
                  error: selectedNodeResult?.error,
                  selectedOutput: selectedNodeResult?.selectedOutput,
                  toolCalls: selectedNodeResult?.toolCalls,
                  payload: selectedEvent.payload,
                }} />
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-[var(--wf-muted)]">
              Selecione um evento para inspecionar.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
