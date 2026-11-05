'use client';
import type { WorkflowDefinition, WorkflowNode } from '@/services/workflow-runtime/types';
import type { StudioFlowReleaseSummary } from '@/services/agent-studio/flow-contract';
import { StudioFlowInputMappingsSchema, type StudioFlowInputMapping } from '@/services/agent-studio/flow-inputs';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

const capabilityGroups = [
  { label: 'Modelo e conhecimento', items: [['model', 'Modelo', 'ai.model'], ['knowledge', 'Conhecimento', 'knowledge.rag_retriever'], ['memory', 'Memória', 'memory.session']] },
  { label: 'Pesquisa e execução', items: [['tools', 'Calculadora', 'tool.calculator'], ['tools', 'Data e hora', 'tool.clock'], ['tools', 'Ler página', 'tool.read_url'], ['tools', 'Pesquisa na web', 'tool.web_search'], ['tools', 'Navegador isolado', 'tool.browser'], ['tools', 'Código e terminal isolados', 'tool.sandbox']] },
  { label: 'Arquivos e mídia', items: [['tools', 'Ler documento', 'tool.document_read'], ['tools', 'Gerar documento', 'tool.document_write'], ['tools', 'Transcrever áudio', 'tool.audio_transcribe'], ['tools', 'Gerar voz', 'tool.text_to_speech'], ['tools', 'Criar ou editar imagem', 'tool.image'], ['tools', 'Analisar imagem', 'tool.image_analysis'], ['tools', 'Analisar vídeo', 'tool.video_analysis']] },
  { label: 'Aplicativos e automação', items: [['tools', 'Conector de aplicativo', 'tool.connector'], ['tools', 'Banco de dados SQL', 'tool.database'], ['tools', 'Agendar tarefa', 'tool.schedule_workflow'], ['tools', 'Notificação por e-mail', 'tool.email_notification'], ['tools', 'Ler conversa WhatsApp Business', 'tool.whatsapp_history'], ['tools', 'Responder WhatsApp Business', 'tool.whatsapp_reply'], ['tools', 'Zapier', 'tool.zapier'], ['tools', 'Relatório Google Ads', 'tool.google_ads_report'], ['tools', 'Ferramenta HTTP', 'tool.http'], ['tools', 'Ferramenta MCP', 'tool.mcp']] },
  { label: 'Delegação', items: [['tools', 'Subfluxo', 'tool.subflow'], ['tools', 'Especialista do Studio', 'tool.studio_agent'], ['tools', 'Habilidade do Studio', 'tool.studio_procedure']] },
] as const;

export type StudioFlowSelection = { type: string; release: StudioFlowReleaseSummary; procedureId?: string };
export function studioFlowSelectionConfig(selection: StudioFlowSelection) {
  return { agentId: selection.release.agentId, releaseId: selection.release.releaseId, procedureId: selection.procedureId,
    mode: selection.type.startsWith('tool.') ? 'task' : selection.release.contract.modes[0], inputMappings: [], maxModelCalls: selection.release.contract.maxModelCalls, maxToolCalls: selection.release.contract.maxToolCalls, timeoutMs: selection.release.contract.timeoutMs,
    outputKey: `studio_${selection.release.agentId.replaceAll('-', '').slice(0, 8)}`,
    name: `studio_${selection.release.agentId.replaceAll('-', '').slice(0, 8)}${selection.procedureId ? `_${selection.procedureId.replace(/[^a-zA-Z0-9_]/g, '_')}` : ''}`,
    description: selection.procedureId ? selection.release.procedures.find((procedure) => procedure.id === selection.procedureId)?.description || 'Executar habilidade publicada do Studio.' : `Consultar ${selection.release.agentName}`,
  };
}

