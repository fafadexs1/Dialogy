'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowRight, Bot, Braces, Check, ChevronRight, Code2, Copy, Info, Loader2, Maximize2, Minimize2, RotateCcw, Send, Sparkles, Terminal, User, X } from 'lucide-react';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { WorkflowBlockTestFixtures } from '@/services/workflow-runtime/block-test';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { WorkflowDefinition, WorkflowTestChatMessage, WorkflowTestExecutionResult } from '@/services/workflow-runtime/types';

export type TestChatMessage = WorkflowTestChatMessage & {
  isStreaming?: boolean;
};

export type NativeWorkflowTestChatProps = {
  open: boolean;
  onClose: () => void;
  workflowName: string;
  workflowDefinition: WorkflowDefinition;
  startNodeId?: string;
  startNodeName?: string;
  simulationOperations?: Array<{ id: string; label: string }>;
  onRunTest: (payload: {
    message: string;
    startNodeId?: string;
    fixtures?: WorkflowBlockTestFixtures;
  }) => Promise<WorkflowTestExecutionResult | string | null | undefined>;
  onResumeTest?: (payload: {
    resumeToken: string;
    message: string;
  }) => Promise<WorkflowTestExecutionResult | string | null | undefined>;
  onOpenExecutionDebugger?: (executionId: string) => void;
};

const QUICK_PROMPTS = [
  'Olá, preciso de ajuda.',
  'Quais são os planos e valores?',
  'Preciso da segunda via da fatura.',
  'Quero falar com um atendente humano.',
];

