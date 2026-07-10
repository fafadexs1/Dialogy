'use client';

import { useEffect, useMemo, useState, useRef, type ReactNode } from 'react';
import {
  Bot,
  CheckCircle2,
  Database,
  Loader2,
  MessageSquareText,
  Phone,
  Plus,
  Search,
  Send,
  ShieldAlert,
  Trash2,
  UserRound,
  Wrench,
  XCircle,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { AutopilotPlaygroundTrace } from '@/services/autopilot/playground-trace';
import type { AutopilotConfigDraftSnapshot, Contact } from '@/lib/types';
import { cn } from '@/lib/utils';
import { getContacts } from '@/actions/crm';

type PlaygroundResult = {
  response?: string | null;
  messageBlocks?: string[] | null;
  triggeredRule?: string | null;
};

type PreviewRun = {
  result: PlaygroundResult | null;
  trace: AutopilotPlaygroundTrace | null;
};

type PlaygroundMessage = {
  id: string;
  role: 'customer' | 'assistant';
  content: string;
  createdAt: string;
};

type PlaygroundSession = {
  id: string;
  procedureChatId: string;
  draftProcedureChatId: string;
  title: string;
  contactName: string;
  contactId?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  messages: PlaygroundMessage[];
  updatedAt: string;
  lastResult?: PlaygroundResult | null;
  lastTrace?: AutopilotPlaygroundTrace | null;
  lastPublishedRun?: PreviewRun | null;
};

type PreviewError = Error & {
  trace?: AutopilotPlaygroundTrace | null;
};

interface AutopilotPlaygroundProps {
  workspaceId: string | null | undefined;
  agentId: string;
  disabled?: boolean;
  stale?: boolean;
  draftSnapshot?: AutopilotConfigDraftSnapshot | null;
  onTrace: (trace: AutopilotPlaygroundTrace | null) => void;
}

const DEFAULT_SESSION: PlaygroundSession = {
  id: 'default',
  procedureChatId: '00000000-0000-4000-8000-000000000001',
  draftProcedureChatId: '00000000-0000-4000-8000-000000000002',
  title: 'Novo chat',
  contactName: 'Cliente Teste',
  contactId: null,
  contactPhone: '',
  contactEmail: '',
  messages: [],
  updatedAt: '1970-01-01T00:00:00.000Z',
  lastResult: null,
  lastTrace: null,
  lastPublishedRun: null,
};

function makeId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function makeUuid() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const value = Math.random() * 16 | 0;
    const nibble = char === 'x' ? value : (value & 0x3) | 0x8;
    return nibble.toString(16);
  });
}

function createSession(): PlaygroundSession {
  return {
    ...DEFAULT_SESSION,
    id: makeId('chat'),
    procedureChatId: makeUuid(),
    draftProcedureChatId: makeUuid(),
    updatedAt: new Date().toISOString(),
  };
}

function normalizeSession(raw: unknown): PlaygroundSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Partial<PlaygroundSession>;
  const id = typeof item.id === 'string' && item.id.trim().length > 0 ? item.id : makeId('chat');
  const messages = Array.isArray(item.messages)
    ? item.messages
        .filter((message): message is PlaygroundMessage => (
          Boolean(message) &&
          (message.role === 'customer' || message.role === 'assistant') &&
          typeof message.content === 'string' &&
          message.content.trim().length > 0
        ))
        .slice(-40)
    : [];

  return {
    id,
    procedureChatId: typeof item.procedureChatId === 'string' && item.procedureChatId.trim().length > 0
      ? item.procedureChatId
      : makeUuid(),
    draftProcedureChatId: typeof item.draftProcedureChatId === 'string' && item.draftProcedureChatId.trim().length > 0
      ? item.draftProcedureChatId
      : makeUuid(),
    title: typeof item.title === 'string' && item.title.trim().length > 0 ? item.title : 'Novo chat',
    contactName: typeof item.contactName === 'string' && item.contactName.trim().length > 0
      ? item.contactName
      : 'Cliente Teste',
    contactId: typeof item.contactId === 'string' && item.contactId.trim().length > 0 ? item.contactId : null,
    contactPhone: typeof item.contactPhone === 'string' ? item.contactPhone : '',
    contactEmail: typeof item.contactEmail === 'string' ? item.contactEmail : '',
    messages,
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
    lastResult: item.lastResult || null,
    lastTrace: item.lastTrace || null,
    lastPublishedRun: item.lastPublishedRun || null,
  };
}

