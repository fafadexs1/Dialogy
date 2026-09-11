'use client';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { AgentStudioDocument } from '@/services/agent-studio/types';
import { resolveConfiguredAiModel, type AiModelCatalogEntry } from '@/lib/ai-models';

export function StudioPolicySettings({ document, onChange, models = [] }: { document: AgentStudioDocument; onChange: (document: AgentStudioDocument) => void; models?: AiModelCatalogEntry[] }) {
  const [topicsText, setTopicsText] = useState((document.rules.excludedTopics || []).join('\n'));
  const [dataText, setDataText] = useState((document.rules.prohibitedDataLabels || []).join('\n'));
  const patch = (rules: Partial<AgentStudioDocument['rules']>) => onChange({ ...document, rules: { ...document.rules, ...rules } });
  const lines = (value: string) => value.split('\n').map((line) => line.trim()).filter(Boolean);
  const reasoning = document.resolveStage.reasoning || { enabled: false, effort: 'medium' as const, supportModel: null, maxDecisions: 8, maxTurnMs: 90000 };
  const patchReasoning = (value: Partial<typeof reasoning>) => onChange({ ...document, resolveStage: { ...document.resolveStage, reasoning: { ...reasoning, ...value } } });
  const supportModels = models.filter((model) => model.enabled && /^(openai|deepseek)\//.test(model.id));
  const effectiveSupportModel = reasoning.supportModel && supportModels.some((m) => m.id === reasoning.supportModel)
    ? reasoning.supportModel
    : (reasoning.supportModel ? resolveConfiguredAiModel(reasoning.supportModel, supportModels) : null);
  return <section className="space-y-4 rounded-xl border border-slate-200 p-4 text-xs text-slate-700"><h4 className="font-semibold">Escopo e limites</h4>
    <label className="block">Como conduzir a conversa<select className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-slate-900" value={document.resolveStage.conversationMode || 'guided'} onChange={(event) => onChange({ ...document, resolveStage: { ...document.resolveStage, conversationMode: event.target.value as 'guided' | 'adaptive' } })}>
      <option value="guided">Guiado · compatibilidade com a publicação atual</option>
      <option value="adaptive">Adaptativo · conduzir pelo objetivo da conversa</option>
    </select><span className="mt-1 block text-slate-500">A IA decide entre coletar dados, consultar capacidades disponíveis, responder com fontes e propor ações configuradas. Pode consultar uma alternativa antes de perguntar e reavaliar o resultado. Permissões, condições, mensagens configuradas e confirmações continuam protegidas. Dados desconhecidos não são exigidos novamente. Teste o rascunho antes de publicar.</span></label>
    <label className="block">Assuntos que o agente não deve atender · um por linha<Textarea className="mt-1 text-xs" value={topicsText} onChange={(event) => { setTopicsText(event.target.value); patch({ excludedTopics: lines(event.target.value) }); }} placeholder="Ex.: negociação de dívida" /></label>
    <label className="block">Dados que não devem ser solicitados · um por linha<Textarea className="mt-1 text-xs" value={dataText} onChange={(event) => { setDataText(event.target.value); patch({ prohibitedDataLabels: lines(event.target.value) }); }} placeholder="Ex.: renda mensal" /></label>
    <p className="text-slate-500">Senhas, tokens secretos e códigos de autenticação permanecem proibidos pelo sistema. A publicação verifica os campos configurados; o atendimento aplica essas restrições à orientação da IA.</p>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label>Mensagens do cliente por sessão<Input type="number" min={2} max={100} className="mt-1" value={document.rules.maxTurnsPerSession ?? 30} onChange={(event) => patch({ maxTurnsPerSession: Number(event.target.value) })} /></label><label>Ações por sessão<Input type="number" min={1} max={50} className="mt-1" value={document.rules.maxToolCallsPerSession ?? 10} onChange={(event) => patch({ maxToolCallsPerSession: Number(event.target.value) })} /></label></div>
    <p className="text-slate-500">Ao atingir um limite, o agente solicita acompanhamento da equipe. Mensagens duplicadas não consomem o limite nem repetem ações.</p>
    {document.resolveStage.conversationMode === 'adaptive' && <fieldset className="space-y-3 rounded-lg border border-slate-200 p-3">
      <legend className="px-1 font-semibold">Raciocínio e continuidade</legend>
      <label className="flex items-center gap-2"><input type="checkbox" checked={reasoning.enabled} onChange={(event) => patchReasoning({ enabled: event.target.checked })} />Usar o novo atendimento com memória de escolhas</label>
      <p className="text-slate-500">Em validação. Teste o rascunho antes de publicar. O agente mantém pedidos e escolhas, consulta as ações autorizadas e pode pedir apoio para resolver um impedimento.</p>
      {reasoning.enabled && <>
        <label className="block">Esforço de raciocínio<select className="mt-1 w-full rounded-md border bg-white p-2" value={reasoning.effort} onChange={(event) => patchReasoning({ effort: event.target.value as 'low' | 'medium' | 'high' })}>
          <option value="low">Menor</option><option value="medium">Intermediário</option><option value="high">Maior</option>
        </select><span className="mt-1 block text-slate-500">Maior esforço pode aumentar o tempo e o consumo. Compare os resultados dos testes.</span></label>
        <label className="block">Modelo de apoio<select className="mt-1 w-full rounded-md border bg-white p-2" value={effectiveSupportModel || ''} onChange={(event) => patchReasoning({ supportModel: event.target.value || null })}>
          <option value="">Sem modelo de apoio</option>
          {effectiveSupportModel && !supportModels.some((model) => model.id === effectiveSupportModel) && <option value={effectiveSupportModel} disabled>Modelo configurado indisponível</option>}
          {supportModels.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
        </select><span className="mt-1 block text-slate-500">Somente modelos ativos e compatíveis deste workspace. O apoio orienta o agente quando necessário.</span></label>
      </>}
    </fieldset>}
  </section>;
}
