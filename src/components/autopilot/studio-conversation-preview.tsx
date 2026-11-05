'use client';

import { createClientUuid } from '@/lib/client-uuid';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Check, Info, Loader2, RotateCcw, Send, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { testAgentStudioConversationAction } from '@/actions/agent-studio';
import { createStudioSession, type StudioSession } from '@/services/agent-studio/engine';
import type { AgentStudioDocument } from '@/services/agent-studio/types';
import { StudioLiveConversation } from './studio-live-conversation';
import { StudioTurnMetrics } from './studio-turn-metrics';

type TeamOption = { id: string; name: string };

export function StudioConversationPreview({ document, resetKey, teams = [] }: { document: AgentStudioDocument; resetKey: number; teams?: TeamOption[] }) {
  const [mode, setMode] = useState<'live' | 'simulation'>('live');
  return <div className="flex h-full min-h-0 w-full flex-col border-l border-slate-800 bg-[#070e17] lg:w-80">
    <div className="flex shrink-0 gap-1 border-b border-slate-800 p-2 pr-10 text-xs lg:pr-2" aria-label="Modo do teste">
      <button type="button" aria-pressed={mode === 'live'} onClick={() => setMode('live')} className={`flex-1 rounded px-2 py-2 ${mode === 'live' ? 'bg-emerald-600 text-white' : 'text-slate-400'}`}>Ponta a ponta</button>
      <button type="button" aria-pressed={mode === 'simulation'} onClick={() => setMode('simulation')} className={`flex-1 rounded px-2 py-2 ${mode === 'simulation' ? 'bg-slate-700 text-white' : 'text-slate-400'}`}>Simular ações</button>
    </div>
    <div className={mode === 'live' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}><StudioLiveConversation document={document} resetKey={resetKey} teams={teams} /></div>
    {mode === 'simulation' && <div className="min-h-0 flex-1"><StudioSimulatedConversationPreview document={document} resetKey={resetKey} teams={teams} /></div>}
  </div>;
}

