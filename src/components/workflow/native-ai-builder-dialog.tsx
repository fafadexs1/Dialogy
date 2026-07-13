'use client';

import { useState } from 'react';
import { Bot, CheckCircle2, Loader2, RotateCcw, Send, Sparkles, TriangleAlert, WandSparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { WorkflowDefinition } from '@/services/workflow-runtime';
import type { NativeWorkflowAiProposal } from '@/services/workflow-runtime/native-ai-builder';

type ConversationMessage = { role: 'user' | 'assistant'; content: string };

const INITIAL_MESSAGE: ConversationMessage = {
  role: 'assistant',
  content: 'Descreva o atendimento que você quer montar. Posso criar um agente único ou uma equipe roteada, usando os modelos, documentos e ferramentas já disponíveis no workspace.',
};

const PROMPT_PRESETS = [
  { label: 'Suporte completo', prompt: 'Crie um agente de suporte que consulte a base de conhecimento, resolva dúvidas comuns e transfira casos sensíveis para uma pessoa.' },
  { label: 'Suporte + comercial', prompt: 'Crie uma equipe com um agente de suporte e outro comercial, roteados pela intenção da mensagem e com encerramento seguro.' },
  { label: 'Cobrança segura', prompt: 'Crie um fluxo para dúvidas de cobrança que consulte documentos, use somente ferramentas de baixo risco automaticamente e peça confirmação nas demais.' },
] as const;

export function NativeAiBuilderDialog({
  definition,
  disabled,
  availableToolCount = 0,
  knowledgeDocumentCount = 0,
  configuredModelLabel,
  onGenerate,
  onApply,
}: {
  definition: WorkflowDefinition;
  disabled?: boolean;
  availableToolCount?: number;
  knowledgeDocumentCount?: number;
  configuredModelLabel?: string | null;
  onGenerate: (conversation: ConversationMessage[]) => Promise<{ proposal: NativeWorkflowAiProposal | null; error?: string }>;
  onApply: (proposal: NativeWorkflowAiProposal) => void;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [proposal, setProposal] = useState<NativeWorkflowAiProposal | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([INITIAL_MESSAGE]);

  const resetConversation = () => {
    if (busy) return;
    setMessages([INITIAL_MESSAGE]);
    setInput('');
    setError('');
    setProposal(null);
  };

  const submit = async () => {
    const content = input.trim();
    if (!content || busy) return;
    const conversation = messages.concat({ role: 'user', content });
    setMessages(conversation);
    setInput('');
    setError('');
    setProposal(null);
    setBusy(true);
    try {
      const result = await onGenerate(conversation);
      if (!result.proposal) {
        setError(result.error || 'A IA não conseguiu gerar uma proposta válida.');
        return;
      }
      setProposal(result.proposal);
      setMessages((current) => current.concat({ role: 'assistant', content: result.proposal!.summary }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao gerar a proposta.');
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!proposal?.validation.valid) return;
    onApply(proposal);
    setOpen(false);
  };

  return (
    <>
      <Button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="absolute bottom-5 left-1/2 z-40 -translate-x-1/2 rounded-full border border-cyan-300/30 bg-cyan-400 px-5 text-slate-950 shadow-[0_16px_50px_rgba(34,211,238,0.28)] hover:bg-cyan-300"
      >
        <WandSparkles className="mr-2 h-4 w-4" />
        Construir com IA
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="dark flex max-h-[92vh] w-[min(900px,95vw)] max-w-none flex-col overflow-hidden border-slate-700 bg-[#0b121a] p-0 text-slate-100 shadow-2xl">
          <div className="border-b border-slate-700/80 bg-[#101b26] px-5 py-4 sm:px-6 sm:py-5">
            <div className="flex items-start justify-between gap-4 pr-7">
              <DialogTitle className="flex items-center gap-2 text-lg">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-400/15 text-cyan-300"><Sparkles className="h-4 w-4" /></span>
                Construtor de automação com IA
              </DialogTitle>
              <Button type="button" variant="ghost" size="sm" onClick={resetConversation} disabled={busy || messages.length === 1} className="shrink-0 text-slate-300"><RotateCcw className="mr-2 h-4 w-4" />Limpar</Button>
            </div>
            <DialogDescription className="mt-2 text-slate-400">
              A proposta usa o contrato nativo, passa pelo validador do runtime e só altera o rascunho quando você clicar em aplicar.
            </DialogDescription>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-300" aria-label="Recursos disponíveis para a IA">
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">Modelo: {configuredModelLabel || 'não configurado'}</span>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">{knowledgeDocumentCount} documento(s)</span>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">{availableToolCount} ferramenta(s)</span>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[0.95fr_1.05fr] md:overflow-hidden">
            <section className="flex min-h-[360px] flex-col border-b border-slate-700/70 md:min-h-0 md:border-b-0 md:border-r">
              <div className="flex-1 space-y-3 overflow-y-auto p-5">
                {messages.map((message, index) => (
                  <div key={`${message.role}-${index}`} className={cn('flex gap-2', message.role === 'user' && 'justify-end')}>
                    {message.role === 'assistant' && <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-cyan-400/10 text-cyan-300"><Bot className="h-3.5 w-3.5" /></span>}
                    <div className={cn('max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6', message.role === 'user' ? 'bg-cyan-400 text-slate-950' : 'border border-slate-700 bg-slate-900/70 text-slate-200')}>
                      {message.content}
                    </div>
                  </div>
                ))}
                {busy && <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-cyan-300"><Loader2 className="h-4 w-4 animate-spin" />Projetando e validando a automação…</div>}
              </div>
              <div className="border-t border-slate-700/70 p-4">
                <div className="mb-3 flex flex-wrap gap-2" aria-label="Exemplos rápidos">
                  {PROMPT_PRESETS.map((preset) => <button key={preset.label} type="button" onClick={() => setInput(preset.prompt)} disabled={busy} className="rounded-full border border-cyan-300/20 bg-cyan-300/[0.06] px-3 py-1.5 text-xs text-cyan-100 transition hover:bg-cyan-300/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-50">{preset.label}</button>)}
                </div>
                <Textarea
                  aria-label="Descreva a automação desejada"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void submit();
                    }
                  }}
                  disabled={busy}
                  placeholder="Ex.: crie um agente de suporte e outro comercial, roteados por intenção…"
                  className="min-h-24 resize-none border-slate-700 bg-[#121d28] text-slate-100 placeholder:text-slate-500"
                />
                <Button onClick={() => void submit()} disabled={busy || !input.trim()} className="mt-3 w-full bg-cyan-400 text-slate-950 hover:bg-cyan-300">
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                  Gerar proposta
                </Button>
              </div>
            </section>

            <section className="min-h-0 overflow-y-auto p-5">
              {!proposal && !error && (
                <div className="flex h-full min-h-[350px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-700 bg-slate-900/30 p-8 text-center">
                  <WandSparkles className="h-8 w-8 text-cyan-300" />
                  <p className="mt-4 font-medium">A proposta aparecerá aqui</p>
                  <p className="mt-2 max-w-sm text-sm leading-6 text-slate-400">O fluxo atual e os recursos disponíveis servem como contexto. Nenhuma mudança é aplicada automaticamente.</p>
                </div>
              )}
              {error && (
                <div role="alert" aria-live="assertive" className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">
                  <div className="flex items-start gap-2"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>
                  <Button type="button" size="sm" variant="outline" onClick={() => { setInput(messages.filter((message) => message.role === 'user').at(-1)?.content || ''); setError(''); }} className="mt-3 border-red-300/25 text-red-100">Tentar novamente</Button>
                </div>
              )}
              {proposal && (
                <div aria-live="polite" className="space-y-4">
                  <div className={cn('rounded-2xl border p-4', proposal.validation.valid ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-red-500/30 bg-red-500/10')}>
                    <div className="flex items-center gap-2 font-medium">
                      {proposal.validation.valid ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : <TriangleAlert className="h-4 w-4 text-red-300" />}
                      {proposal.validation.valid ? 'Proposta validada pelo runtime' : 'Proposta bloqueada pelo validador'}
                    </div>
                    <p className="mt-2 text-sm text-slate-300">{proposal.workflow.nodes.length} blocos · {proposal.workflow.connections.length} conexões</p>
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Alterações propostas</p>
                    <div className="space-y-2">{proposal.changes.map((change) => <div key={change} className="rounded-xl border border-slate-700 bg-slate-900/60 p-3 text-sm text-slate-300">{change}</div>)}</div>
                  </div>
                  {proposal.selectedToolNames.length > 0 && <div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Ferramentas anexadas</p><div className="flex flex-wrap gap-2">{proposal.selectedToolNames.map((tool) => <span key={tool} className="rounded-full border border-red-400/20 bg-red-400/10 px-2.5 py-1 text-xs text-red-200">{tool}</span>)}</div></div>}
                  {proposal.warnings.length > 0 && <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-100">{proposal.warnings.join(' ')}</div>}
                  {proposal.validation.errors.length > 0 && <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-100">{proposal.validation.errors.map((issue) => issue.message).join(' ')}</div>}
                  <div className="flex justify-end gap-2 border-t border-slate-700/70 pt-4">
                    <Button variant="ghost" onClick={() => setProposal(null)}>Descartar proposta</Button>
                    <Button onClick={apply} disabled={!proposal.validation.valid} className="bg-emerald-400 text-slate-950 hover:bg-emerald-300">Aplicar ao rascunho</Button>
                  </div>
                </div>
              )}
            </section>
          </div>
          <p className="sr-only">Workflow atual: {definition.name}</p>
        </DialogContent>
      </Dialog>
    </>
  );
}
