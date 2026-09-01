'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import type { ProcedureDocument } from '@/services/agent-studio/types';

export function StudioProcedureSettings({ procedure, onApply, onClose }: {
  procedure: ProcedureDocument; onApply: (procedure: ProcedureDocument) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState(procedure);
  const [examples, setExamples] = useState(procedure.exampleRequests.join('\n'));
  const [keywords, setKeywords] = useState(procedure.triggerKeywords.join(', '));
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="dark max-h-[90dvh] overflow-y-auto border-slate-700 bg-slate-950 text-slate-100">
      <DialogHeader><DialogTitle>Definir procedimento</DialogTitle><DialogDescription>Diga o que a IA deve resolver e quando este procedimento pode ser usado.</DialogDescription></DialogHeader>
      <div className="space-y-4 text-sm">
        <label className="block">Nome<Input className="mt-1" value={draft.name} maxLength={200} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Ex.: Emitir segunda via de fatura" /></label>
        <label className="block">Objetivo<Textarea className="mt-1" value={draft.objective || ''} onChange={(e) => setDraft({ ...draft, objective: e.target.value })} placeholder="Qual resultado o cliente deve receber?" /></label>
        <label className="block">Quando usar<Textarea className="mt-1" value={draft.whenToUse || ''} onChange={(e) => setDraft({ ...draft, whenToUse: e.target.value })} placeholder="Ex.: Quando o cliente pedir uma fatura em aberto" /></label>
        <label className="block">Quando não usar<Textarea className="mt-1" value={draft.whenNotToUse || ''} onChange={(e) => setDraft({ ...draft, whenNotToUse: e.target.value })} placeholder="Ex.: Não negociar descontos ou cancelar o contrato" /></label>
        <label className="block">Exemplos de pedidos · um por linha<Textarea className="mt-1" value={examples} onChange={(e) => setExamples(e.target.value)} placeholder="Preciso da segunda via da fatura" /></label>
        <details><summary className="cursor-pointer text-slate-400">Regras adicionais de identificação</summary><div className="mt-3 space-y-3">
          <label className="block">Palavras-chave · separadas por vírgula<Input className="mt-1" value={keywords} onChange={(e) => setKeywords(e.target.value)} /></label>
          <label className="block">Prioridade<Input className="mt-1" type="number" value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) || 0 })} /></label>
          <p className="text-xs text-slate-400">Maior prioridade é considerada primeiro. Condições e limites continuam obrigatórios.</p>
        </div></details>
      </div>
      <DialogFooter><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={() => { onApply({ ...draft, description: draft.objective, exampleRequests: examples.split('\n').map((x) => x.trim()).filter(Boolean), triggerKeywords: keywords.split(',').map((x) => x.trim()).filter(Boolean) }); onClose(); }}>Aplicar ao rascunho</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
