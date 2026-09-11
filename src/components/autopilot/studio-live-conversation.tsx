'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ExternalLink, Loader2, Paperclip, RotateCcw, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { createClientUuid } from '@/lib/client-uuid';
import { startAgentStudioLiveTestAction, getAgentStudioLiveTestAction, sendAgentStudioLiveTestAction } from '@/actions/agent-studio';
import type { AgentStudioDocument } from '@/services/agent-studio/types';
import type { LiveTestView } from '@/services/agent-studio/live-test-store';
import { studioFlowInputs } from '@/services/agent-studio/flow-inputs';
import { StudioTurnMetrics } from './studio-turn-metrics';

export function StudioLiveConversation({ document, resetKey, teams = [] }: { document: AgentStudioDocument; resetKey: number; teams?: { id: string; name: string }[] }) {
  const [view, setView] = useState<LiveTestView | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('Cliente de teste');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [flowJson, setFlowJson] = useState('{}');
  const generation = useRef(0);
  const busyRef = useRef(false);
  const resetSeen = useRef(resetKey);
  const startId = useRef<string | null>(null);
  const pending = useRef<{ id: string; text: string; file: File | null } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const storageKey = `studio-live-test:${document.workspaceId}:${document.id}`;
  const sessionId = view?.sessionId;
  const changed = view && JSON.stringify({ ...view.document, draftRevision: 0, updatedAt: '' }) !== JSON.stringify({ ...document, draftRevision: 0, updatedAt: '' });
  const reasoningEnabled = view?.document.resolveStage.conversationMode === 'adaptive' && view.document.resolveStage.reasoning?.enabled;
  const done = Boolean(view?.expired || view?.chat.status === 'encerrados' || (view && (['failed', 'cancelled'].includes(view.state.status)
    || (view.state.status === 'resolved' && !reasoningEnabled))));
  const blocked = busy || loading || Boolean(view?.busy);
  const reset = useCallback(() => {
    if (busyRef.current) return;
    generation.current++; startId.current = null; pending.current = null;
    setView(null); setText(''); setFile(null); setError(''); setLoading(false);
    try { sessionStorage.removeItem(storageKey); } catch { /* Storage can be unavailable in private mode. */ }
  }, [storageKey]);

  useEffect(() => {
    const current = ++generation.current;
    let saved: string | null = null;
    try { saved = sessionStorage.getItem(storageKey); } catch { /* Optional recovery only. */ }
    if (!saved) { setLoading(false); return () => { generation.current = current + 1; }; }
    startId.current = saved;
    void getAgentStudioLiveTestAction(document.id, saved).then((result) => {
      if (current !== generation.current) return;
      if (result.success) setView(result.view);
      else setError(result.error);
    }).catch(() => { if (current === generation.current) setError('Não foi possível recuperar o teste. Tente novamente.'); })
      .finally(() => { if (current === generation.current) setLoading(false); });
    return () => { generation.current = current + 1; };
  }, [document.id, storageKey]);
  useEffect(() => { if (resetSeen.current !== resetKey) { resetSeen.current = resetKey; reset(); } }, [resetKey, reset]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest' }); }, [view?.messages, busy, error]);
  // Includes real human replies from the inbox after a handoff. Never dispatches AI or tools.
  useEffect(() => {
    if (!sessionId || loading) return;
    let disposed = false, polling = false;
    const timer = setInterval(() => {
      if (busyRef.current || polling) return;
      polling = true;
      void getAgentStudioLiveTestAction(document.id, sessionId).then((result) => {
        if (!disposed && !busyRef.current && result.success) setView(result.view);
      }).catch(() => {}).finally(() => { polling = false; });
    }, 5000);
    return () => { disposed = true; clearInterval(timer); };
  }, [document.id, sessionId, loading]);

  const start = async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    const current = generation.current;
    try {
      const flowInput: unknown = JSON.parse(flowJson);
      if (!flowInput || typeof flowInput !== 'object' || Array.isArray(flowInput)) throw new Error('O contexto do fluxo precisa ser um objeto JSON.');
      startId.current ||= createClientUuid();
      try { sessionStorage.setItem(storageKey, startId.current); } catch { /* Optional recovery only. */ }
      const result = await startAgentStudioLiveTestAction(document.id, { sessionId: startId.current, document, contact: { name, phone, email }, flowInput, realExecutionConfirmed: true });
      if (current !== generation.current) return;
      if (!result.success) throw new Error(result.error);
      setView(result.view);
      try { sessionStorage.setItem(storageKey, result.view.sessionId); } catch { /* Session remains usable without storage. */ }
    } catch (error) { if (current === generation.current) setError(error instanceof Error ? error.message : 'Não foi possível iniciar o teste.'); }
    finally { busyRef.current = false; if (current === generation.current) setBusy(false); }
  };
  const send = async (value = text) => {
    if (!view || blocked || busyRef.current || done || (!value.trim() && !file)) return;
    busyRef.current = true; setBusy(true); setError('');
    const current = generation.current;
    const message = value.trim() || `Arquivo: ${file!.name}`;
    // Keep the request identity after an uncertain network result. Retrying cannot repeat a write.
    if (!pending.current || pending.current.text !== message || pending.current.file !== file) pending.current = { id: createClientUuid(), text: message, file };
    const payload = new FormData(); payload.set('sessionId', view.sessionId); payload.set('messageId', pending.current.id); payload.set('message', message);
    if (file) payload.set('file', file);
    try {
      const result = await sendAgentStudioLiveTestAction(document.id, payload);
      if (current !== generation.current) return;
      if (!result.success) throw new Error(result.error);
      pending.current = null; setText(''); setFile(null); setView(result.view);
      if (fileInput.current) fileInput.current.value = '';
    } catch (error) {
      if (current !== generation.current) return;
      setError(error instanceof Error ? error.message : 'Falha de conexão. Consulte o histórico e tente novamente.');
      const refreshed = await getAgentStudioLiveTestAction(document.id, view.sessionId).catch(() => null);
      if (current === generation.current && refreshed?.success) setView(refreshed.view);
    } finally { busyRef.current = false; if (current === generation.current) setBusy(false); }
  };
  const procedure = view?.document.resolveStage.procedures.find((p) => p.id === view.state.procedureId);
  const transferTeam = teams.find((team) => team.id === view?.chat.team_id || team.name === view?.chat.team_id)?.name || view?.chat.team_id || 'Equipe responsável';
  const field = view && [...view.document.understandStage.initialFields, ...(procedure?.steps.flatMap((step) => step.collectField ? [step.collectField] : []) || [])].find((field) => field.variableKey === view.state.pendingField);
  return <aside className="flex min-h-0 flex-1 flex-col bg-[#070e17] text-slate-100 [color-scheme:dark]" aria-label="Teste de ponta a ponta">
    <div className="shrink-0 border-b border-slate-800 px-4 py-3 text-[11px] text-slate-300">
      <strong className="text-emerald-400">Ponta a ponta · execução real</strong>
      <p className="mt-1">IA, fontes, APIs, MCP, CRM, transferências e encerramentos reais. Canal: chat do Estúdio conectado ao Inbox.</p>
      <p className="mt-2 text-amber-200"><AlertTriangle className="mr-1 inline h-3 w-3" />Pode alterar sistemas externos e consumir créditos. Reiniciar não desfaz ações.</p>
      {view && <><p className="mt-2 break-all">Modelo: {view.model}</p><Link href={`/inbox/${view.chatId}`} target="_blank" className="mt-1 inline-flex items-center gap-1 text-sky-300 underline">Abrir atendimento {view.chat.protocol}<ExternalLink className="h-3 w-3" /></Link></>}
    </div>
    {changed && <div className="border-b border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">O rascunho mudou. Este atendimento mantém a configuração inicial; inicie outro teste para usar as alterações.</div>}
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
      {loading && <p className="text-xs text-slate-400">Recuperando teste...</p>}
      {!view && !loading && <div className="space-y-3 text-xs">
        <p className="text-slate-400">Será criado um contato identificado como teste e um atendimento real. As integrações usarão as conexões configuradas e os dados que você informar.</p>
        <label className="block">Nome do contato<Input value={name} onChange={(e) => setName(e.target.value)} disabled={busy} className="mt-1 border-slate-600 bg-slate-900 text-slate-100 caret-slate-100 placeholder:text-slate-400 focus-visible:ring-emerald-400 ring-offset-slate-900" /></label>
        <label className="block">Telefone para consultas (opcional)<Input value={phone} onChange={(e) => setPhone(e.target.value)} disabled={busy} className="mt-1 border-slate-600 bg-slate-900 text-slate-100 caret-slate-100 placeholder:text-slate-400 focus-visible:ring-emerald-400 ring-offset-slate-900" /></label>
        <label className="block">E-mail (opcional)<Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} className="mt-1 border-slate-600 bg-slate-900 text-slate-100 caret-slate-100 placeholder:text-slate-400 focus-visible:ring-emerald-400 ring-offset-slate-900" /></label>
        <details><summary className="cursor-pointer">Contexto de entrada do fluxo</summary><p className="my-2 text-slate-400">{studioFlowInputs(document).map((entry) => `${entry.key}${entry.required ? ' (obrigatório)' : ''}`).join(', ') || 'Nenhuma entrada exigida.'}</p><Textarea value={flowJson} onChange={(e) => setFlowJson(e.target.value)} disabled={busy} className="border-slate-600 bg-slate-900 font-mono text-xs text-slate-100 caret-slate-100 placeholder:text-slate-400 focus-visible:ring-emerald-400 ring-offset-slate-900" aria-label="Contexto de entrada JSON" /></details>
        <Button onClick={() => void start()} disabled={busy || !name.trim()} className="w-full bg-emerald-600">{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Iniciar teste com ações reais</Button>
      </div>}
      {view?.messages.map((message) => <div key={message.id} className={`flex flex-col ${message.role === 'user' ? 'items-end' : 'items-start'}`}>
        <span className="mb-1 text-[10px] text-slate-400">{message.role === 'user' ? 'Você como cliente' : view.document.appearance.botTitle || 'Atendimento'}</span>
        <div className={`max-w-[95%] rounded-xl p-3 text-xs text-slate-900 ${message.role === 'user' ? 'bg-emerald-100' : 'bg-white'}`}><p className="whitespace-pre-wrap break-words">{message.text}</p>{message.attachmentUrl && <a href={message.attachmentUrl} target="_blank" rel="noreferrer" className="mt-1 block text-sky-700 underline">{message.attachmentType === 'image' ? <img src={message.attachmentUrl} alt={message.text || 'Foto enviada no atendimento'} loading="lazy" referrerPolicy="no-referrer" className="max-h-72 max-w-full rounded-lg object-contain" /> : 'Abrir anexo'}</a>}<p className="mt-1 text-right text-[9px] text-slate-500">{message.time}</p></div>
      </div>)}
      {view && !view.messages.length && <p className="text-xs text-slate-400">Atendimento criado. Envie uma mensagem como cliente para começar.</p>}
      {view?.state.status === 'transferred' && <div role="status" className="rounded-xl border border-emerald-400/25 bg-emerald-400/10 p-3 text-xs text-emerald-50"><div className="flex items-center justify-between gap-2"><strong>Execução real concluída</strong><span className="rounded-full bg-emerald-300/15 px-2 py-0.5 text-[9px] font-bold uppercase text-emerald-200">Executada</span></div><dl className="mt-2 grid grid-cols-[72px_1fr] gap-x-2 gap-y-1 text-[11px]"><dt className="text-emerald-200/70">Ação</dt><dd>Transferir atendimento</dd><dt className="text-emerald-200/70">Destino</dt><dd>{transferTeam}</dd><dt className="text-emerald-200/70">Resultado</dt><dd>Atendimento transferido ou colocado na fila da equipe.</dd></dl><p className="mt-2 text-[10px] text-emerald-100/80">Você pode continuar escrevendo como cliente e acompanhar as respostas humanas aqui.</p></div>}
      {done && <p className="text-xs text-slate-400">Teste encerrado ou expirado. O histórico e as alterações realizadas foram preservados.</p>}
      {field?.options?.map((option) => <button key={option} disabled={blocked || done} onClick={() => void send(option)} className="mr-1 rounded border border-slate-600 px-2 py-1 text-xs">{option}</button>)}
      {busy && view && <p role="status" className="flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-3 w-3 animate-spin" />Executando o atendimento real...</p>}
      {error && <p role="alert" className="rounded border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">{error}</p>}
      <div ref={bottom} />
    </div>
    {view && <>
      <StudioTurnMetrics metrics={view.state.reasoning?.lastTurnMetrics} />
      <details className="shrink-0 border-t border-slate-800 p-3 text-xs"><summary className="cursor-pointer">Execução e dados retornados · {view.state.status}</summary>
        <div className="max-h-48 space-y-2 overflow-auto py-2"><ol>{view.state.events.map((event, index) => <li key={index}>{event.label} · {event.kind}</li>)}</ol><pre className="whitespace-pre-wrap break-all text-[10px]">{JSON.stringify(view.state.values, null, 2)}</pre></div>
      </details>
      <form onSubmit={(event) => { event.preventDefault(); void send(); }} className="shrink-0 border-t border-slate-800 p-3">
        {file && <p className="mb-2 break-all text-[11px] text-slate-300">{file.name} <button type="button" onClick={() => setFile(null)} disabled={blocked}>Remover</button></p>}
        <div className="flex gap-1"><input ref={fileInput} type="file" className="hidden" accept="image/jpeg,image/png,image/webp,application/pdf,text/plain,text/csv" onChange={(event) => {
          const selected = event.target.files?.[0] || null;
          if (selected && selected.size > 9 * 1024 * 1024) { setError('O arquivo deve ter até 9 MB.'); event.target.value = ''; return; }
          setFile(selected);
        }} />
          <Button type="button" size="icon" variant="ghost" aria-label="Anexar arquivo de teste" disabled={blocked || done} onClick={() => fileInput.current?.click()} className="h-8 w-8 shrink-0"><Paperclip className="h-4 w-4" /></Button>
          <Input aria-label="Mensagem de teste real" maxLength={8000} value={text} onChange={(e) => setText(e.target.value)} disabled={blocked || done} placeholder="Escreva como cliente..." className="h-8 min-w-0 border-slate-600 bg-slate-900 text-xs text-slate-100 caret-slate-100 placeholder:text-slate-400 focus-visible:ring-emerald-400 ring-offset-slate-900" />
          <Button type="submit" size="icon" disabled={blocked || done || (!text.trim() && !file)} aria-label="Enviar mensagem real" className="h-8 w-8 shrink-0 bg-emerald-600"><Send className="h-3.5 w-3.5" /></Button></div>
      </form>
    </>}
    <button type="button" onClick={reset} disabled={blocked} className="flex shrink-0 items-center justify-center gap-2 border-t border-slate-800 p-3 text-xs text-slate-400 hover:text-white"><RotateCcw className="h-3 w-3" />{view ? 'Iniciar outro teste (mantém os registros)' : 'Limpar tentativa'}</button>
  </aside>;
}
