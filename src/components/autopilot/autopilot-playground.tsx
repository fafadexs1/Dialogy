'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Bot, CheckCircle2, Loader2, MessageSquareText, Play, ShieldAlert, Wrench, XCircle } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { AutopilotPlaygroundTrace } from '@/services/autopilot/playground-trace';
import type { AutopilotConfigDraftSnapshot } from '@/lib/types';
import { cn } from '@/lib/utils';

type PlaygroundResult = {
  response?: string | null;
  triggeredRule?: string | null;
};

type PreviewRun = {
  result: PlaygroundResult | null;
  trace: AutopilotPlaygroundTrace | null;
};

interface AutopilotPlaygroundProps {
  workspaceId: string | null | undefined;
  agentId: string;
  disabled?: boolean;
  stale?: boolean;
  draftSnapshot?: AutopilotConfigDraftSnapshot | null;
  onTrace: (trace: AutopilotPlaygroundTrace | null) => void;
}

function traceBadgeClass(value: string) {
  const normalized = value.toLowerCase();
  if (['approve', 'success', 'high', 'ready'].includes(normalized)) {
    return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  }
  if (['repair', 'medium', 'fallback', 'handoff', 'warning'].includes(normalized)) {
    return 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300';
  }
  if (['replace_with_fallback', 'error', 'low', 'none', 'blocked'].includes(normalized)) {
    return 'border-destructive/25 bg-destructive/10 text-destructive';
  }
  return 'border-border bg-muted/40 text-muted-foreground';
}

function TraceSection({
  title,
  value,
  children,
}: {
  title: string;
  value: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-muted/20 px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
        <Badge variant="outline" className={cn('rounded-full text-[10px]', traceBadgeClass(value))}>
          {value}
        </Badge>
      </div>
      <div className="mt-3 text-xs leading-5 text-muted-foreground">{children}</div>
    </div>
  );
}

function ResponsePreview({
  title,
  result,
}: {
  title: string;
  result: PlaygroundResult | null;
}) {
  return (
    <div className="rounded-2xl border border-border bg-background px-4 py-4">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <MessageSquareText className="h-3.5 w-3.5" />
        {title}
      </div>
      <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">
        {result?.response || 'Sem resposta.'}
      </p>
      {result?.triggeredRule && (
        <Badge variant="outline" className="mt-3 rounded-full">
          Regra: {result.triggeredRule}
        </Badge>
      )}
    </div>
  );
}

function TraceCompareRow({
  label,
  published,
  draft,
}: {
  label: string;
  published: string;
  draft: string;
}) {
  const changed = published !== draft;
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)_minmax(0,1fr)] gap-2 rounded-xl border border-border bg-background px-3 py-2 text-[11px]">
      <div className="font-semibold text-muted-foreground">{label}</div>
      <div className="min-w-0 truncate text-muted-foreground">{published || 'nenhum'}</div>
      <div className={cn('min-w-0 truncate font-medium', changed ? 'text-foreground' : 'text-muted-foreground')}>
        {draft || 'nenhum'}
      </div>
    </div>
  );
}