function formatChatHistory(messages: PlaygroundMessage[]): string {
  return messages
    .map((message) => `${message.role === 'customer' ? 'Cliente' : 'Atendente'}: ${message.content}`)
    .join('\n');
}

function buildSessionTitle(message: string) {
  const compact = message.replace(/\s+/g, ' ').trim();
  return compact.length > 42 ? `${compact.slice(0, 39)}...` : compact || 'Novo chat';
}

function getSessionPreview(session: PlaygroundSession) {
  const lastMessage = [...session.messages].reverse().find((item) => item.content.trim().length > 0);
  return lastMessage?.content || 'Sem mensagens neste chat.';
}

function formatSessionDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Agora';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
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

function ChatTranscript({ messages }: { messages: PlaygroundMessage[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto p-4 space-y-4 h-[600px] lg:h-[calc(100vh-280px)] min-h-[450px] bg-slate-50/50 dark:bg-zinc-950/40 rounded-2xl border border-border/80"
    >
      {messages.length === 0 ? (
        <div className="flex h-full min-h-[280px] flex-col items-center justify-center text-center p-6 text-muted-foreground">
          <Bot className="h-10 w-10 mb-2 text-muted-foreground/60" />
          <p className="text-sm font-semibold">Inicie uma conversa!</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-[260px]">
            Envie uma mensagem abaixo para testar as respostas e o comportamento da IA.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {messages.map((chatMessage) => (
            <div
              key={chatMessage.id}
              className={cn(
                'flex items-end gap-2',
                chatMessage.role === 'customer' ? 'justify-end' : 'justify-start'
              )}
            >
              {chatMessage.role === 'assistant' && (
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-violet-600 to-indigo-600 text-[10px] font-bold text-white shadow-sm">
                  R
                </div>
              )}
              <div
                className={cn(
                  'max-w-[78%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-6 shadow-sm',
                  chatMessage.role === 'customer'
                    ? 'bg-primary text-primary-foreground rounded-br-none'
                    : 'border border-border bg-card text-foreground rounded-bl-none'
                )}
              >
                {chatMessage.content}
              </div>
            </div>
          ))}
        </div>
      )}
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
  const [sessions, setSessions] = useState<PlaygroundSession[]>([DEFAULT_SESSION]);
  const [activeSessionId, setActiveSessionId] = useState(DEFAULT_SESSION.id);
  const [storageReady, setStorageReady] = useState(false);
  const [loadedStorageKey, setLoadedStorageKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PlaygroundResult | null>(null);
  const [trace, setTrace] = useState<AutopilotPlaygroundTrace | null>(null);
  const [publishedRun, setPublishedRun] = useState<PreviewRun | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [contactSearch, setContactSearch] = useState('');
  const [contactOptions, setContactOptions] = useState<Contact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [showIdentityConfig, setShowIdentityConfig] = useState(false);

  const storageKey = useMemo(() => (
    workspaceId && agentId ? `dialogy:autopilot-playground:${workspaceId}:${agentId}` : null
  ), [agentId, workspaceId]);

  useEffect(() => {
    if (!storageKey) {
      setStorageReady(true);
      setLoadedStorageKey(null);
      return;
    }

    try {
      const raw = window.localStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      const loaded = Array.isArray(parsed)
        ? parsed.map(normalizeSession).filter((item): item is PlaygroundSession => Boolean(item)).slice(0, 12)
        : [];
      const nextSessions = loaded.length > 0 ? loaded : [createSession()];
      setSessions(nextSessions);
      setActiveSessionId(nextSessions[0].id);
      setResult(nextSessions[0].lastResult || null);
      setTrace(nextSessions[0].lastTrace || null);
      setPublishedRun(nextSessions[0].lastPublishedRun || null);
      onTrace(nextSessions[0].lastTrace || null);
    } catch {
      const fallback = createSession();
      setSessions([fallback]);
      setActiveSessionId(fallback.id);
      setResult(null);
      setTrace(null);
      setPublishedRun(null);
      onTrace(null);
    } finally {
      setStorageReady(true);
      setLoadedStorageKey(storageKey);
    }
  }, [onTrace, storageKey]);

  useEffect(() => {
    if (!storageReady || !storageKey || loadedStorageKey !== storageKey) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(sessions.slice(0, 12)));
    } catch {
      // Local history is a convenience; storage failures should not block testing.
    }
  }, [loadedStorageKey, sessions, storageKey, storageReady]);

  const activeSession = useMemo(() => (
    sessions.find((session) => session.id === activeSessionId) || sessions[0] || DEFAULT_SESSION
  ), [activeSessionId, sessions]);

  useEffect(() => {
    if (!workspaceId || !isChatOpen) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setContactsLoading(true);
      setContactsError(null);
      try {
        const res = await getContacts(workspaceId, {
          page: 1,
          limit: 8,
          search: contactSearch.trim() || undefined,
        });
        if (cancelled) return;
        if (res.error) {
          setContactsError(res.error);
          setContactOptions([]);
        } else {
          setContactOptions(res.contacts || []);
        }
      } catch {
        if (!cancelled) {
          setContactsError('Falha ao buscar contatos.');
          setContactOptions([]);
        }
      } finally {
        if (!cancelled) setContactsLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [contactSearch, isChatOpen, workspaceId]);

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

  const updateActiveSession = (updater: (session: PlaygroundSession) => PlaygroundSession) => {
    setSessions((current) => current.map((session) => (
      session.id === activeSession.id ? updater(session) : session
    )));
  };

  const selectSession = (session: PlaygroundSession, open = false) => {
    setActiveSessionId(session.id);
    setResult(session.lastResult || null);
    setTrace(session.lastTrace || null);
    setPublishedRun(session.lastPublishedRun || null);
    setError(null);
    onTrace(session.lastTrace || null);
    setContactSearch(session.contactName || session.contactPhone || '');
    if (open) setIsChatOpen(true);
  };

  const startNewChat = () => {
    const nextSession = createSession();
    setSessions((current) => [nextSession, ...current].slice(0, 12));
    setActiveSessionId(nextSession.id);
    setMessage('');
    setError(null);
    setResult(null);
    setTrace(null);
    setPublishedRun(null);
    onTrace(null);
    setContactSearch('');
    setIsChatOpen(true);
  };

  const clearCurrentChat = () => {
    updateActiveSession((session) => ({
      ...session,
      title: 'Novo chat',
      messages: [],
      updatedAt: new Date().toISOString(),
      lastResult: null,
      lastTrace: null,
      lastPublishedRun: null,
    }));
    setError(null);
    setResult(null);
    setTrace(null);
    setPublishedRun(null);
    onTrace(null);
  };

  const deleteSession = (sessionId: string) => {
    const remaining = sessions.filter((session) => session.id !== sessionId);
    const nextSessions = remaining.length > 0 ? remaining : [createSession()];
    const nextActive = nextSessions[0];
    setSessions(nextSessions);
    setActiveSessionId(nextActive.id);
    setMessage('');
    setError(null);
    setResult(nextActive.lastResult || null);
    setTrace(nextActive.lastTrace || null);
    setPublishedRun(nextActive.lastPublishedRun || null);
    onTrace(nextActive.lastTrace || null);
    setIsChatOpen(false);
  };

  const selectContact = (contact: Contact) => {
    updateActiveSession((session) => ({
      ...session,
      contactId: contact.id,
      contactName: contact.name || contact.phone_number_jid || contact.phone || 'Contato do CRM',
      contactPhone: contact.phone_number_jid || contact.phone || '',
      contactEmail: contact.email || '',
      updatedAt: new Date().toISOString(),
    }));
    setContactSearch(contact.name || contact.phone_number_jid || contact.phone || '');
  };

  const useManualNumber = () => {
    const value = contactSearch.trim();
    if (!value) return;
    updateActiveSession((session) => ({
      ...session,
      contactId: null,
      contactName: session.contactName === 'Cliente Teste' || !session.contactName ? value : session.contactName,
      contactPhone: value,
      contactEmail: '',
      updatedAt: new Date().toISOString(),
    }));
  };

  const runSinglePreview = async (input: {
    snapshot: AutopilotConfigDraftSnapshot | null;
    outboundMessage: string;
    chatHistory: string;
    procedureChatId: string;
    contactId?: string | null;
    contactName: string;
    contactPhone?: string | null;
    contactEmail?: string | null;
  }): Promise<PreviewRun> => {
    if (!workspaceId || !agentId || !input.outboundMessage.trim()) {
      throw new Error('Preencha uma mensagem para testar o agente.');
    }

    const response = await fetch('/api/autopilot/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId,
        agentId,
        procedureChatId: input.procedureChatId,
        message: input.outboundMessage,
        chatHistory: input.chatHistory,
        contactId: input.contactId || undefined,
        contactName: input.contactName,
        contactPhone: input.contactPhone || undefined,
        contactEmail: input.contactEmail || undefined,
        draftSnapshot: input.snapshot,
      }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.success) {
      const previewError = new Error(data.error || 'Falha ao testar o agente.') as PreviewError;
      previewError.trace = data.trace || null;
      throw previewError;
    }

    return {
      result: data.result || null,
      trace: data.trace || null,
    };
  };

  const commitSuccessfulRun = (input: {
    sessionId: string;
    outboundMessage: string;
    assistantResponse: string;
    nextResult: PlaygroundResult | null;
    nextTrace: AutopilotPlaygroundTrace | null;
    nextPublishedRun: PreviewRun | null;
  }) => {
    const now = new Date().toISOString();
    const customerMessage: PlaygroundMessage = {
      id: makeId('customer'),
      role: 'customer',
      content: input.outboundMessage,
      createdAt: now,
    };
    const assistantMessage: PlaygroundMessage = {
      id: makeId('assistant'),
      role: 'assistant',
      content: input.assistantResponse,
      createdAt: now,
    };

    setSessions((current) => {
      const updated = current.map((session) => {
        if (session.id !== input.sessionId) return session;
        return {
          ...session,
          title: session.messages.length === 0 ? buildSessionTitle(input.outboundMessage) : session.title,
          messages: [...session.messages, customerMessage, assistantMessage].slice(-40),
          updatedAt: now,
          lastResult: input.nextResult,
          lastTrace: input.nextTrace,
          lastPublishedRun: input.nextPublishedRun,
        };
      });
      const active = updated.find((session) => session.id === input.sessionId);
      const others = updated.filter((session) => session.id !== input.sessionId);
      return active ? [active, ...others].slice(0, 12) : updated.slice(0, 12);
    });
    setActiveSessionId(input.sessionId);
  };

  const runPreview = async () => {
    if (!workspaceId || !canRun || loading) return;

    const outboundMessage = message.trim();
    const chatHistory = formatChatHistory(activeSession.messages);
    const contactName = activeSession.contactName || activeSession.contactPhone || 'Cliente Teste';
    const sessionId = activeSession.id;
    const contactId = activeSession.contactId || null;
    const contactPhone = activeSession.contactPhone || null;
    const contactEmail = activeSession.contactEmail || null;

    setLoading(true);
    setError(null);
    try {
      if (shouldCompare) {
        const [published, draft] = await Promise.all([
          runSinglePreview({
            snapshot: null,
            outboundMessage,
            chatHistory,
            procedureChatId: activeSession.procedureChatId,
            contactId,
            contactName,
            contactPhone,
            contactEmail,
          }),
          runSinglePreview({
            snapshot: draftSnapshot,
            outboundMessage,
            chatHistory,
            procedureChatId: activeSession.draftProcedureChatId,
            contactId,
            contactName,
            contactPhone,
            contactEmail,
          }),
        ]);
        const assistantResponse = draft.result?.response || 'Sem resposta.';
        setPublishedRun(published);
        setResult(draft.result);
        setTrace(draft.trace);
        onTrace(draft.trace || null);
        commitSuccessfulRun({
          sessionId,
          outboundMessage,
          assistantResponse,
          nextResult: draft.result,
          nextTrace: draft.trace,
          nextPublishedRun: published,
        });
      } else {
        const published = await runSinglePreview({
          snapshot: null,
          outboundMessage,
          chatHistory,
          procedureChatId: activeSession.procedureChatId,
          contactId,
          contactName,
          contactPhone,
          contactEmail,
        });
        const assistantResponse = published.result?.response || 'Sem resposta.';
        setPublishedRun(null);
        setResult(published.result);
        setTrace(published.trace);
        onTrace(published.trace || null);
        commitSuccessfulRun({
          sessionId,
          outboundMessage,
          assistantResponse,
          nextResult: published.result,
          nextTrace: published.trace,
          nextPublishedRun: null,
        });
      }
      setMessage('');
    } catch (previewError) {
      const message = previewError instanceof Error ? previewError.message : 'Falha ao testar o agente.';
      const errorTrace = (previewError as PreviewError).trace || null;
      setError(message);
      setResult(null);
      setTrace(errorTrace);
      setPublishedRun(null);
      onTrace(errorTrace);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <section className="rounded-[28px] border border-border bg-card shadow-sm">
        <div className="border-b border-border/60 px-6 py-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-foreground">Playground</h2>
              <p className="mt-1 text-sm text-muted-foreground">Teste o agente em conversas isoladas antes de publicar.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {traceSummary && (
                <Badge variant="outline" className="max-w-[260px] truncate rounded-full">
                  {traceSummary}
                </Badge>
              )}
              <Button type="button" onClick={startNewChat} className="rounded-full">
                <Plus className="mr-2 h-4 w-4" />
                Novo chat
              </Button>
            </div>
          </div>
          {stale && (
            <div className="mt-4 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
              Os testes com rascunho comparam a versao publicada com as alteracoes atuais.
            </div>
          )}
        </div>

        <div className="grid gap-4 p-5 sm:p-6 md:grid-cols-2 2xl:grid-cols-3">
          {sessions.map((session) => {
            const isActiveSession = session.id === activeSession.id;
            return (
              <div
                key={session.id}
                role="button"
                tabIndex={0}
                onClick={() => selectSession(session, true)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    selectSession(session, true);
                  }
                }}
                className={cn(
                  'group flex min-h-[210px] cursor-pointer flex-col rounded-[24px] border bg-background/80 p-5 text-left shadow-sm transition-all hover:border-primary/40 hover:bg-primary/5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary/40',
                  isActiveSession ? 'border-primary/45' : 'border-border'
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-muted text-primary">
                      <MessageSquareText className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate text-base font-semibold text-foreground">{session.title}</h3>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {session.contactName}{session.contactPhone ? ` - ${session.contactPhone}` : ''}
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 rounded-full text-muted-foreground opacity-100 hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100"
                    onClick={(event) => {
                      event.stopPropagation();
                      deleteSession(session.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <p className="mt-4 line-clamp-3 text-sm leading-6 text-muted-foreground">{getSessionPreview(session)}</p>

                <div className="mt-auto flex flex-wrap items-center gap-2 pt-5">
                  <Badge variant="outline" className="rounded-full">
                    {session.messages.length} mensagens
                  </Badge>
                  {session.lastTrace ? (
                    <Badge variant="outline" className={cn('rounded-full', traceBadgeClass(session.lastTrace.validator.decision))}>
                      {session.lastTrace.validator.decision}
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="rounded-full">
                      sem teste
                    </Badge>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">{formatSessionDate(session.updatedAt)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <Dialog open={isChatOpen} onOpenChange={setIsChatOpen}>
        <DialogContent className="flex h-[92vh] max-h-[92vh] max-w-5xl flex-col overflow-hidden rounded-[28px] border border-border bg-background p-0 shadow-2xl">
          <div className="grid min-h-0 flex-1 overflow-hidden lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
            
            {/* COLUNA DA ESQUERDA: CANVA DE CHAT */}
            <div className="flex flex-col min-h-0 border-r border-border bg-background">
              
              {/* Header do Chat (Estilo Webchat/WhatsApp) */}
              <div className="flex items-center justify-between border-b border-border bg-muted/10 px-5 py-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-violet-600 to-indigo-600 text-sm font-bold text-white shadow-sm">
                    {activeSession.contactName ? activeSession.contactName.charAt(0).toUpperCase() : 'C'}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground truncate">
                      {activeSession.contactName || 'Cliente Simulado'}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0"></span>
                      Online
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={clearCurrentChat} disabled={loading || activeSession.messages.length === 0} className="rounded-full h-8 text-xs text-muted-foreground">
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    Limpar Historico
                  </Button>
                </div>
              </div>

              {/* Corpo do Chat: Histórico de Mensagens */}
              <div className="flex-1 overflow-hidden p-4 flex flex-col min-h-0">
                <ChatTranscript messages={activeSession.messages} />
              </div>

              {/* Erros Operacionais caso ocorram */}
              {error && (
                <div className="mx-4 mb-2 flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span className="break-words">{error}</span>
                </div>
              )}

              {/* Barra de Digitação (Estilo WhatsApp) */}
              <div className="border-t border-border bg-background p-3 flex items-center gap-2">
                <Input
                  id="playground-message"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      runPreview();
                    }
                  }}
                  className="flex-1 rounded-full border-border/80 focus-visible:ring-1 focus-visible:ring-primary px-4 bg-muted/20 text-sm h-10"
                  placeholder="Digite uma pergunta simulando o cliente..."
                  disabled={loading}
                />
                <Button onClick={runPreview} disabled={!canRun || loading} size="icon" className="rounded-full shrink-0 h-10 w-10">
                  {loading ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>

            </div>

            {/* COLUNA DA DIREITA: CONFIGURAÇÕES E TRACE DE IA */}
            <div className="flex flex-col min-h-0 overflow-y-auto bg-muted/15 p-5 border-l border-border/30 gap-4">
              
              {/* Header do Debug/Painel */}
              <div className="flex items-center justify-between border-b border-border/60 pb-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Depuracao da IA</h3>
                  <p className="text-[11px] text-muted-foreground">Analise as decisoes tomadas pelo modelo.</p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => deleteSession(activeSession.id)} className="rounded-full h-8 text-[11px] text-destructive hover:bg-destructive/5 hover:text-destructive">
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  Apagar Conversa
                </Button>
              </div>

              {/* Acordeão / Painel Colapsável de Identidade Simulada */}
              <div className="rounded-2xl border border-border bg-card p-3.5 shadow-sm">
                <button
                  type="button"
                  onClick={() => setShowIdentityConfig(!showIdentityConfig)}
                  className="flex w-full items-center justify-between text-left focus:outline-none bg-transparent"
                >
                  <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                    <UserRound className="h-4 w-4 text-primary/70" />
                    Identidade do Cliente
                  </span>
                  <span className="text-xs text-muted-foreground hover:text-foreground">
                    {showIdentityConfig ? 'Recolher ✕' : 'Expandir ⚙️'}
                  </span>
                </button>
                
                {showIdentityConfig && (
                  <div className="mt-3.5 space-y-3.5 border-t border-border/50 pt-3.5">
                    <div className="space-y-1.5">
                      <Label htmlFor="playground-contact-search" className="text-xs">Buscar no CRM</Label>
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="playground-contact-search"
                          value={contactSearch}
                          onChange={(event) => setContactSearch(event.target.value)}
                          placeholder="Nome ou telefone..."
                          className="pl-8 text-xs h-8.5 rounded-lg"
                        />
                      </div>
                    </div>

                    {contactSearch.trim() && (
                      <div className="rounded-xl border border-border bg-muted/20 p-1.5">
                        <div className="flex items-center justify-between gap-2 px-1.5 py-1">
                          <span className="text-[10px] font-semibold text-muted-foreground uppercase flex items-center gap-1">
                            <Database className="h-3 w-3" /> Resultados
                          </span>
                          <Button type="button" variant="ghost" size="sm" onClick={useManualNumber} className="h-6 rounded-full px-2 text-[10px]">
                            <Phone className="mr-1 h-3 w-3" /> Usar digitado
                          </Button>
                        </div>
                        <div className="max-h-32 overflow-y-auto mt-1 space-y-0.5">
                          {contactsLoading ? (
                            <div className="flex items-center gap-1.5 px-2 py-2 text-xs text-muted-foreground">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Buscando...
                            </div>
                          ) : contactsError ? (
                            <div className="px-2 py-2 text-xs text-destructive">{contactsError}</div>
                          ) : contactOptions.length > 0 ? (
                            contactOptions.map((contact) => {
                              const selected = activeSession.contactId === contact.id;
                              const phone = contact.phone_number_jid || contact.phone || '';
                              return (
                                <button
                                  key={contact.id}
                                  type="button"
                                  onClick={() => selectContact(contact)}
                                  className={cn(
                                    'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-muted/70',
                                    selected && 'bg-primary/10 text-primary'
                                  )}
                                >
                                  <span className="block truncate text-xs font-medium">{contact.name || phone}</span>
                                </button>
                              );
                            })
                          ) : (
                            <div className="px-2 py-2 text-xs text-muted-foreground">Nenhum contato encontrado.</div>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="grid gap-2 grid-cols-2">
                      <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground">Nome de Teste</Label>
                        <Input
                          value={activeSession.contactName}
                          onChange={(event) => {
                            const contactName = event.target.value;
                            updateActiveSession((session) => ({
                              ...session,
                              contactName,
                              updatedAt: new Date().toISOString(),
                            }));
                          }}
                          className="text-xs h-8"
                          placeholder="Nome simulado"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground">Numero de Teste</Label>
                        <Input
                          value={activeSession.contactPhone || ''}
                          onChange={(event) => {
                            const contactPhone = event.target.value;
                            updateActiveSession((session) => ({
                              ...session,
                              contactId: null,
                              contactPhone,
                              updatedAt: new Date().toISOString(),
                            }));
                          }}
                          className="text-xs h-8"
                          placeholder="Numero simulado"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Status do Teste */}
              <div className="flex h-9 items-center gap-2 rounded-xl border border-border/80 bg-background px-3 text-xs text-muted-foreground shadow-sm">
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> : trace ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Bot className="h-3.5 w-3.5" />}
                <span className="font-medium">{loading ? 'A IA esta digitando...' : trace ? 'Analise de trace disponivel' : 'Aguardando envio'}</span>
              </div>

              {/* Comparador de Rascunhos e Traces */}
              {shouldCompare && result?.response && publishedRun && (
                <div className="grid gap-3">
                  <ResponsePreview title="Versao Publicada" result={publishedRun.result} />
                  <ResponsePreview title="Versao em Rascunho" result={result} />
                </div>
              )}

              {shouldCompare && compareRows.length > 0 && (
                <div className="rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                      Comparacao de Versoes
                    </div>
                    <Badge variant="outline" className="rounded-full text-[9px] bg-muted/40">
                      Publicado x Rascunho
                    </Badge>
                  </div>
                  <div className="grid gap-1.5">
                    {compareRows.map((row) => (
                      <TraceCompareRow key={row.label} label={row.label} published={row.published} draft={row.draft} />
                    ))}
                  </div>
                </div>
              )}

              {/* Traces Detalhados da IA */}
              {trace && (
                <div className="grid gap-3">
                  {trace.procedure && (
                    <TraceSection title="Procedimento (PRE)" value={trace.procedure.active ? trace.procedure.status || 'active' : trace.procedure.enabled ? 'ready' : 'none'}>
                      <div className="space-y-1">
                        <div>Procedimentos carregados: {trace.procedure.compiledCount}</div>
                        <div className="font-semibold text-foreground">Ativo: {trace.procedure.procedureName || 'nenhum'}</div>
                        <div>Passos: {trace.procedure.executedSteps.join(', ') || 'nenhum'}</div>
                        {trace.procedure.matchReason && <div className="text-[10px] leading-4 mt-1 border-t border-border/40 pt-1">Motivo: {trace.procedure.matchReason}</div>}
                      </div>
                    </TraceSection>
                  )}

                  <TraceSection title="Intencao Detectada" value={trace.intent.intent}>
                    <div className="space-y-1">
                      <div>Confianca: {(trace.intent.confidence * 100).toFixed(0)}%</div>
                      <div>Workflow associado: {trace.intent.workflowId}</div>
                      <div className="text-[10px] leading-4 mt-1 border-t border-border/40 pt-1">Motivo: {trace.intent.reason}</div>
                    </div>
                  </TraceSection>

                  <TraceSection title="RAG (Base de Conhecimento)" value={trace.rag.knowledgeCoverage}>
                    <div className="space-y-1">
                      <div>Busca: {trace.rag.strategy}</div>
                      {trace.ragDiagnostics && (
                        <div>Matches: Vetor ({(trace.ragDiagnostics as any).vectorMatches}) | Chave ({(trace.ragDiagnostics as any).keywordMatches})</div>
                      )}
                      <div className="mt-1 border-t border-border/40 pt-1">
                        Documentos: {trace.rag.selected.length > 0 ? trace.rag.selected.map((doc) => doc.name).join(', ') : 'nenhum'}
                      </div>
                    </div>
                  </TraceSection>

                  <TraceSection title="Workflow Executado" value={trace.workflow.executionMode}>
                    <div className="space-y-1">
                      <div className="font-medium text-foreground">{trace.workflow.reason}</div>
                      {trace.workflow.missingSlots.length > 0 && (
                        <div className="text-destructive font-semibold">Slots ausentes: {trace.workflow.missingSlots.join(', ')}</div>
                      )}
                    </div>
                  </TraceSection>

                  <TraceSection title="Planejador de Ferramentas" value={trace.toolPlanner.repairReason || (trace.toolPlanner.rejectedActions.length ? 'rejected' : 'accepted')}>
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
                    </div>
                  </TraceSection>

                  <TraceSection title="Validador de Resposta" value={trace.validator.decision}>
                    <div className="flex items-start gap-2">
                      <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                      <span>{trace.validator.reasons.join(', ') || 'Resposta validada com sucesso.'}</span>
                    </div>
                  </TraceSection>
                </div>
              )}

            </div>

          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
