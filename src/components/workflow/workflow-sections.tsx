'use client';

import { useEffect, useRef } from 'react';
import { GripVertical, MousePointer2, X } from 'lucide-react';
import { ViewportPortal } from '@xyflow/react';
import type { WorkflowSection } from './workflow-editor-core';
import type { CanvasNode } from './workflow-node-card';
import { workflowNodeGeometry } from './workflow-node-geometry';

export function WorkflowSections({ groups, nodes, getZoom, onRename, onRemove, onSelect, onMove }: {
  groups: WorkflowSection[]; nodes: CanvasNode[]; getZoom: () => number;
  onRename: (id: string, title: string) => void; onRemove: (id: string) => void; onSelect: (ids: string[]) => void;
  onMove: (ids: string[], delta: { x: number; y: number }, done: boolean) => void;
}) {
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);
  return <ViewportPortal>{groups.map((group) => {
    const members = nodes.filter((node) => group.nodeIds.includes(node.id) && !node.hidden);
    if (!members.length) return null;
    const x = Math.min(...members.map((node) => node.position.x)) - 24;
    const y = Math.min(...members.map((node) => node.position.y)) - 24;
    const right = Math.max(...members.map((node) => node.position.x + workflowNodeGeometry(node.data.workflowNode).width)) + 24;
    const bottom = Math.max(...members.map((node) => node.position.y + workflowNodeGeometry(node.data.workflowNode).height)) + 24;
    return <div key={group.id} className="wf-section" style={{ left: x, top: y, width: right - x, height: bottom - y }}>
      <div className="nodrag nopan wf-section-header">
        <button type="button" aria-label={`Mover seção ${group.title}`} title="Arraste para mover toda a seção" className="cursor-grab" onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault(); event.stopPropagation();
          cleanup.current?.();
          const zoom = getZoom();
          let previous = { x: event.clientX, y: event.clientY };
          const move = (pointer: PointerEvent) => {
            const delta = { x: (pointer.clientX - previous.x) / zoom, y: (pointer.clientY - previous.y) / zoom };
            previous = { x: pointer.clientX, y: pointer.clientY };
            onMove(group.nodeIds, delta, false);
          };
          const stop = () => { onMove(group.nodeIds, { x: 0, y: 0 }, true); cleanup.current?.(); };
          const remove = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); cleanup.current = null; };
          cleanup.current = remove;
          window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop, { once: true }); window.addEventListener('pointercancel', stop, { once: true });
        }}><GripVertical size={16} /></button>
        <input aria-label="Nome da seção" key={`${group.id}:${group.title}`} defaultValue={group.title} onBlur={(event) => { const title = event.target.value.trim(); if (title && title !== group.title) onRename(group.id, title); else event.target.value = group.title; }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
        <button type="button" aria-label={`Selecionar membros de ${group.title}`} onClick={() => onSelect(group.nodeIds)}><MousePointer2 size={14} /></button>
        <button type="button" aria-label={`Desagrupar ${group.title}`} onClick={() => onRemove(group.id)}><X size={14} /></button>
      </div>
    </div>;
  })}</ViewportPortal>;
}