function formatTime(isoString?: string) {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function renderFormattedMessage(content: string) {
  if (!content) return null;
  const lines = content.split('\n');
  return lines.map((line, lineIdx) => {
    const parts: (string | React.ReactNode)[] = [];
    let remaining = line;
    let keyIdx = 0;

    while (remaining.length > 0) {
      const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
      const codeMatch = remaining.match(/`([^`]+)`/);

      let earliestMatch: { type: 'bold' | 'code'; match: RegExpMatchArray; index: number } | null = null;
      if (boldMatch && boldMatch.index !== undefined) {
        earliestMatch = { type: 'bold', match: boldMatch, index: boldMatch.index };
      }
      if (codeMatch && codeMatch.index !== undefined && (!earliestMatch || codeMatch.index < earliestMatch.index)) {
        earliestMatch = { type: 'code', match: codeMatch, index: codeMatch.index };
      }

      if (!earliestMatch) {
        parts.push(remaining);
        break;
      }

      if (earliestMatch.index > 0) {
        parts.push(remaining.substring(0, earliestMatch.index));
      }

      if (earliestMatch.type === 'bold') {
        parts.push(<strong key={`b-${lineIdx}-${keyIdx++}`} className="font-semibold text-inherit">{earliestMatch.match[1]}</strong>);
      } else {
        parts.push(<code key={`c-${lineIdx}-${keyIdx++}`} className="rounded bg-[var(--wf-hover)] px-1 py-0.5 font-mono text-xs text-cyan-300">{earliestMatch.match[1]}</code>);
      }

      remaining = remaining.substring(earliestMatch.index + earliestMatch.match[0].length);
    }

    return (
      <span key={`line-${lineIdx}`} className="block min-h-[1.25rem]">
        {parts.length > 0 ? parts : ' '}
      </span>
    );
  });
}

export function NativeWorkflowTestChat({
  open,
  onClose,
  workflowName,
  workflowDefinition,
  startNodeId,
  startNodeName,
  simulationOperations = [],
  onRunTest,
  onResumeTest,
  onOpenExecutionDebugger,
}: NativeWorkflowTestChatProps) {
  const [messages, setMessages] = useState<TestChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [currentResumeToken, setCurrentResumeToken] = useState<string | null>(null);
  const [lastExecutionId, setLastExecutionId] = useState<string | null>(null);
  const [variables, setVariables] = useState<Record<string, unknown>>({});
  const [activeTab, setActiveTab] = useState<'chat' | 'variables'>('chat');
  const [copiedVar, setCopiedVar] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [fixtureJson, setFixtureJson] = useState('{}');
  const simulation = useMemo(() => {
    try {
      const parsed = JSON.parse(fixtureJson) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.values(parsed).some((fixture) => !fixture || typeof fixture !== 'object' || Array.isArray(fixture) || !fixture.output || typeof fixture.output !== 'object' || Array.isArray(fixture.output))) throw new Error();
      return { fixtures: parsed as WorkflowBlockTestFixtures, error: '' };
    } catch { return { fixtures: {}, error: 'Informe um objeto JSON com output para cada operação.' }; }
  }, [fixtureJson]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto scroll to bottom
  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading, scrollToBottom]);

  // Focus input when opened or messages change
  useEffect(() => {
    if (open && activeTab === 'chat') {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [open, activeTab, loading]);

  // Reset conversation
  const handleResetConversation = useCallback(() => {
    setMessages([]);
    setCurrentResumeToken(null);
    setLastExecutionId(null);
    setVariables({});
    setInputText('');
  }, []);

  // Send a message
  const handleSendMessage = useCallback(async (textToSend: string) => {
    const text = textToSend.trim();
    if (!text || loading || (!currentResumeToken && simulation.error)) return;

    const userMessage: TestChatMessage = {
      id: `user_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      role: 'user',
      text,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputText('');
    setLoading(true);

    try {
      let result: WorkflowTestExecutionResult | string | null | undefined = null;

      // If we have an active resume token, resume the waiting workflow
      if (currentResumeToken && onResumeTest) {
        result = await onResumeTest({
          resumeToken: currentResumeToken,
          message: text,
        });
      } else {
        // Otherwise, start / run from entry point
        result = await onRunTest({
          message: text,
          startNodeId,
          fixtures: simulation.fixtures,
        });
      }

      if (result && typeof result === 'object') {
        if (result.executionId) {
          setLastExecutionId(result.executionId);
        }
        if (result.resumeToken) {
          setCurrentResumeToken(result.resumeToken);
        } else {
          setCurrentResumeToken(null);
        }
        if (result.variables && typeof result.variables === 'object') {
          setVariables((prev) => ({ ...prev, ...result.variables }));
        }

        // Add any bot messages produced by this turn
        if (Array.isArray(result.messages) && result.messages.length > 0) {
          setMessages((prev) => [...prev, ...result.messages!]);
        } else if (result.error) {
          setMessages((prev) => [
            ...prev,
            {
              id: `err_${Date.now()}`,
              role: 'system',
              text: `Erro na execução: ${result.error}`,
              type: 'error',
              timestamp: new Date().toISOString(),
            },
          ]);
        } else if (result.status === 'completed') {
          // Flow completed without explicit output
          setMessages((prev) => [
            ...prev,
            {
              id: `end_${Date.now()}`,
              role: 'system',
              text: 'Fluxo concluído.',
              type: 'handoff',
              timestamp: new Date().toISOString(),
            },
          ]);
        }
      } else if (typeof result === 'string') {
        setLastExecutionId(result);
      }
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          role: 'system',
          text: error instanceof Error ? error.message : 'Falha ao executar teste.',
          type: 'error',
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [currentResumeToken, loading, onResumeTest, onRunTest, startNodeId, simulation]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void handleSendMessage(inputText);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage(inputText);
    }
  };

  const copyVariableTag = (key: string) => {
    navigator.clipboard.writeText(`{{${key}}}`);
    setCopiedVar(key);
    setTimeout(() => setCopiedVar(null), 2000);
  };

  const variableEntries = useMemo(() => Object.entries(variables), [variables]);

  if (!open) return null;

  return (
    <aside
      aria-label="Chat de Teste do Fluxo"
      className={cn(
        'fixed bottom-4 right-4 z-50 flex flex-col rounded-2xl border border-[var(--wf-border)] bg-[var(--wf-panel)] shadow-[var(--wf-shadow)] backdrop-blur-2xl transition-all duration-300',
        isExpanded
          ? 'h-[min(88vh,860px)] w-[min(94vw,680px)]'
          : 'h-[min(84vh,740px)] w-[min(92vw,460px)]'
      )}
    >
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between border-b border-[var(--wf-border)] bg-[var(--wf-panel)] px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--wf-accent)] text-[var(--wf-accent-text)]">
              <Bot className="h-5 w-5" />
            </div>
            <span
              className={cn(
                'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--wf-panel)]',
                loading ? 'bg-amber-400 motion-safe:animate-pulse' : 'bg-emerald-400'
              )}
            />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-sm font-semibold text-[var(--wf-text)]">
                {workflowName || 'Testar Fluxo'}
              </h2>
              <Badge variant="outline" className="h-5 border-[var(--wf-border)] bg-cyan-500/10 px-1.5 text-xs font-semibold text-cyan-300">
                Sandbox
              </Badge>
            </div>
            <p className="truncate text-xs text-[var(--wf-muted)]">
              {startNodeName ? `Iniciando em: ${startNodeName}` : 'Prévia em tempo real (Rascunho)'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <TooltipProvider delayDuration={200}>
            {/* Reset conversation */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label="Reiniciar conversa de teste"
                  variant="ghost"
                  size="icon"
                  onClick={handleResetConversation}
                  className="h-8 w-8 rounded-lg text-[var(--wf-muted)] hover:bg-[var(--wf-hover)] hover:text-[var(--wf-text)]"
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                Reiniciar conversa (Limpar)
              </TooltipContent>
            </Tooltip>

            {/* Toggle Variables tab */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={activeTab === 'variables' ? 'Voltar para o chat' : 'Inspecionar variáveis do fluxo'}
                  aria-pressed={activeTab === 'variables'}
                  variant="ghost"
                  size="icon"
                  onClick={() => setActiveTab((curr) => (curr === 'variables' ? 'chat' : 'variables'))}
                  className={cn(
                    'relative h-8 w-8 rounded-lg transition',
                    activeTab === 'variables'
                      ? 'bg-cyan-500/20 text-cyan-300'
                      : 'text-[var(--wf-muted)] hover:bg-[var(--wf-hover)] hover:text-[var(--wf-text)]'
                  )}
                >
                  <Braces className="h-4 w-4" />
                  {variableEntries.length > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-cyan-500 px-1 text-xs font-bold text-[var(--wf-text)]">
                      {variableEntries.length}
                    </span>
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                {activeTab === 'variables' ? 'Voltar para o chat' : 'Inspecionar variáveis do fluxo'}
              </TooltipContent>
            </Tooltip>

            {/* Open Debugger */}
            {lastExecutionId && onOpenExecutionDebugger && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    aria-label="Ver execução detalhada"
                    variant="ghost"
                    size="icon"
                    onClick={() => onOpenExecutionDebugger(lastExecutionId)}
                    className="h-8 w-8 rounded-lg text-[var(--wf-muted)] hover:bg-[var(--wf-hover)] hover:text-amber-300"
                  >
                    <Terminal className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  Ver execução detalhada (Logs)
                </TooltipContent>
              </Tooltip>
            )}

            {/* Maximize / Minimize */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={isExpanded ? 'Reduzir tamanho do teste' : 'Expandir chat de teste'}
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsExpanded((prev) => !prev)}
                  className="h-8 w-8 rounded-lg text-[var(--wf-muted)] hover:bg-[var(--wf-hover)] hover:text-[var(--wf-text)]"
                >
                  {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                {isExpanded ? 'Reduzir tamanho' : 'Expandir chat'}
              </TooltipContent>
            </Tooltip>

            {/* Close */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label="Fechar teste"
                  variant="ghost"
                  size="icon"
                  onClick={onClose}
                  className="h-8 w-8 rounded-lg text-[var(--wf-muted)] hover:bg-[var(--wf-hover)] hover:text-[var(--wf-text)]"
                >
                  <X className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                Fechar teste
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </header>

      {simulationOperations.length > 0 && <details className="shrink-0 border-b border-[var(--wf-border)] bg-[var(--wf-panel)] px-4 py-3 text-xs text-[var(--wf-text)]">
        <summary className="cursor-pointer font-medium">Dados simulados de ferramentas e habilidades</summary>
        <div className="max-h-64 space-y-3 overflow-auto py-3"><p>Os testes não executam operações externas do Studio. Defina o resultado de cada operação que será usada.</p>
          <ul className="space-y-1">{simulationOperations.map((operation) => <li key={operation.id}>{operation.label} · <code>{operation.id}</code></li>)}</ul>
          <Button type="button" variant="outline" size="sm" disabled={loading || Boolean(currentResumeToken)} onClick={() => setFixtureJson(JSON.stringify(Object.fromEntries(simulationOperations.map((operation) => [operation.id, { output: {} }])), null, 2))}>Usar modelo de simulações</Button>
          <label className="block">Resultados simulados (JSON)<Textarea className="mt-2 min-h-36 font-mono text-xs" value={fixtureJson} onChange={(event) => setFixtureJson(event.target.value)} disabled={loading || Boolean(currentResumeToken)} aria-invalid={Boolean(simulation.error)} /></label>
          {simulation.error && <p role="alert" className="text-[var(--wf-danger)]">{simulation.error}</p>}
          {currentResumeToken && <p>As simulações ficam fixadas até reiniciar este teste.</p>}
        </div>
      </details>}

      {/* Main Content: Chat or Variables */}
      {activeTab === 'variables' ? (
        <div className="flex flex-1 flex-col overflow-hidden bg-[var(--wf-panel)] p-4 text-[var(--wf-text)]">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Braces className="h-4 w-4 text-cyan-400" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--wf-text)]">
                Variáveis da Sessão de Teste
              </h3>
            </div>
            <Badge variant="outline" className="border-[var(--wf-border)] text-xs text-[var(--wf-muted)]">
              {variableEntries.length} variável(is)
            </Badge>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {variableEntries.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center p-6 text-center text-[var(--wf-muted)]">
                <Code2 className="mb-2 h-8 w-8 opacity-40" />
                <p className="text-xs font-medium">Nenhuma variável coletada ainda.</p>
                <p className="mt-1 text-xs">
                  Conforme o fluxo executa nós de entrada, dados ou agente, as variáveis aparecerão aqui em tempo real.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {variableEntries.map(([key, value]) => (
                  <div
                    key={key}
                    className="group rounded-xl border border-[var(--wf-border)] bg-[var(--wf-panel)] p-3 transition hover:border-[var(--wf-border)]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 font-mono text-xs font-semibold text-cyan-300">
                        <span>{`{{${key}}}`}</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyVariableTag(key)}
                        className="h-6 gap-1 px-2 text-xs text-[var(--wf-muted)] opacity-80 group-hover:opacity-100 hover:text-[var(--wf-text)]"
                      >
                        {copiedVar === key ? (
                          <>
                            <Check className="h-3 w-3 text-emerald-400" /> Copiado
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" /> Copiar tag
                          </>
                        )}
                      </Button>
                    </div>
                    <div className="mt-2 rounded-lg bg-[var(--wf-hover)] p-2 font-mono text-xs text-[var(--wf-text)]">
                      {typeof value === 'object' && value !== null ? (
                        <pre className="overflow-x-auto whitespace-pre-wrap">
                          {JSON.stringify(value, null, 2)}
                        </pre>
                      ) : (
                        <span>{String(value ?? '')}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-3 border-t border-[var(--wf-border)] pt-3 text-center">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setActiveTab('chat')}
              className="w-full rounded-xl border-[var(--wf-border)] bg-cyan-500/10 text-xs text-cyan-200 hover:bg-cyan-500/20"
            >
              Voltar para o Chat
            </Button>
          </div>
        </div>
      ) : (
        /* Chat View */
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--wf-panel)]">
          {/* Scrollable Message List */}
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 ? (
              <div className="flex h-full min-h-[300px] flex-col items-center justify-center p-6 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--wf-hover)] border border-[var(--wf-border)] text-cyan-300 shadow-inner">
                  <Sparkles className="h-7 w-7" />
                </div>
                <h3 className="mt-4 text-base font-semibold text-[var(--wf-text)]">Inicie o teste do fluxo</h3>
                <p className="mt-1 max-w-[320px] text-xs leading-relaxed text-[var(--wf-muted)]">
                  Converse como se fosse um cliente real. O fluxo vai responder com base nos blocos e conexões do seu canvas.
                </p>

                <div className="mt-6 w-full space-y-2">
                  <p className="text-left text-xs font-semibold uppercase tracking-wider text-[var(--wf-muted)]">
                    Cenários sugeridos
                  </p>
                  <div className="grid gap-2">
                    {QUICK_PROMPTS.map((promptText) => (
                      <button
                        key={promptText}
                        type="button"
                        onClick={() => void handleSendMessage(promptText)}
                        disabled={loading}
                        className="flex items-center justify-between rounded-xl border border-[var(--wf-border)] bg-[var(--wf-panel)] px-3.5 py-2.5 text-left text-xs font-medium text-[var(--wf-text)] transition hover:border-cyan-500/40 hover:bg-cyan-500/10 hover:text-cyan-200 disabled:opacity-50"
                      >
                        <span className="truncate">{promptText}</span>
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-40" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              messages.map((msg, index) => {
                const isBot = msg.role === 'bot';
                const isUser = msg.role === 'user';
                const isSystem = msg.role === 'system';

                if (isSystem) {
                  return (
                    <div key={msg.id} className="my-2 flex justify-center">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--wf-border)] bg-[var(--wf-panel)] px-3 py-1 text-xs font-medium text-[var(--wf-muted)]">
                        <Info className="h-3 w-3" />
                        {msg.text}
                      </span>
                    </div>
                  );
                }

                return (
                  <div
                    key={msg.id}
                    className={cn(
                      'flex items-end gap-2.5 transition-all',
                      isUser ? 'justify-end' : 'justify-start'
                    )}
                  >
                    {isBot && (
                      <Avatar className="h-7 w-7 shrink-0 rounded-lg border border-[var(--wf-border)] bg-[var(--wf-hover)] text-cyan-300 shadow-sm">
                        <AvatarFallback className="rounded-lg bg-[var(--wf-hover)] text-xs font-bold text-cyan-200">
                          AI
                        </AvatarFallback>
                      </Avatar>
                    )}

                    <div className={cn('flex flex-col max-w-[84%]', isUser ? 'items-end' : 'items-start')}>
                      <div
                        className={cn(
                          'rounded-2xl px-4 py-3 text-xs leading-relaxed shadow-md',
                          isUser
                            ? 'rounded-tr-xs bg-[var(--wf-accent)] font-medium text-[var(--wf-accent-text)]'
                            : 'rounded-tl-xs border border-[var(--wf-border)] bg-[var(--wf-panel)] text-[var(--wf-text)]'
                        )}
                      >
                        <div className="space-y-1">{renderFormattedMessage(msg.text)}</div>

                        {/* Interactive Options Buttons (Typebot style!) */}
                        {isBot && msg.options && msg.options.length > 0 && (
                          <div className="mt-3 flex flex-col gap-1.5 pt-1">
                            {msg.options.map((option: { id: string; label: string; value: string }) => (
                              <button
                                key={option.id}
                                type="button"
                                onClick={() => void handleSendMessage(option.value || option.label)}
                                disabled={loading}
                                className="flex items-center justify-between rounded-xl border border-[var(--wf-border)] bg-cyan-500/10 px-3.5 py-2 text-left text-xs font-semibold text-cyan-200 shadow-sm transition hover:scale-[1.01] hover:border-cyan-400 hover:bg-cyan-500/20 active:scale-[0.99] disabled:opacity-50"
                              >
                                <span className="truncate">{option.label}</span>
                                <ArrowRight className="h-3.5 w-3.5 shrink-0 opacity-70" />
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Timestamp & metadata */}
                      <div className="mt-1 flex items-center gap-1.5 px-1 text-xs text-[var(--wf-muted)]">
                        <span>{formatTime(msg.timestamp)}</span>
                        {msg.nodeType && (
                          <>
                            <span>·</span>
                            <span className="font-mono text-xs text-[var(--wf-muted)]">{msg.nodeType}</span>
                          </>
                        )}
                      </div>
                    </div>

                    {isUser && (
                      <Avatar className="h-7 w-7 shrink-0 rounded-lg border border-[var(--wf-border)] bg-[var(--wf-hover)] text-[var(--wf-text)] shadow-sm">
                        <AvatarFallback className="rounded-lg bg-[var(--wf-hover)] text-xs font-bold text-[var(--wf-text)]">
                          <User className="h-3.5 w-3.5" />
                        </AvatarFallback>
                      </Avatar>
                    )}
                  </div>
                );
              })
            )}

            {/* Typing Indicator */}
            {loading && (
              <div className="flex items-end gap-2.5">
                <Avatar className="h-7 w-7 shrink-0 rounded-lg border border-[var(--wf-border)] bg-[var(--wf-hover)] text-cyan-300 shadow-sm">
                  <AvatarFallback className="rounded-lg bg-[var(--wf-hover)] text-xs font-bold text-cyan-200">
                    AI
                  </AvatarFallback>
                </Avatar>
                <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-xs border border-[var(--wf-border)] bg-[var(--wf-panel)] px-4 py-3 shadow-md">
                  <span className="h-2 w-2 rounded-full bg-cyan-400 motion-safe:animate-bounce [animation-delay:-0.3s]" />
                  <span className="h-2 w-2 rounded-full bg-cyan-400 motion-safe:animate-bounce [animation-delay:-0.15s]" />
                  <span className="h-2 w-2 rounded-full bg-cyan-400 motion-safe:animate-bounce" />
                </div>
              </div>
            )}
          </div>

          {/* Chat Input Bar */}
          <form
            onSubmit={handleSubmit}
            className="border-t border-[var(--wf-border)] bg-[var(--wf-panel)] p-3"
          >
            <div className="flex items-center gap-2 rounded-xl border border-[var(--wf-border)] bg-[var(--wf-panel)] px-3 py-1.5 shadow-inner focus-within:border-cyan-500 focus-within:ring-1 focus-within:ring-cyan-500">
              <Input
                aria-label="Mensagem de teste"
                ref={inputRef}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={loading ? 'O fluxo está processando…' : 'Digite sua mensagem… (Enter para enviar)'}
                disabled={loading}
                className="h-9 flex-1 border-0 bg-transparent px-0 text-xs text-[var(--wf-text)] placeholder:text-[var(--wf-muted)] focus-visible:ring-0 focus-visible:ring-offset-0"
              />
              <Button
                aria-label="Enviar mensagem de teste"
                type="submit"
                size="icon"
                disabled={!inputText.trim() || loading}
                className="h-8 w-8 shrink-0 rounded-lg bg-[var(--wf-accent)] text-[var(--wf-accent-text)] shadow transition hover:opacity-90 disabled:opacity-40"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              </Button>
            </div>

            <div className="mt-2 flex items-center justify-between px-1 text-xs text-[var(--wf-muted)]">
              <span>{currentResumeToken ? '• Aguardando sua resposta' : '• Conversa pronta'}</span>
              <span>Pressione Enter para enviar</span>
            </div>
          </form>
        </div>
      )}
    </aside>
  );
}