function StudioSimulatedConversationPreview({ document, resetKey, teams }: { document: AgentStudioDocument; resetKey: number; teams: TeamOption[] }) {
  const [snapshot, setSnapshot] = useState(document);
  const [state, setState] = useState<StudioSession>(() => createStudioSession(document.id, 'simulation', createClientUuid()));
  const [messages, setMessages] = useState<{ id: string; role: 'user' | 'bot'; text: string; time: string; imageUrl?: string }[]>([]);
  const [text, setText] = useState('');
  const [samples, setSamples] = useState<Record<string, string>>({});
  const [failureStep, setFailureStep] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [model, setModel] = useState('');
  const busyRef = useRef(false);
  const generationRef = useRef(0);
  const lastResetKey = useRef(resetKey);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const accent = ({ emerald: 'bg-[#dcf8c6]', blue: 'bg-sky-100', purple: 'bg-purple-100', rose: 'bg-rose-100' } as Record<string, string>)[snapshot.appearance.colorTheme] || 'bg-[#dcf8c6]';
  const safeAvatarUrl = snapshot.avatarUrl && /^https:\/\/[^\s"'()\\]+$/i.test(snapshot.avatarUrl) ? snapshot.avatarUrl : '';
  const changed = JSON.stringify({ ...snapshot, draftRevision: 0, updatedAt: '' }) !== JSON.stringify({ ...document, draftRevision: 0, updatedAt: '' });
  const reset = useCallback(() => {
    generationRef.current += 1; busyRef.current = false; setBusy(false); setError(''); setModel('');
    setSnapshot(structuredClone(document)); setState(createStudioSession(document.id, 'simulation', createClientUuid()));
    setMessages([]); setText(''); input.current?.focus();
  }, [document]);
  useEffect(() => { if (lastResetKey.current !== resetKey) { lastResetKey.current = resetKey; reset(); } }, [resetKey, reset]);
  useEffect(() => () => { generationRef.current += 1; }, []);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest' }); }, [messages, busy, error]);
  const procedure = snapshot.resolveStage.procedures.find((item) => item.id === state.procedureId);
  const field = [...snapshot.understandStage.initialFields, ...(procedure?.steps.flatMap((step) => step.collectField ? [step.collectField] : []) || [])].find((item) => item.variableKey === state.pendingField);
  const integrationSteps = snapshot.resolveStage.procedures.flatMap((item) => item.steps).filter((step) => step.httpRequest || step.mcpTool || ['sgp_fetch_contracts', 'sgp_fetch_contact_panel_data'].includes(step.nativeActionType || ''));
  const transferStep = procedure?.steps.findLast((step) => step.type === 'handoff');
  const transferTarget = transferStep?.handoffTeam || snapshot.concludeStage.handoffTeam;
  const transferTeam = teams.find((team) => team.id === transferTarget || team.name === transferTarget)?.name || (/^[0-9a-f-]{36}$/i.test(transferTarget || '') ? 'Equipe configurada' : transferTarget || 'Equipe responsável');
  const send = async (value = text) => {
    if (!value.trim() || busyRef.current || changed) return;
    busyRef.current = true; setBusy(true); setText(''); setError('');
    const generation = generationRef.current;
    const id = createClientUuid(); const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    setMessages((previous) => [...previous, { id, role: 'user', text: value.trim(), time }]);
    try {
      const result = await testAgentStudioConversationAction(snapshot.id, {
        document: snapshot, state, message: value.trim(), messageId: id,
        history: messages.slice(-40).map(({ role, text }) => ({ role, text })), samples, failureStep,
      });
      if (generation !== generationRef.current) return;
      if (!result.success) throw new Error(result.error);
      setModel(result.model);
      setState(result.state);
      const earlierOperations = new Set(state.reasoning?.operations.map((operation) => operation.id) || []);
      const photos = (result.state.reasoning?.operations || []).filter((operation) => !earlierOperations.has(operation.id)
        && operation.status === 'succeeded' && operation.presentedProduct?.url.startsWith('https://'));
      setMessages((previous) => [...previous, ...photos.map((operation) => ({ id: `${operation.id}:photo`, role: 'bot' as const,
        text: operation.presentedProduct!.caption, imageUrl: operation.presentedProduct!.url, time })),
        { id: `${id}:bot`, role: 'bot', text: result.response || 'Teste concluído. Recomece para testar outro atendimento.', time }]);
    } catch (error) {
      if (generation !== generationRef.current) return;
      setMessages((previous) => previous.filter((message) => message.id !== id));
      setText(value.trim());
      setError(error instanceof Error ? error.message : 'Não foi possível conversar com a IA. Tente novamente.');
    } finally { if (generation === generationRef.current) { busyRef.current = false; setBusy(false); } }
  };
  return <aside className="flex h-full w-full shrink-0 flex-col border-l border-slate-800 bg-[#070e17] text-slate-100 [color-scheme:dark] lg:w-80" aria-label="Prévia da conversa">
    <div className="flex h-11 shrink-0 items-center justify-between border-b border-slate-800 bg-[#0a121d] px-4 pr-10 lg:pr-4"><span className="text-xs font-bold">Prévia da conversa</span><Info className="h-3.5 w-3.5 text-slate-400" /></div>
    <div className="border-b border-slate-800 px-4 py-2 text-[11px] text-slate-400"><span className="text-emerald-400">IA real</span> · rascunho atual · ações simuladas{model && <span className="mt-1 block break-all">Modelo: {model}</span>}<span className="mt-1 block">Usa o provedor configurado e pode consumir créditos de IA. Use dados fictícios.</span><strong className="mt-2 block rounded-lg border border-amber-400/25 bg-amber-400/10 p-2 font-medium leading-relaxed text-amber-100">Neste modo, APIs, CRM, transferências e encerramentos não são executados. O painel abaixo mostra o que o agente tentaria fazer.</strong></div>
    {changed && <div className="border-b border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">O rascunho mudou. <button onClick={reset} className="underline">Recomeçar com as alterações</button></div>}
    <details className="border-b border-slate-800 px-4 py-2 text-xs">
      <summary className="cursor-pointer text-slate-300">Dados do teste</summary>
      <div className="max-h-64 space-y-3 overflow-auto py-3">
        <p className="text-[11px] text-slate-400">Use dados fictícios. Estes valores representam resultados de integrações, não consultam sistemas.</p>
        {integrationSteps.map((step) => <label key={step.id} className="block">{step.title} · resposta fictícia JSON<Textarea className="mt-1 min-h-24 border-slate-600 bg-slate-900 text-xs text-slate-100 caret-slate-100 placeholder:text-slate-400 focus-visible:ring-emerald-400 ring-offset-slate-900" value={samples[step.id] || ''} onChange={(event) => setSamples((old) => ({ ...old, [step.id]: event.target.value }))} placeholder={step.nativeActionType?.startsWith('sgp_') ? '{"customerName":"Cliente de teste","contracts":[{"id":"1","label":"Instalação de teste","connectionStatus":"online"}],"invoices":[],"openInvoices":0,"overdueInvoices":0}' : '{"data": {}}'} /><span className="mt-1 block text-[10px] text-slate-400">O teste usa o mesmo mapeamento da publicação: {(step.httpRequest?.outputMappings || step.mcpTool?.outputMappings || []).map((output) => output.chipLabel).join(', ') || 'sem resultados selecionados'}.</span></label>)}
        <p className="text-[11px] text-slate-400">As respostas usam a IA e as fontes selecionadas no agente. Apenas os resultados das integrações são fictícios.</p>
        <label className="block">Simular falha<select value={failureStep} onChange={(event) => setFailureStep(event.target.value)} className="mt-1 w-full rounded border border-slate-700 bg-slate-900 p-2"><option value="">Nenhuma</option>{integrationSteps.map((step) => <option key={step.id} value={step.id}>{step.title}</option>)}</select></label>
      </div>
    </details>
    <StudioTurnMetrics metrics={state.reasoning?.lastTurnMetrics} />
    {state.events.length > 0 && <details className="border-b border-purple-500/20 bg-purple-500/10 px-4 py-2 text-[11px] text-purple-200">
      <summary className="cursor-pointer"><Sparkles className="mr-1 inline h-3 w-3" />{state.events.at(-1)?.label} · {state.status === 'waiting_input' ? 'Aguardando resposta' : state.status === 'resolved' ? 'Resolvido' : state.status === 'transferred' ? 'Transferência simulada' : 'Execução'}</summary>
      <ol className="mt-2 max-h-40 overflow-auto space-y-1">{state.events.map((event, index) => <li key={index}>{index + 1}. {event.label} · {event.kind === 'completed' ? 'Concluído' : event.kind === 'waiting_confirmation' ? 'Confirmar' : event.kind === 'outcome_unknown' ? 'Resultado incerto' : event.kind === 'failed' ? 'Falhou' : event.kind === 'collected' ? 'Dado válido' : event.kind === 'memory_reused' ? 'Reutilizado da memória' : event.kind === 'procedure_selected' ? 'Procedimento escolhido' : event.kind === 'transferred' ? 'Transferido' : event.kind === 'branch_selected' ? 'Caminho escolhido' : 'Aguardando'}</li>)}</ol>
    </details>}
    {state.status === 'transferred' && <div role="status" className="border-b border-amber-400/25 bg-amber-400/10 px-4 py-3 text-[11px] text-amber-50">
      <div className="flex items-center justify-between gap-2"><strong>Comprovante da simulação</strong><span className="rounded-full bg-amber-300/15 px-2 py-0.5 text-[9px] font-bold uppercase text-amber-200">Não executada</span></div>
      <dl className="mt-2 grid grid-cols-[72px_1fr] gap-x-2 gap-y-1"><dt className="text-amber-200/70">Ação</dt><dd>Transferir atendimento</dd><dt className="text-amber-200/70">Destino</dt><dd>{transferTeam}</dd><dt className="text-amber-200/70">Resultado</dt><dd>Nenhum atendimento real foi alterado.</dd></dl>
    </div>}
    {Object.keys(state.sessionFacts || {}).length > 0 && <details className="border-b border-emerald-500/20 bg-emerald-500/5 px-4 py-2 text-[11px] text-emerald-100">
      <summary className="cursor-pointer">Memória desta conversa · {Object.keys(state.sessionFacts || {}).length} fato(s)</summary>
      <ul className="mt-2 space-y-1">{Object.entries(state.sessionFacts || {}).map(([key, fact]) => <li key={key} className="flex justify-between gap-3"><span>{fact.labels[0] || key}</span><span className="max-w-36 truncate text-emerald-300">{fact.isSensitive ? 'Dado protegido' : String(fact.value)}</span></li>)}</ul>
    </details>}
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
      {!messages.length && <div className="space-y-3 text-xs text-slate-400"><p>Escreva como um cliente: a IA responderá seguindo o rascunho, com memória desta conversa. Você também pode testar um procedimento:</p>{snapshot.resolveStage.procedures.filter((p) => p.status !== 'archived').map((p) => <button key={p.id} disabled={busy || changed} onClick={() => void send(p.name)} className="block w-full rounded-lg border border-slate-700 p-2 text-left text-slate-200 hover:bg-slate-800">{p.name}</button>)}</div>}
      {messages.map((message) => <div key={message.id} className={`flex flex-col ${message.role === 'user' ? 'items-end' : 'items-start'}`}>
        <span className="mb-0.5 px-1 text-[9px] text-slate-400">{message.role === 'user' ? 'Cliente' : snapshot.appearance.botTitle}</span>
        <div className={`flex max-w-[95%] items-end gap-1.5 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}>{message.role === 'bot' && snapshot.appearance.showAvatar && <span aria-label="Avatar do agente" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-800 bg-cover bg-center" style={safeAvatarUrl ? { backgroundImage: `url("${safeAvatarUrl}")` } : undefined}>{!safeAvatarUrl && <Bot className="h-3.5 w-3.5" />}</span>}<div className={`rounded-2xl p-3 text-xs leading-relaxed text-slate-900 ${message.role === 'user' ? `rounded-tr-none ${accent}` : 'rounded-tl-none bg-white'}`}><p className="whitespace-pre-wrap break-words">{message.text}</p>{message.imageUrl && <img src={message.imageUrl} alt={message.text} referrerPolicy="no-referrer" loading="lazy" className="mt-2 max-h-72 max-w-full rounded-lg object-contain" />}<div className="mt-1 flex justify-end gap-1 text-[9px] text-slate-500">{message.time}{message.role === 'user' && <Check className="h-3 w-3 text-emerald-600" />}</div></div></div>
      </div>)}
      {field?.options?.map((option) => <button key={option} disabled={busy || changed} onClick={() => void send(option)} className="mr-1 rounded-lg border border-slate-600 px-2 py-1 text-xs">{option}</button>)}
      {busy && <div role="status" className="flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" />A IA está respondendo...</div>}
      {error && <div role="alert" className="rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-xs text-red-200">{error}</div>}
      <div ref={bottom} />
    </div>
    <form onSubmit={(event) => { event.preventDefault(); void send(); }} className="border-t border-slate-800 bg-[#0a121d] p-3">
      <div className="flex gap-2"><Input ref={input} aria-label="Mensagem de teste" value={text} onChange={(event) => setText(event.target.value)} disabled={busy || changed} placeholder="Digite para testar o agente..." className="h-8 border-slate-600 bg-slate-900 text-xs text-slate-100 caret-slate-100 placeholder:text-slate-400 focus-visible:ring-emerald-400 ring-offset-slate-900" /><Button type="submit" size="icon" disabled={busy || changed || !text.trim()} aria-label="Enviar mensagem de teste" className="h-8 w-8 shrink-0 bg-emerald-600"><Send className="h-3.5 w-3.5" /></Button></div>
      <button type="button" disabled={busy} onClick={reset} className="mt-2.5 flex w-full items-center justify-center gap-1.5 text-xs text-slate-400 hover:text-white"><RotateCcw className="h-3 w-3" />Recomeçar teste</button>
    </form>
  </aside>;
}