export function StudioCompositionInspector({ node, definition, releases, loading, error, onUpdate, onAddResource }: {
  node: WorkflowNode; definition: WorkflowDefinition; releases: StudioFlowReleaseSummary[]; loading: boolean; error: string;
  onUpdate: (patch: Partial<WorkflowNode>) => void; onAddResource: (type: string) => void;
}) {
  const selected = releases.find((release) => release.releaseId === node.config.releaseId);
  const tool = node.type.startsWith('tool.'); const procedure = node.type.endsWith('studio_procedure');
  const update = (patch: Record<string, unknown>) => onUpdate({ config: { ...node.config, ...patch } });
  const mappings = StudioFlowInputMappingsSchema.safeParse(node.config.inputMappings || []);
  const inputs = mappings.success ? mappings.data : [];
  const map = (inputKey: string, patch: Partial<StudioFlowInputMapping>) => update({ inputMappings: [...inputs.filter((entry) => entry.inputKey !== inputKey), { inputKey, sourceType: 'variable', sourcePath: '', ...inputs.find((entry) => entry.inputKey === inputKey), ...patch }] });
  const predecessorIds = new Set<string>(); const queue = [node.id];
  while (queue.length) { const current = queue.shift()!; for (const connection of definition.connections.filter((entry) => entry.targetNodeId === current && ['main', 'error', 'event'].includes(entry.connectionType))) if (connection.sourceNodeId !== node.id && !predecessorIds.has(connection.sourceNodeId)) { predecessorIds.add(connection.sourceNodeId); queue.push(connection.sourceNodeId); } }
  const sources = definition.nodes.filter((candidate) => predecessorIds.has(candidate.id) && candidate.config.outputKey).flatMap((candidate) => {
    const published = releases.find((release) => release.releaseId === candidate.config.releaseId);
    const key = String(candidate.config.outputKey);
    return published?.contract.outputs.length ? published.contract.outputs.map((field) => ({ value: `${key}.${field.key}`, label: `${candidate.name} → ${field.label}` })) : [{ value: key, label: `${candidate.name} → resultado` }];
  });
  return <section className="space-y-5 p-4 text-xs text-[var(--wf-text)]">
    <label className="block">Agente e versão publicada<select className="mt-2 w-full rounded-lg border border-[var(--wf-border)] bg-[var(--wf-panel)] p-3" value={String(node.config.releaseId || '')} onChange={(event) => { const release = releases.find((item) => item.releaseId === event.target.value); if (release) update({ ...studioFlowSelectionConfig({ type: node.type, release }), outputKey: node.config.outputKey || 'studioResult', ...(node.config.name ? { name: node.config.name } : {}) }); }}><option value="">Selecione uma publicação do Studio</option>{releases.filter((release) => !tool || release.contract.modes.includes('task')).map((release) => <option key={release.releaseId} value={release.releaseId}>{release.agentName} · versão {release.version}</option>)}</select></label>
    {loading && <p role="status">Carregando publicações…</p>}{error && <p role="alert" className="text-[var(--wf-danger)]">{error}</p>}
    {!loading && !error && !releases.length && <p>Habilite Uso no Flowbuilder no Studio e publique uma versão para reutilizá-la aqui.</p>}
    {Boolean(node.config.releaseId) && !selected && !loading && <p role="alert" className="text-[var(--wf-warning)]">A versão selecionada não está disponível para composição. Seus dados foram preservados.</p>}
    {selected && <>
      <p className="rounded-xl border border-[var(--wf-border)] bg-[var(--wf-hover)] p-3 leading-relaxed">Identidade, regras e habilidades vêm da versão {selected.version} do Studio. Esta etapa devolve o controle ao fluxo.</p>
      {releases.some((release) => release.agentId === selected.agentId && release.version > selected.version) && <p role="status" className="text-[var(--wf-warning)]">Há uma versão mais recente. Selecione-a e revise os dados antes de publicar o fluxo.</p>}
      {procedure && <label className="block">Habilidade<select className="mt-2 w-full rounded-lg border border-[var(--wf-border)] bg-[var(--wf-panel)] p-3" value={String(node.config.procedureId || '')} onChange={(event) => update({ procedureId: event.target.value })}><option value="">Selecione uma habilidade exportada</option>{selected.procedures.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>}
      {!tool && <label className="block">Modo<select className="mt-2 w-full rounded-lg border border-[var(--wf-border)] bg-[var(--wf-panel)] p-3" value={String(node.config.mode || 'task')} onChange={(event) => update({ mode: event.target.value })}>{selected.contract.modes.map((mode) => <option key={mode} value={mode}>{mode === 'conversation' ? 'Conversar e devolver o controle' : 'Executar tarefa e devolver dados'}</option>)}</select></label>}
      {tool ? <><label className="block">Nome da ferramenta<Input value={String(node.config.name || '')} onChange={(event) => update({ name: event.target.value })} /></label><label className="block">Quando o agente deve chamar este especialista<Textarea value={String(node.config.description || '')} onChange={(event) => update({ description: event.target.value })} /></label><p className="text-[var(--wf-muted)]">Os argumentos são definidos pelas entradas públicas abaixo. O agente principal envia os dados e recebe o resultado; o especialista não conversa diretamente com o cliente.</p></> : <label className="block">Tarefa neste fluxo<Textarea value={String(node.config.task || '')} onChange={(event) => update({ task: event.target.value })} placeholder="Ex.: Classificar a solicitação e devolver categoria e resumo." /></label>}
      {!tool && <fieldset className="space-y-3"><legend className="mb-2 text-sm font-semibold">Entradas</legend>{selected.contract.inputs.map((field) => { const mapping = inputs.find((entry) => entry.inputKey === field.key); return <fieldset className="space-y-2 rounded-lg border border-[var(--wf-border)] p-3" key={field.key}><legend>{field.label} · {field.type}{field.required ? ' · obrigatório' : ''}</legend><label className="block">Origem<select className="mt-1 w-full rounded border border-[var(--wf-border)] bg-[var(--wf-panel)] p-2" value={mapping?.sourceType || 'variable'} onChange={(event) => map(field.key, { sourceType: event.target.value as StudioFlowInputMapping['sourceType'], sourcePath: '' })}><option value="variable">Variável do fluxo</option><option value="current">Resultado da etapa anterior</option><option value="input">Entrada inicial</option><option value="static">Valor fixo</option></select></label>{sources.length > 0 && (!mapping || mapping.sourceType === 'variable') && <label className="block">Dados de etapas anteriores<select className="mt-1 w-full rounded border border-[var(--wf-border)] bg-[var(--wf-panel)] p-2" value={sources.some((source) => source.value === mapping?.sourcePath) ? mapping?.sourcePath : ''} onChange={(event) => map(field.key, { sourceType: 'variable', sourcePath: event.target.value })}><option value="">Selecionar um dado…</option>{sources.map((source) => <option key={source.value} value={source.value}>{source.label}</option>)}</select></label>}<label className="block">{mapping?.sourceType === 'static' ? 'Valor' : 'Caminho ou expressão de dados'}<Input value={mapping?.sourcePath || ''} onChange={(event) => map(field.key, { sourcePath: event.target.value, valueType: field.type })} placeholder={mapping?.sourceType === 'current' ? 'data.cliente.nome' : field.key} /></label></fieldset>; })}{!selected.contract.inputs.length && <p className="text-[var(--wf-muted)]">Esta versão não declara entradas adicionais.</p>}</fieldset>}
      <fieldset className="space-y-2"><legend className="mb-2 text-sm font-semibold">Saídas públicas</legend>{selected.contract.outputs.map((field) => <p key={field.key}><code>{field.key}</code> · {field.label} · {field.type}{field.sensitive ? ' · sensível' : ''}</p>)}{!tool && <label className="block">Salvar os resultados na variável<Input value={String(node.config.outputKey || 'studioResult')} onChange={(event) => update({ outputKey: event.target.value })} /></label>}</fieldset>
      {!procedure && <fieldset className="space-y-3"><legend className="mb-2 text-sm font-semibold">Capacidades</legend>
        <p className="leading-relaxed text-[var(--wf-muted)]">Adicione recursos permitidos pela versão publicada. Algumas ferramentas exigem conexão ou configuração adicional.</p>
        <div className="space-y-2">{capabilityGroups.map((group) => <details key={group.label} className="rounded-xl border border-[var(--wf-border)] bg-[var(--wf-panel)]">
          <summary className="cursor-pointer px-3 py-3 text-xs font-semibold">{group.label} <span className="ml-1 font-normal text-[var(--wf-muted)]">· {group.items.length} recursos</span></summary>
          <div className="grid gap-2 border-t border-[var(--wf-border)] p-3 sm:grid-cols-2">{group.items.map(([extension, label, type]) => <Button key={type} type="button" variant="outline" size="sm" className="h-auto min-h-9 justify-start whitespace-normal text-left" disabled={!selected.contract.extensions.includes(extension)} onClick={() => onAddResource(type)}>+ {label}</Button>)}</div>
        </details>)}</div>
        {definition.connections.filter((connection) => connection.targetNodeId === node.id && !['main','error','event'].includes(connection.connectionType)).map((connection) => <p className="text-[var(--wf-muted)]" key={connection.id}>{definition.nodes.find((entry) => entry.id === connection.sourceNodeId)?.name} · conectado pelo fluxo</p>)}
      </fieldset>}
      {!tool && <div className="grid gap-3 sm:grid-cols-2"><label>Chamadas de IA (máx. {selected.contract.maxModelCalls})<Input type="number" min={1} max={selected.contract.maxModelCalls} value={Number(node.config.maxModelCalls || 8)} onChange={(event) => update({ maxModelCalls: Number(event.target.value) })} /></label><label>Ferramentas (máx. {selected.contract.maxToolCalls})<Input type="number" min={0} max={selected.contract.maxToolCalls} value={Number(node.config.maxToolCalls ?? 20)} onChange={(event) => update({ maxToolCalls: Number(event.target.value) })} /></label></div>}
      <a className="inline-block text-[var(--wf-accent)] underline" href={`/autopilot/${selected.agentId}`} target="_blank" rel="noreferrer">Abrir definição no Studio</a>
    </>}
  </section>;
}


