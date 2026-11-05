'use client';

import { memo, useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react';
import { Plus, Unplug } from 'lucide-react';
import type { WorkflowConnection } from '@/services/workflow-runtime/types';

export type CanvasEdgeData = { connection: WorkflowConnection; label?: string; showLabel?: boolean; active?: boolean; onInsert?: (id: string) => void; onDisconnect?: (id: string) => void };
export type WorkflowCanvasEdge = Edge<CanvasEdgeData>;

export const WorkflowCanvasEdgeView = memo(function WorkflowCanvasEdgeView(props: EdgeProps<WorkflowCanvasEdge>) {
  const [hover, setHover] = useState(false);
  const [path, x, y] = getBezierPath(props);
  const canInsert = ['main', 'error', 'event'].includes(props.data?.connection.connectionType || '');
  return <g onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} className={props.data?.active ? 'wf-edge-active' : undefined}>
    <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd} style={{ ...props.style, strokeWidth: hover || props.selected ? 2.5 : props.style?.strokeWidth }} interactionWidth={28} />
    <EdgeLabelRenderer>
      <div className="nodrag nopan wf-edge-controls" style={{ transform: `translate(-50%, -50%) translate(${x}px,${y}px)` }} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
        {(props.data?.showLabel || hover || props.selected) && props.data?.label && <span className="wf-edge-label">{props.data.label}</span>}
        {canInsert && <button type="button" className={`wf-edge-insert ${hover || props.selected ? 'is-visible' : ''}`} aria-label={`Inserir operação${props.data?.label ? ` em ${props.data.label}` : ' nesta conexão'}`} title="Inserir operação" onClick={(event) => { event.stopPropagation(); props.data?.onInsert?.(props.id); }}><Plus size={14} /></button>}
        {props.selected && <button type="button" className="wf-edge-insert is-visible" aria-label="Desconectar etapas" title="Apagar conexão (Delete)" onClick={(event) => { event.stopPropagation(); props.data?.onDisconnect?.(props.id); }}><Unplug size={14} /></button>}
      </div>
    </EdgeLabelRenderer>
  </g>;
});

export const workflowEdgeTypes = { workflow: WorkflowCanvasEdgeView };
