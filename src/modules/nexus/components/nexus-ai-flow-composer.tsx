'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, AudioLines, Bot, CheckCircle2, ChevronDown, Loader2, Mic, Plus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { NativeWorkflowAiProposal } from '@/services/workflow-runtime/native-ai-builder';

type Message = { role: 'user' | 'assistant'; content: string };

export function NexusAiFlowComposer({
  disabled,
  onGenerate,
  onApply,
}: {
  disabled?: boolean;
  onGenerate: (conversation: Message[]) => Promise<{ proposal: NativeWorkflowAiProposal | null; error?: string }>;
  onApply: (proposal: NativeWorkflowAiProposal) => void;
}) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lastProposal, setLastProposal] = useState<NativeWorkflowAiProposal | null>(null);
  const [expanded, setExpanded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = '40px';
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, 40), 128);
    textarea.style.height = `${nextHeight}px`;
    setExpanded((current) => input.length > 0 && (current || input.includes('\n') || nextHeight > 44));
  }, [input]);

  const submit = async () => {
    const content = input.trim();
    if (!content || busy || disabled) return;
    const conversation: Message[] = [...messages, { role: 'user', content }];
    setMessages(conversation);
    setInput('');
    setError('');
    setLastProposal(null);
    setBusy(true);
    try {
      const result = await onGenerate(conversation);
      if (!result.proposal) {
        setError(result.error || 'A IA não conseguiu aplicar essa alteração.');
        return;
      }
      onApply(result.proposal);
      setLastProposal(result.proposal);
      setMessages((current) => [...current, { role: 'assistant', content: result.proposal!.summary }]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível editar o fluxo com IA.');
    } finally {
      setBusy(false);
    }
  };

  const isExpanded = expanded && input.length > 0;
  const resetButton = (
    <button type="button" onClick={() => { setMessages([]); setInput(''); setError(''); setLastProposal(null); }} disabled={busy} title="Nova instrução" aria-label="Nova instrução" style={{ color: '#202124', opacity: 1 }} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition hover:bg-[#f4f4f4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d5d7dc]"><Plus className="h-5 w-5" strokeWidth={1.8} /></button>
  );
  const composerInput = (
    <Textarea
      ref={textareaRef}
      value={input}
      onChange={(event) => setInput(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          void submit();
        }
      }}
      rows={1}
      disabled={busy || disabled}
      aria-label="Descreva a alteração que a IA deve fazer no fluxo"
      placeholder="Peça à Nexus AI"
      style={{ color: '#202124', opacity: 1, WebkitTextFillColor: '#202124' }}
      className="max-h-32 min-h-10 min-w-0 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-2.5 py-2 text-base font-normal leading-6 shadow-none placeholder:!text-[#8e8e93] placeholder:opacity-100 focus-visible:ring-0 disabled:cursor-wait disabled:opacity-100"
    />
  );
  const actionControls = (
    <div className="flex shrink-0 items-center gap-1">
      <span style={{ color: '#8e8e93', opacity: 1 }} className="hidden shrink-0 items-center gap-1 px-1.5 text-sm sm:flex">Automático <ChevronDown className="h-3.5 w-3.5" /></span>
      <span style={{ color: '#202124', opacity: 1 }} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-[#f4f4f4]" title="Entrada por voz"><Mic className="h-[18px] w-[18px]" strokeWidth={1.8} /></span>
      <Button type="button" size="icon" onClick={() => void submit()} disabled={busy || disabled || !input.trim()} style={{ backgroundColor: '#3c83f6', color: '#ffffff' }} className="h-9 w-9 shrink-0 rounded-full !bg-[#3c83f6] !text-white opacity-100 shadow-none hover:!bg-[#3478e8] disabled:!bg-[#3c83f6] disabled:!text-white disabled:opacity-100">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : input.trim() ? <ArrowUp className="h-[18px] w-[18px]" strokeWidth={2.2} /> : <AudioLines className="h-[18px] w-[18px]" />}
        <span className="sr-only">Enviar pedido para a IA</span>
      </Button>
    </div>
  );

  return (
    <div
      style={{ width: 'min(800px, calc(100% - 32px))' }}
      className="pointer-events-none absolute bottom-6 left-1/2 z-20 -translate-x-1/2"
    >
      <div className="pointer-events-auto w-full">
        {(lastProposal || error) && (
          <div className={cn('mb-2 rounded-2xl border px-4 py-3 shadow-xl backdrop-blur-xl', error ? 'border-red-300/50 bg-red-50/95 text-red-900' : 'border-emerald-300/60 bg-white/95 text-slate-800')}>
            <div className="flex items-start gap-3">
              {error ? <Bot className="mt-0.5 h-4 w-4 shrink-0 text-red-600" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold">{error ? 'Não consegui concluir' : 'Alteração aplicada ao rascunho'}</p>
                <p className="mt-1 text-xs leading-5 text-slate-600">{error || lastProposal?.summary}</p>
                {lastProposal?.changes.length ? <p className="mt-1 truncate text-[10px] text-slate-500">{lastProposal.changes.join(' · ')}</p> : null}
              </div>
              <button type="button" onClick={() => { setError(''); setLastProposal(null); }} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Fechar retorno da IA"><X className="h-4 w-4" /></button>
            </div>
          </div>
        )}
        <div
          style={{ backgroundColor: '#ffffff', borderColor: '#e5e7eb', color: '#202124', opacity: 1 }}
          className={cn('isolate border px-2.5 shadow-[0_2px_12px_rgba(0,0,0,0.08),0_8px_28px_rgba(0,0,0,0.04)] transition-[border-color,box-shadow,border-radius] focus-within:border-[#d5d7dc] focus-within:shadow-[0_2px_14px_rgba(0,0,0,0.1),0_10px_32px_rgba(0,0,0,0.05)]', isExpanded ? 'rounded-[28px] pb-2 pt-2.5' : 'rounded-[28px] py-1.5')}
        >
          {isExpanded ? (
            <div className="flex flex-col gap-0.5">
              {composerInput}
              <div className="flex items-center justify-between">
                {resetButton}
                {actionControls}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              {resetButton}
              {composerInput}
              {actionControls}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
