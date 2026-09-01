'use client';

import { useEffect, useState } from 'react';
import { listPublishedStudioAgentsAction } from '@/actions/agent-studio';
import type { WorkflowNode } from '@/services/workflow-runtime/types';
import { StudioFlowInputMappingsSchema, type StudioFlowInputMapping } from '@/services/agent-studio/flow-inputs';

/** Only the new reusable block gets this inspector; the normal flow's layout and existing blocks are untouched. */
export function PublishedAgentInspector({ workspaceId, node, onUpdate }: { workspaceId?: string; node: WorkflowNode; onUpdate: (patch: Partial<WorkflowNode>) => void }) {
  const [result, setResult] = useState<Awaited<ReturnType<typeof listPublishedStudioAgentsAction>> | null>(null);
  useEffect(() => { let cancelled = false; setResult(null); if (workspaceId) void listPublishedStudioAgentsAction(workspaceId).then((value) => { if (!cancelled) setResult(value); }).catch(() => { if (!cancelled) setResult({ success: false, releases: [], error: 'Não foi possível carregar os agentes.' }); }); return () => { cancelled = true; }; }, [workspaceId]);
  const selected = result?.releases.find((release) => release.releaseId === node.config.releaseId);
  const parsedInputs = StudioFlowInputMappingsSchema.safeParse(node.config.inputMappings || []);
  const inputs = parsedInputs.success ? parsedInputs.data : [];
  const latest = selected && result?.releases.find((release) => release.agentId === selected.agentId && release.version > selected.version);
  const updateInput = (inputKey: string, patch: Partial<StudioFlowInputMapping>) => onUpdate({ config: { ...node.config, inputMappings: [
    ...inputs.filter((mapping) => mapping.inputKey !== inputKey), { inputKey, sourceType: 'variable', sourcePath: '', ...inputs.find((mapping) => mapping.inputKey === inputKey), ...patch },
  ] } });
  return <section className="space-y-4 p-4 text-xs text-slate-300">
    <label className="block">Agente e versão publicada<select className="mt-2 w-full rounded-xl border border-slate-700 bg-[#0a121a] p-3 text-xs text-white" value={String(node.config.releaseId || '')} onChange={(event) => { const release = result?.releases.find((item) => item.releaseId === event.target.value); onUpdate({ config: { ...node.config, agentId: release?.agentId || '', releaseId: release?.releaseId || '', outputKeys: [], inputMappings: [] } }); }}><option value="">Selecione um agente</option>{result?.releases.map((release) => <option key={release.releaseId} value={release.releaseId}>{release.agentName} · versão {release.version}</option>)}</select></label>
    {!result ? <p className="text-slate-500">Carregando versões…</p> : !result.success ? <p role="alert" className="text-amber-300">{result.error}</p> : !result.releases.length ? <p className="text-slate-400">Publique um agente no Estúdio de IA para usá-lo aqui.</p> : null}
    {Boolean(node.config.releaseId) && result?.success && !selected && <p className="text-amber-300">A versão escolhida não está disponível. Selecione outra antes de publicar.</p>}
    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-[11px] leading-relaxed text-slate-300"><p className="font-medium text-emerald-300">O agente assume o atendimento a partir daqui.</p><p className="mt-1 text-slate-400">Ele conversa, executa os procedimentos e decide quando finalizar ou transferir conforme a versão publicada no Studio. Por isso este bloco não possui saídas para ligar.</p></div>
    {latest && <p role="status" className="rounded-lg border border-amber-700/40 p-3 text-amber-300">A versão {latest.version} está disponível. A versão {selected?.version} continua fixada. Selecione a nova versão acima, revise os dados e publique novamente o fluxo para atualizar.</p>}
    {Boolean(selected?.inputs.length) && <div className="space-y-3"><p className="font-medium">Dados permitidos para o agente</p><p className="text-[11px] text-slate-500">Somente estes mapeamentos são enviados. Deixe sem configuração se o agente puder perguntar ao cliente.</p>{selected!.inputs.map((field) => {
      const mapping = inputs.find((input) => input.inputKey === field.key);
      return <fieldset key={field.key} className="space-y-2 rounded-lg border border-slate-800 p-3"><legend>{field.label}</legend><label className="block">Origem<select className="mt-1 w-full rounded border border-slate-700 bg-[#0a121a] p-2" value={mapping?.sourceType || 'variable'} onChange={(event) => updateInput(field.key, { sourceType: event.target.value as StudioFlowInputMapping['sourceType'], sourcePath: '' })}><option value="variable">Variável do fluxo</option><option value="current">Resultado da etapa anterior</option><option value="input">Entrada inicial do fluxo</option><option value="static">Valor fixo</option></select></label><label className="block">{mapping?.sourceType === 'static' ? 'Valor' : 'Nome do dado'}<input className="mt-1 w-full rounded border border-slate-700 bg-[#0a121a] p-2" value={mapping?.sourcePath || ''} onChange={(event) => { if (!event.target.value) onUpdate({ config: { ...node.config, inputMappings: inputs.filter((input) => input.inputKey !== field.key) } }); else updateInput(field.key, { sourcePath: event.target.value }); }} placeholder="Ex.: cliente.email" /></label></fieldset>;
    })}</div>}
    {selected && <a href={`/autopilot/${selected.agentId}`} target="_blank" rel="noreferrer" className="inline-block text-emerald-400 hover:underline">Abrir agente no Studio</a>}
  </section>;
}
