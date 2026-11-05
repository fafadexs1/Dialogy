'use client';

import { memo, useEffect, useRef } from 'react';
import { Handle, Position, useConnection, useUpdateNodeInternals, type Node, type NodeProps } from '@xyflow/react';
import { Check, Circle, Loader2, Plus, Settings2, TriangleAlert } from 'lucide-react';
import { getWorkflowNodeManifest } from '@/services/workflow-runtime/catalog';
import type { WorkflowNode } from '@/services/workflow-runtime/types';
import { NATIVE_WORKFLOW_CATEGORY_COLOR, NATIVE_WORKFLOW_CONNECTION_META } from './native-workflow-visuals';
import type { WorkflowDebugNodeState } from './workflow-debug-state';
import { workflowNodeGeometry, workflowPreviewText, workflowVisibleOutputs } from './workflow-node-geometry';
import { WorkflowOperationIcon } from './workflow-operation-icon';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export type WorkflowNodeData = {
  workflowNode: WorkflowNode;
  errorCount: number;
  operationalState?: WorkflowDebugNodeState;
  connectedOutputPortIds?: string[];
  connectedInputPortIds?: string[];
  focusedOutputPortId?: string;
  showAdvancedRoutes?: boolean;
  onAddNext?: (nodeId: string, sourcePortId: string) => void;
  onFocusRoute?: (nodeId: string, sourcePortId: string) => void;
};
export type CanvasNode = Node<WorkflowNodeData, 'workflow'>;

const STATE_LABELS: Record<WorkflowDebugNodeState, string> = {
  queued: 'Na fila', running: 'Executando', thinking: 'Pensando', running_tool: 'Executando ferramenta',
  completed: 'Concluído', waiting: 'Aguardando', failed: 'Falhou', skipped: 'Ignorado', cancelled: 'Interrompido', retrying: 'Nova tentativa',
};

