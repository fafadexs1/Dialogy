'use client';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { AgentStudioDocument } from '@/services/agent-studio/types';

export function StudioPolicySettings({ document, onChange }: { document: AgentStudioDocument; onChange: (document: AgentStudioDocument) => void }) {
  const [topicsText, setTopicsText] = useState((document.rules.excludedTopics || []).join('\n'));
  const [dataText, setDataText] = useState((document.rules.prohibitedDataLabels || []).join('\n'));
  const patch = (rules: Partial<AgentStudioDocument['rules']>) => onChange({ ...document, rules: { ...document.rules, ...rules } });
  const lines = (value: string) => value.split('\n').map((line) => line.trim()).filter(Boolean);
  return <section className="space-y-4 rounded-xl border border-slate-200 p-4 text-xs text-slate-700"><h4 className="font-semibold">Escopo e limites</h4>
    <label className="block">Assuntos que o agente não deve atender · um por linha<Textarea className="mt-1 text-xs" value={topicsText} onChange={(event) => { setTopicsText(event.target.value); patch({ excludedTopics: lines(event.target.value) }); }} placeholder="Ex.: negociação de dívida" /></label>
    <label className="block">Dados que não devem ser solicitados · um por linha<Textarea className="mt-1 text-xs" value={dataText} onChange={(event) => { setDataText(event.target.value); patch({ prohibitedDataLabels: lines(event.target.value) }); }} placeholder="Ex.: renda mensal" /></label>
    <p className="text-slate-500">Senhas, tokens secretos e códigos de autenticação permanecem proibidos pelo sistema. A publicação verifica os campos configurados; o atendimento aplica essas restrições à orientação da IA.</p>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label>Mensagens do cliente por sessão<Input type="number" min={2} max={100} className="mt-1" value={document.rules.maxTurnsPerSession ?? 30} onChange={(event) => patch({ maxTurnsPerSession: Number(event.target.value) })} /></label><label>Ações por sessão<Input type="number" min={1} max={50} className="mt-1" value={document.rules.maxToolCallsPerSession ?? 10} onChange={(event) => patch({ maxToolCallsPerSession: Number(event.target.value) })} /></label></div>
    <p className="text-slate-500">Ao atingir um limite, o agente solicita acompanhamento da equipe. Mensagens duplicadas não consomem o limite nem repetem ações.</p>
  </section>;
}
