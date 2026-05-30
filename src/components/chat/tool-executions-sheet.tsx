'use client';

import { formatInTimeZone } from 'date-fns-tz';
import { ptBR } from 'date-fns/locale';
import { Activity, AlertTriangle, Brain, CheckCircle2, Clock, Code2, Copy, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { Message } from '@/lib/types';
import { cn } from '@/lib/utils';

const TOOL_EXECUTION_STALE_MS = 5 * 60 * 1000;

type ToolExecutionStatus = 'prearmed' | 'running' | 'success' | 'error' | 'rejected' | 'stale' | string;

type ToolExecutionItem = {
  id: string;
  toolName: string;
  status: ToolExecutionStatus;
  content: string;
  startMessage?: Message;
  resultMessage?: Message;
  createdAt: string;
  finishedAt?: string | null;
  timestamp?: string;
};

export function isToolExecutionMessage(message: Message): boolean {
  return Boolean(message.metadata?.isToolExecution || message.metadata?.tool === 'agent_tool_status');
}

function resolveToolStatusLabel(status?: ToolExecutionStatus): string {
  if (status === 'prearmed') return 'Pre-engatilhada';
  if (status === 'running') return 'Executando';
  if (status === 'success') return 'Concluido';
  if (status === 'error') return 'Falhou';
  if (status === 'rejected') return 'Rejeitado';
  if (status === 'stale') return 'Sem retorno';
  return 'Registrado';
}

function resolveToolStatusClass(status?: ToolExecutionStatus): string {
  if (status === 'prearmed') return 'border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-200';
  if (status === 'success') return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200';
  if (status === 'error') return 'border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-200';
  if (status === 'rejected' || status === 'stale') return 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-200';
  if (status === 'running') return 'border-cyan-500/25 bg-cyan-500/10 text-cyan-700 dark:text-cyan-200';
  return 'border-slate-500/20 bg-slate-500/10 text-slate-700 dark:text-slate-200';
}

function resolveToolStatusIcon(status?: ToolExecutionStatus) {
  if (status === 'prearmed') return Brain;
  if (status === 'success') return CheckCircle2;
  if (status === 'error' || status === 'rejected' || status === 'stale') return AlertTriangle;
  if (status === 'running') return Loader2;
  return Activity;
}

function getToolMessageTime(message: Message): number {
  const parsed = new Date(message.createdAt).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function resolveToolMessageKey(message: Message): string {
  const metadata = message.metadata || {};
  return metadata.agentToolRunId || metadata.agentToolName || metadata.tool || 'agent_tool';
}

export function buildToolExecutionItems(messages: Message[], now = Date.now()): ToolExecutionItem[] {
  const sortedMessages = messages
    .slice()
    .sort((a, b) => getToolMessageTime(a) - getToolMessageTime(b));
  const pendingByKey = new Map<string, Message[]>();
  const executions: ToolExecutionItem[] = [];

  for (const message of sortedMessages) {
    const metadata = message.metadata || {};
    const status = metadata.agentToolStatus || 'registered';
    const key = resolveToolMessageKey(message);
    const toolName = metadata.agentToolName || metadata.tool || 'agent_tool';

    if (status === 'running') {
      const pending = pendingByKey.get(key) || [];
      pending.push(message);
      pendingByKey.set(key, pending);
      continue;
    }

    const pending = pendingByKey.get(key) || [];
    const startMessage = pending.pop();
    if (pending.length > 0) {
      pendingByKey.set(key, pending);
    } else {
      pendingByKey.delete(key);
    }

    executions.push({
      id: startMessage ? `${startMessage.id}:${message.id}` : message.id,
      toolName,
      status,
      content: message.content,
      startMessage,
      resultMessage: message,
      createdAt: startMessage?.createdAt || message.createdAt,
      finishedAt: message.createdAt,
      timestamp: message.timestamp,
    });
  }

  for (const pendingMessages of pendingByKey.values()) {
    for (const message of pendingMessages) {
      const metadata = message.metadata || {};
      const ageMs = now - getToolMessageTime(message);
      executions.push({
        id: message.id,
        toolName: metadata.agentToolName || metadata.tool || 'agent_tool',
        status: ageMs > TOOL_EXECUTION_STALE_MS ? 'stale' : 'running',
        content: message.content,
        startMessage: message,
        createdAt: message.createdAt,
        finishedAt: null,
        timestamp: message.timestamp,
      });
    }
  }

  return executions.sort((a, b) => {
    const left = new Date(a.finishedAt || a.createdAt).getTime();
    const right = new Date(b.finishedAt || b.createdAt).getTime();
    return (Number.isNaN(right) ? 0 : right) - (Number.isNaN(left) ? 0 : left);
  });
}

function resolveToolOutputText(execution: ToolExecutionItem): string {
  const metadata = execution.resultMessage?.metadata || execution.startMessage?.metadata || {};
  const output = metadata.agentToolOutput;
  const error = metadata.agentToolError;

  if (error) return String(error);
  if (output !== undefined && output !== null) {
    try {
      return JSON.stringify(output, null, 2);
    } catch {
      return String(output);
    }
  }
  if (execution.status === 'running') {
    return 'Aguardando retorno da API.';
  }
  if (execution.status === 'prearmed') {
    return 'A ferramenta esta pronta para executar assim que os dados obrigatorios forem informados.';
  }
  if (execution.status === 'stale') {
    return 'A ferramenta foi iniciada, mas nenhum retorno final foi registrado. Ela nao esta mais em execucao agora.';
  }
  return 'Resultado detalhado nao esta disponivel para esta execucao.';
}

export function ToolExecutionsSheet({
  open,
  onOpenChange,
  executions,
  workspaceTimezone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  executions: ToolExecutionItem[];
  workspaceTimezone: string;
}) {
  const latestStatus = executions[0]?.status;
  const prearmedCount = executions.filter((execution) => execution.status === 'prearmed').length;
  const runningCount = executions.filter((execution) => execution.status === 'running').length;
  const successCount = executions.filter((execution) => execution.status === 'success').length;
  const failedCount = executions.filter((execution) => ['error', 'rejected', 'stale'].includes(String(execution.status || ''))).length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col overflow-hidden border-slate-200/80 bg-white/95 p-0 backdrop-blur-xl dark:border-white/10 dark:bg-[#050507]/95 sm:max-w-[520px]">
        <SheetHeader className="border-b border-slate-200/80 px-5 py-4 text-left dark:border-white/10">
          <div className="flex items-start gap-3">
            <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-cyan-500/20 bg-cyan-500/10 text-cyan-600 dark:text-cyan-200">
              <Activity className="h-5 w-5" />
              {runningCount > 0 && (
                <motion.span
                  className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-cyan-400"
                  animate={{ opacity: [0.35, 1, 0.35], scale: [0.8, 1.12, 0.8] }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'easeInOut' }}
                />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-base">Execucoes da IA</SheetTitle>
              <SheetDescription className="mt-1">
                Ferramentas, chamadas e retornos tecnicos deste atendimento.
              </SheetDescription>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-4 gap-2">
            <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Prontas</div>
              <div className="mt-1 text-lg font-semibold text-violet-600 dark:text-violet-300">{prearmedCount}</div>
            </div>
            <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Sucesso</div>
              <div className="mt-1 text-lg font-semibold text-emerald-600 dark:text-emerald-300">{successCount}</div>
            </div>
            <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Rodando</div>
              <div className="mt-1 text-lg font-semibold text-cyan-600 dark:text-cyan-300">{runningCount}</div>
            </div>
            <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Falhas</div>
              <div className="mt-1 text-lg font-semibold text-red-600 dark:text-red-300">{failedCount}</div>
            </div>
          </div>
          {latestStatus && (
            <div className={cn('mt-3 inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium', resolveToolStatusClass(latestStatus))}>
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              Ultimo status: {resolveToolStatusLabel(latestStatus)}
            </div>
          )}
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {executions.length === 0 ? (
            <div className="flex h-full min-h-[260px] flex-col items-center justify-center text-center text-sm text-muted-foreground">
              <div className="mb-3 rounded-lg border border-border bg-muted/40 p-3">
                <Activity className="h-6 w-6" />
              </div>
              Nenhuma execucao registrada neste chat.
            </div>
          ) : (
            <div className="relative space-y-3">
              <div className="absolute bottom-3 left-5 top-3 w-px bg-gradient-to-b from-cyan-400/40 via-border to-transparent" />
              {executions.map((execution, index) => {
                const status = execution.status || 'registered';
                const StatusIcon = resolveToolStatusIcon(status);
                const createdAt = new Date(execution.finishedAt || execution.createdAt);
                const timeLabel = Number.isNaN(createdAt.getTime())
                  ? execution.timestamp
                  : formatInTimeZone(createdAt, workspaceTimezone, "dd/MM/yyyy 'as' HH:mm", { locale: ptBR });
                const outputText = resolveToolOutputText(execution);
                const canCopy = outputText
                  && !outputText.startsWith('Aguardando retorno')
                  && !outputText.startsWith('A ferramenta esta pronta')
                  && !outputText.startsWith('A ferramenta foi iniciada')
                  && !outputText.startsWith('Resultado detalhado');

                return (
                  <motion.div
                    key={execution.id}
                    initial={{ opacity: 0, x: 24 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.28, delay: Math.min(index * 0.03, 0.18), ease: 'easeOut' }}
                    className="relative pl-12"
                  >
                    <div className={cn('absolute left-0 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-lg border bg-background shadow-sm', resolveToolStatusClass(status))}>
                      <StatusIcon className={cn('h-4 w-4', status === 'running' && 'animate-spin')} />
                    </div>
                    <div className="overflow-hidden rounded-lg border border-border/80 bg-background/80 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
                      {(status === 'running' || status === 'prearmed') && (
                        <motion.div
                          className={cn('h-0.5 bg-gradient-to-r from-transparent to-transparent', status === 'prearmed' ? 'via-violet-400' : 'via-cyan-400')}
                          animate={{ x: ['-100%', '100%'] }}
                          transition={{ duration: status === 'prearmed' ? 2.2 : 1.3, repeat: Infinity, ease: 'easeInOut' }}
                        />
                      )}
                      <div className="p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium', resolveToolStatusClass(status))}>
                                {resolveToolStatusLabel(status)}
                              </span>
                              <span className="truncate font-mono text-xs text-muted-foreground">{execution.toolName}</span>
                            </div>
                            <p className="mt-2 text-sm text-foreground">{execution.content}</p>
                            <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                              <Clock className="h-3 w-3" />
                              {timeLabel}
                            </p>
                          </div>
                          {canCopy && (
                            <TooltipProvider delayDuration={150}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                                    onClick={() => navigator.clipboard?.writeText(outputText)}
                                  >
                                    <Copy className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Copiar resultado</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </div>

                        <div className="mt-3 rounded-lg border border-border/70 bg-muted/30">
                          <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                            <Code2 className="h-3.5 w-3.5" />
                            Resultado da API
                          </div>
                          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words p-3 text-xs leading-relaxed text-foreground">
                            {outputText}
                          </pre>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