export const WorkflowNodeCard = memo(function WorkflowNodeCard({ data, selected, dragging }: NodeProps<CanvasNode>) {
  const node = data.workflowNode;
  const manifest = getWorkflowNodeManifest(node.type);
  const geometry = workflowNodeGeometry(node);
  const preview = workflowPreviewText(node);
  const outputs = workflowVisibleOutputs(node);
  const updateNodeInternals = useUpdateNodeInternals();
  const portSignature = `${geometry.width}:${geometry.height}:${node.inputPorts.map((port) => port.id).join(',')}:${outputs.map((port) => port.id).join(',')}`;
  const previousPorts = useRef(portSignature);
  useEffect(() => {
    if (previousPorts.current === portSignature) return;
    previousPorts.current = portSignature;
    updateNodeInternals(node.id);
  }, [node.id, portSignature, updateNodeInternals]);
  const connection = useConnection<CanvasNode>();
  const sourceType = connection.inProgress ? connection.fromHandle?.id?.startsWith('out:')
    ? connection.fromNode.data.workflowNode.outputPorts.find((port) => `out:${port.id}` === connection.fromHandle.id)?.connectionType
    : undefined : undefined;
  const connected = new Set(data.connectedOutputPortIds);
  const state = data.operationalState;
  const busy = state && ['running', 'thinking', 'running_tool', 'retrying'].includes(state);
  return (
    <article className={cn('wf-node', selected && 'is-selected', dragging && 'is-dragging', data.errorCount > 0 && 'has-error')}
      style={{ width: geometry.width, height: geometry.height, '--wf-category': NATIVE_WORKFLOW_CATEGORY_COLOR[manifest?.category || 'data'] } as React.CSSProperties}
      aria-label={`${node.name}, ${manifest?.label || node.type}${data.errorCount ? `, ${data.errorCount} pendências` : ''}`}>
      <header className="wf-node-header">
        <span className="wf-node-icon"><WorkflowOperationIcon type={node.type} /></span>
        <div className="min-w-0 flex-1"><span className="wf-node-category">{manifest?.label || node.type}</span><Tooltip><TooltipTrigger asChild><h3 tabIndex={0}>{node.name}</h3></TooltipTrigger><TooltipContent className="workflow-portal max-w-xs border-[var(--wf-border)] bg-[var(--wf-panel)] text-[var(--wf-text)]">{node.name}</TooltipContent></Tooltip></div>
        <span className="wf-node-config" title={data.errorCount ? `${data.errorCount} pendências de configuração` : 'Sem pendências identificadas'}>
          {data.errorCount ? <TriangleAlert size={16} /> : <Check size={14} />}
        </span>
      </header>
      {preview && <div className="wf-node-preview"><span className="wf-node-preview-label">Conteúdo configurado</span><Tooltip><TooltipTrigger asChild><p tabIndex={0}>{preview}</p></TooltipTrigger><TooltipContent className="workflow-portal max-w-sm whitespace-pre-line border-[var(--wf-border)] bg-[var(--wf-panel)] text-[var(--wf-text)]">{preview}</TooltipContent></Tooltip></div>}
      <div className="wf-node-ports" style={{ height: geometry.rows * 28 }}>
        {Array.from({ length: geometry.rows }, (_, index) => {
          const input = node.inputPorts[index];
          const output = outputs[index];
          const availableInput = input && (input.multiple || !data.connectedInputPortIds?.includes(input.id));
          const compatible = availableInput && sourceType === input.connectionType;
          return <div className="wf-port-row" key={index}>
            <span className="wf-port-input" title={input?.label}>{input?.label}</span>
            {input && <Handle id={`in:${input.id}`} type="target" position={Position.Left} isConnectable={Boolean(availableInput)}
              className={cn('wf-handle', connection.inProgress && (compatible ? 'is-compatible' : 'is-incompatible'))}
              style={{ top: geometry.portY(index), '--wf-port-color': NATIVE_WORKFLOW_CONNECTION_META[input.connectionType].color } as React.CSSProperties}
              title={`Entrada ${input.label} · ${NATIVE_WORKFLOW_CONNECTION_META[input.connectionType].label}`}
              aria-label={`Entrada ${input.label}: ${NATIVE_WORKFLOW_CONNECTION_META[input.connectionType].label}`} />}
            {output && <button type="button" className={cn('nodrag nopan wf-port-output', data.focusedOutputPortId === output.id && 'is-focused')} title={`${output.label} · ${NATIVE_WORKFLOW_CONNECTION_META[output.connectionType].label}`}
              onClick={(event) => { event.stopPropagation(); data.onFocusRoute?.(node.id, output.id); }}>
              <span>{output.label}</span><Circle size={7} aria-hidden="true" />
            </button>}
            {output && <Handle id={`out:${output.id}`} type="source" position={Position.Right} isConnectable={output.multiple || !connected.has(output.id)} className="wf-handle"
              style={{ top: geometry.portY(index), '--wf-port-color': NATIVE_WORKFLOW_CONNECTION_META[output.connectionType].color } as React.CSSProperties}
              title={`Saída ${output.label} · ${NATIVE_WORKFLOW_CONNECTION_META[output.connectionType].label}`}
              aria-label={`Saída ${output.label}: ${NATIVE_WORKFLOW_CONNECTION_META[output.connectionType].label}`} />}
            {output && ['main', 'error', 'event'].includes(output.connectionType) && (output.multiple || !connected.has(output.id)) && <button type="button" className="nodrag nopan wf-add-port" style={{ top: geometry.portY(index) - 12 }}
              aria-label={`Adicionar próximo passo em ${output.label}`} title={`Adicionar etapa: ${output.label}`}
              onClick={(event) => { event.stopPropagation(); data.onAddNext?.(node.id, output.id); }}><Plus size={13} /></button>}
          </div>;
        })}
      </div>
      <footer className={cn('wf-node-footer', state && `wf-state-${state}`)}>
        {state ? <>{busy ? <Loader2 size={12} className="wf-spin" /> : state === 'failed' ? <TriangleAlert size={12} /> : <Circle size={8} />}<span>{STATE_LABELS[state]}</span></>
          : <><Settings2 size={12} /><span title={data.errorCount ? undefined : manifest?.description}>{data.errorCount ? `${data.errorCount} ${data.errorCount === 1 ? 'pendência' : 'pendências'} para revisar` : !preview && manifest?.description ? manifest.description : outputs.length ? 'Clique para configurar' : manifest?.attachment ? 'Recurso do agente' : 'Fim deste caminho'}</span></>}
      </footer>
    </article>
  );
});
