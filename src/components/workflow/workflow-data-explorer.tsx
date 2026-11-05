'use client';

import { useState } from 'react';
import { sampleDataFields } from '@/services/workflow-runtime/data-operations';
import type { WorkflowNode } from '@/services/workflow-runtime/types';
import type { DebugExecution } from './workflow-execution-debugger';
import { Button } from '@/components/ui/button';

export function WorkflowDataExplorer({ node, execution, onMap, onPin, pinned }: {
  node: WorkflowNode; execution?: Pick<DebugExecution, 'variables' | 'nodeResults' | 'executionPath'> & { input?: Record<string, unknown> }; onMap: (field: string, expression: string) => void;
  onPin: (nodeId: string, output: Record<string, unknown> | null, statePatch?: Record<string, unknown>) => void; pinned: Set<string>;
}) {
  const fields = Object.entries(node.config).filter(([key, value]) => (typeof value === 'string' || ['source','right','file','body','arguments','items'].includes(key)) && !['operation', 'format', 'targetType', 'operator', 'locale', 'currency', 'outputKey', 'name', 'workflowId', 'connectorId', 'credentialId', 'mode', 'responseFormat', 'bodyType', 'method', 'permissionScope', 'releaseId', 'agentId'].includes(key)).map(([key]) => key);
  const [destination, setDestination] = useState('');
  const [query, setQuery] = useState('');
  const target = fields.includes(destination) ? destination : fields.includes('source') ? 'source' : fields[0] || '';
  const sources = execution ? [
    { id: 'input', title: 'Entrada do fluxo', value: execution.input || execution.executionPath?.[0]?.input, path: 'input' },
    { id: 'variables', title: 'Variáveis', value: execution.variables, path: 'variables' },
    ...Object.entries(execution.nodeResults || {}).filter(([id]) => !id.includes('.')).map(([id, result]) => ({ id, title: `Resultado · ${id}`, value: result.output, path: `nodeResults.${id}.output` })),
  ] : [];
  return <details className="mb-4 rounded-xl border border-[var(--wf-border)] p-3">
    <summary className="cursor-pointer text-sm font-medium">Explorar dados e mapear campos</summary>
    <div className="mt-3 space-y-3">
      <p className="text-xs text-[var(--wf-muted)]">Escolha um destino e clique em um dado para inserir sua expressão. Exemplos fixados são usados apenas nos testes desta sessão.</p>
      <label className="block text-xs">Inserir no campo<select aria-label="Destino do mapeamento" value={target} onChange={e => setDestination(e.target.value)} className="mt-1 h-9 w-full rounded border border-[var(--wf-border)] bg-[var(--wf-panel)] px-2">{fields.map(field => <option key={field} value={field}>{field}</option>)}</select></label>
      <input aria-label="Buscar dado" placeholder="Buscar campo ou valor" value={query} onChange={e => setQuery(e.target.value)} className="h-9 w-full rounded border border-[var(--wf-border)] bg-[var(--wf-panel)] px-2 text-xs" />
      {!execution && <p className="text-xs text-[var(--wf-muted)]">Selecione uma execução no debugger para carregar exemplos reais.</p>}
      <div className="max-h-72 space-y-3 overflow-auto">
        {sources.map(source => <section key={source.id}>
          <div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold">{source.title}</span>{source.id !== 'input' && source.id !== 'variables' && Boolean(source.value) && typeof source.value === 'object' && !Array.isArray(source.value) && <Button type="button" size="sm" variant="ghost" onClick={() => onPin(source.id, pinned.has(source.id) ? null : source.value as Record<string, unknown>, execution?.nodeResults?.[source.id]?.statePatch as Record<string, unknown> | undefined)}>{pinned.has(source.id) ? 'Desafixar' : 'Fixar para testes'}</Button>}</div>
          {sampleDataFields(source.value, source.path).filter(entry => `${entry.path} ${entry.preview}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(entry => <button key={entry.path} type="button" draggable disabled={!target} title={`Mapear ${entry.path} para ${target}`} onDragStart={event => event.dataTransfer.setData('text/plain', `{{${entry.path}}}`)} onClick={() => onMap(target, `{{${entry.path}}}`)} className="my-1 block w-full rounded border border-[var(--wf-border)] px-2 py-2 text-left text-xs focus-visible:outline-2 focus-visible:outline-[var(--wf-accent)]"><span className="block break-all font-mono">{entry.path} <span className="text-[var(--wf-muted)]">· {entry.type}</span></span><span className="mt-1 block truncate text-[var(--wf-muted)]">{entry.preview}</span></button>)}
        </section>)}
      </div>
    </div>
  </details>;
}