export function AutopilotPlayground({
  workspaceId,
  agentId,
  disabled = false,
  stale = false,
  draftSnapshot = null,
  onTrace,
}: AutopilotPlaygroundProps) {
  const [message, setMessage] = useState('Quero conhecer as opcoes e valores');
  const [chatHistory, setChatHistory] = useState('');
  const [contactName, setContactName] = useState('Cliente Teste');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PlaygroundResult | null>(null);
  const [trace, setTrace] = useState<AutopilotPlaygroundTrace | null>(null);
  const [publishedRun, setPublishedRun] = useState<PreviewRun | null>(null);

  const canRun = Boolean(workspaceId && agentId && message.trim() && !disabled);
  const shouldCompare = Boolean(draftSnapshot);
  const traceSummary = useMemo(() => {
    if (!trace) return null;
    return [
      trace.intent.intent,
      trace.rag.knowledgeCoverage,
      trace.workflow.executionMode,
      trace.validator.decision,
    ].join(' / ');
  }, [trace]);

  const compareRows = useMemo(() => {
    if (!publishedRun?.trace || !trace) return [];
    return [
      {
        label: 'Intent',
        published: publishedRun.trace.intent.intent,
        draft: trace.intent.intent,
      },
      {
        label: 'RAG',
        published: publishedRun.trace.rag.knowledgeCoverage,
        draft: trace.rag.knowledgeCoverage,
      },
      {
        label: 'Workflow',
        published: publishedRun.trace.workflow.executionMode,
        draft: trace.workflow.executionMode,
      },
      {
        label: 'Tools',
        published: publishedRun.trace.toolPlanner.acceptedActions.join(', ') || 'nenhuma',
        draft: trace.toolPlanner.acceptedActions.join(', ') || 'nenhuma',
      },
      {
        label: 'Validator',
        published: publishedRun.trace.validator.decision,
        draft: trace.validator.decision,
      },
    ];
  }, [publishedRun?.trace, trace]);

  const runSinglePreview = async (snapshot: AutopilotConfigDraftSnapshot | null): Promise<PreviewRun> => {
    if (!workspaceId || !canRun) {
      throw new Error('Preencha uma mensagem para testar o agente.');
    }

    const response = await fetch('/api/autopilot/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId,
        agentId,
        message,
        chatHistory,
        contactName,
        draftSnapshot: snapshot,
      }),
    });
    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Falha ao testar o agente.');
    }

    return {
      result: data.result || null,
      trace: data.trace || null,
    };
  };

  const runPreview = async () => {
    if (!workspaceId || !canRun) return;

    setLoading(true);
    setError(null);
    try {
      if (shouldCompare) {
        const [published, draft] = await Promise.all([
          runSinglePreview(null),
          runSinglePreview(draftSnapshot),
        ]);
        setPublishedRun(published);
        setResult(draft.result);
        setTrace(draft.trace);
        onTrace(draft.trace || null);
      } else {
        const published = await runSinglePreview(null);
        setPublishedRun(null);
        setResult(published.result);
        setTrace(published.trace);
        onTrace(published.trace || null);
      }
    } catch (previewError) {
      const message = previewError instanceof Error ? previewError.message : 'Falha ao testar o agente.';
      setError(message);
      setResult(null);
      setTrace(null);
      setPublishedRun(null);
      onTrace(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-[26px] border border-border bg-card shadow-sm">
      <div className="border-b border-border/60 px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">Playground</h2>
            <p className="text-xs text-muted-foreground">Teste o agente antes de publicar.</p>
          </div>
          {traceSummary && (
            <Badge variant="outline" className="max-w-[180px] truncate rounded-full">
              {traceSummary}
            </Badge>
          )}
        </div>
        {stale && (
          <div className="mt-3 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            O teste compara a versao publicada com o rascunho atual.
          </div>
        )}
      </div>

      <div className="grid gap-4 p-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="playground-contact">Contato</Label>
            <Input
              id="playground-contact"
              value={contactName}
              onChange={(event) => setContactName(event.target.value)}
              placeholder="Nome do cliente"
            />
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <div className="flex h-10 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm text-muted-foreground">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : trace ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Bot className="h-4 w-4" />}
              {loading ? 'Executando' : trace ? 'Trace pronto' : 'Aguardando teste'}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="playground-message">Mensagem do cliente</Label>
          <Textarea
            id="playground-message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            className="min-h-[90px] resize-y"
            placeholder="Digite uma pergunta real do cliente"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="playground-history">Historico opcional</Label>
          <Textarea
            id="playground-history"
            value={chatHistory}
            onChange={(event) => setChatHistory(event.target.value)}
            className="min-h-[70px] resize-y"
            placeholder="Cliente: ...&#10;Atendente: ..."
          />
        </div>

        <Button onClick={runPreview} disabled={!canRun || loading} className="rounded-full">
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
          Testar agente
        </Button>

        {error && (
          <div className="flex items-start gap-2 rounded-2xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {result?.response && (
          shouldCompare && publishedRun ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <ResponsePreview title="Publicado" result={publishedRun.result} />
              <ResponsePreview title="Rascunho" result={result} />
            </div>
          ) : (
            <ResponsePreview title="Resposta" result={result} />
          )
        )}

        {shouldCompare && compareRows.length > 0 && (
          <div className="rounded-2xl border border-border bg-muted/20 px-4 py-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Comparacao de trace
              </div>
              <Badge variant="outline" className="rounded-full text-[10px]">
                publicado x rascunho
              </Badge>
            </div>
            <div className="grid gap-2">
              {compareRows.map((row) => (
                <TraceCompareRow
                  key={row.label}
                  label={row.label}
                  published={row.published}
                  draft={row.draft}
                />
              ))}
            </div>
          </div>
        )}

        {trace && (
          <div className="grid gap-3">
            <TraceSection title="Intent" value={trace.intent.intent}>
              <div className="space-y-1">
                <div>Confianca: {(trace.intent.confidence * 100).toFixed(0)}%</div>
                <div>Workflow: {trace.intent.workflowId}</div>
                <div className="line-clamp-2">Motivo: {trace.intent.reason}</div>
              </div>
            </TraceSection>

            <TraceSection title="RAG" value={trace.rag.knowledgeCoverage}>
              <div className="space-y-1">
                <div>Estrategia: {trace.rag.strategy}</div>
                <div>
                  Docs: {trace.rag.selected.length > 0 ? trace.rag.selected.map((doc) => doc.name).join(', ') : 'nenhum'}
                </div>
              </div>
            </TraceSection>

            <TraceSection title="Workflow" value={trace.workflow.executionMode}>
              <div className="space-y-1">
                <div>{trace.workflow.reason}</div>
                <div>Slots ausentes: {trace.workflow.missingSlots.join(', ') || 'nenhum'}</div>
                <div>Acoes: {trace.workflow.actions.join(', ') || 'nenhuma'}</div>
              </div>
            </TraceSection>

            <TraceSection title="Tool planner" value={trace.toolPlanner.repairReason || (trace.toolPlanner.rejectedActions.length ? 'rejected' : 'accepted')}>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Wrench className="h-3.5 w-3.5" />
                  Aceitas: {trace.toolPlanner.acceptedActions.join(', ') || 'nenhuma'}
                </div>
                {trace.toolPlanner.rejectedActions.length > 0 && (
                  <div>
                    Rejeitadas: {trace.toolPlanner.rejectedActions.map((item) => `${item.tool} (${item.code})`).join(', ')}
                  </div>
                )}
                {trace.toolPlanner.promisedExternalLookup && (
                  <div>Promessa de consulta: {trace.toolPlanner.hasExecutableLookupTool ? 'com tool' : 'sem tool executavel'}</div>
                )}
              </div>
            </TraceSection>

            <TraceSection title="Validator" value={trace.validator.decision}>
              <div className="flex items-start gap-2">
                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{trace.validator.reasons.join(', ') || 'Resposta aprovada.'}</span>
              </div>
            </TraceSection>
          </div>
        )}
      </div>
    </section>
  );
}
