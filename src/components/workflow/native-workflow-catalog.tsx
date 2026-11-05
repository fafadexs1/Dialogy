'use client';

import { useMemo, useState, type RefObject } from 'react';
import { Star } from 'lucide-react';
import { WorkflowOperationIcon } from './workflow-operation-icon';
import type { StudioFlowReleaseSummary } from '@/services/agent-studio/flow-contract';
import type { StudioFlowSelection } from './studio-composition-inspector';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';
import { AlertTriangle, Braces, Database, GitBranch, LayoutGrid, LucideIcon, MessageSquareText, Play, Send, Sparkles, Wrench, X, Zap } from 'lucide-react';


import { Button } from '@/components/ui/button';


import { cn } from '@/lib/utils';
import type { WorkflowNodeCategory, WorkflowNodeManifest } from '@/services/workflow-runtime/catalog';
import type { WorkflowNode } from '@/services/workflow-runtime/types';
import type { NativeAgentToolCatalogItem } from '@/services/workflow-runtime/native-agent-tools';

export type CatalogCategoryMeta = {
  label: string;
  description: string;
  icon: LucideIcon;
  badge?: string;
};

export const BUSINESS_CATEGORY_META: Record<WorkflowNodeCategory, CatalogCategoryMeta> = {
  triggers: {
    label: 'Gatilhos de Início',
    description: 'Eventos que iniciam a execução do fluxo',
    icon: Play,
  },
  interaction: {
    label: 'Interação com Cliente',
    description: 'Perguntas, menus de opções e formulários',
    icon: MessageSquareText,
  },
  ai: {
    label: 'Inteligência Artificial',
    description: 'Agentes inteligentes, roteamento e extração',
    icon: Sparkles,
  },
  logic: {
    label: 'Lógica e Controle',
    description: 'Condições, ramificações, loops e esperas',
    icon: GitBranch,
  },
  data: {
    label: 'Dados e Variáveis',
    description: 'Armazenamento, transformação e templates',
    icon: Braces,
  },
  integrations: {
    label: 'Integrações e APIs',
    description: 'Requisições HTTP, E-mail, MCP e banco de dados',
    icon: Zap,
  },
  knowledge_memory: {
    label: 'Conhecimento e Memória',
    description: 'Base de dados RAG e contexto de sessão',
    icon: Database,
  },
  tools: {
    label: 'Ferramentas do Agente',
    description: 'Habilidades invocáveis pela IA',
    icon: Wrench,
  },
  utilities: {
    label: 'Ações Dialogy & CRM',
    description: 'WhatsApp, contratos SGP e etiquetas',
    icon: LayoutGrid,
  },
  output: {
    label: 'Saídas e Encerramento',
    description: 'Mensagens finais, transferências e encerramento',
    icon: Send,
  },
  error: {
    label: 'Tratamento de Erros',
    description: 'Rotas de recuperação e contingência',
    icon: AlertTriangle,
  },
};

export type NativeWorkflowCatalogProps = {
  open: boolean;
  studioReleases?: StudioFlowReleaseSummary[];
  studioAllowedTypes?: string[];
  studioLoading?: boolean;
  studioError?: string;
  onAddStudio?: (selection: StudioFlowSelection) => void;
  favorites?: string[];
  recent?: string[];
  onToggleFavorite?: (type: string) => void;
  onClose: () => void;
  query: string;
  onQueryChange: (query: string) => void;
  selectedWorkflowNode: WorkflowNode | null;
  pendingConnection: { nodeId: string; sourcePortId: string } | null;
  recommendedManifests: WorkflowNodeManifest[];
  groupedManifests: Array<{
    category: WorkflowNodeCategory;
    meta: { label: string; icon: LucideIcon; description?: string };
    manifests: WorkflowNodeManifest[];
  }>;
  attachmentManifests: WorkflowNodeManifest[];
  libraryToolGroups: Array<{
    id: string;
    label: string;
    tools: NativeAgentToolCatalogItem[];
  }>;
  toolsLoading?: boolean;
  editorMode: 'essential' | 'advanced';
  onAddCatalogItem: (manifest: WorkflowNodeManifest) => void;
  onAddToolFromLibrary: (tool: NativeAgentToolCatalogItem) => void;
  isNativeAgentToolAttachable: (tool: NativeAgentToolCatalogItem) => boolean;
  getNativeAgentToolLabel: (tool: NativeAgentToolCatalogItem) => string;
  getNativeAgentToolUnavailableReason: (tool: NativeAgentToolCatalogItem) => string | null | undefined;
  getNodeCopy: (manifest: WorkflowNodeManifest) => { label: string; description: string };
  getNodeIcon: (type: string) => LucideIcon;
  getNodeAccent: (category: WorkflowNodeCategory) => string;
  isNarrowViewport?: boolean;
  panelRef?: RefObject<HTMLElement | null>;
  unavailableReasons?: Record<string, string>;
};

export function NativeWorkflowCatalog(props: NativeWorkflowCatalogProps) {
  const { open, onClose, query, onQueryChange, recommendedManifests, groupedManifests, attachmentManifests, favorites = [], recent = [], onToggleFavorite, getNodeCopy, getNodeAccent } = props;
  const [category, setCategory] = useState('all');
  const all = useMemo(() => [...new Map([...recommendedManifests, ...groupedManifests.flatMap((group) => group.manifests), ...attachmentManifests].map((manifest) => [manifest.type, manifest])).values()], [recommendedManifests, groupedManifests, attachmentManifests]);
  const sections = useMemo(() => {
    if (category === 'favorites') return [{ id: 'favorites', label: 'Favoritos', manifests: all.filter((manifest) => favorites.includes(manifest.type)) }];
    if (category === 'recent') return [{ id: 'recent', label: 'Usados recentemente', manifests: recent.flatMap((type) => all.filter((manifest) => manifest.type === type)) }];
    if (category !== 'all') return [{ id: category, label: BUSINESS_CATEGORY_META[category as WorkflowNodeCategory]?.label || 'Operações', manifests: all.filter((manifest) => manifest.category === category) }];
    const recommended = new Set(recommendedManifests.map((manifest) => manifest.type));
    return [
      { id: 'recommended', label: 'Sugeridos para este passo', manifests: recommendedManifests },
      ...Object.entries(BUSINESS_CATEGORY_META).map(([id, meta]) => ({ id, label: meta.label, manifests: all.filter((manifest) => manifest.category === id && !recommended.has(manifest.type)) })),
    ];
  }, [all, category, favorites, recent, recommendedManifests]);
  if (!open) return null;
  return <aside ref={props.panelRef} className={cn('wf-catalog absolute bottom-4 left-4 top-[76px] z-50 flex w-[420px] max-w-[calc(100%-32px)] flex-col overflow-hidden rounded-2xl border border-[var(--wf-border)] bg-[var(--wf-panel)] text-[var(--wf-text)] shadow-xl', props.isNarrowViewport && '!top-4 !w-[calc(100%-32px)]')}
    aria-label="Biblioteca de operações" role={props.isNarrowViewport ? 'dialog' : undefined} aria-modal={props.isNarrowViewport || undefined}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
    <div className="flex items-center justify-between border-b border-[var(--wf-border)] px-4 py-3">
      <div><h2 className="text-sm font-semibold">Adicionar operação</h2><p className="mt-1 text-xs text-[var(--wf-muted)]">{props.pendingConnection ? 'Continuar o caminho selecionado' : 'Escolha o próximo passo do fluxo'}</p></div>
      <Button type="button" size="icon" variant="ghost" onClick={onClose} aria-label="Fechar biblioteca"><X size={16} /></Button>
    </div>
    <Command shouldFilter={false} className="min-h-0 flex-1 rounded-none bg-transparent" label="Buscar operações">
      <CommandInput autoFocus value={query} onValueChange={onQueryChange} placeholder="Buscar operação, função ou ação…" aria-label="Buscar operações" />
      <div className="flex flex-wrap gap-1 border-b border-[var(--wf-border)] px-3 py-2" aria-label="Categorias de operações">
        {[{ id: 'all', label: 'Todas' }, { id: 'studio', label: 'IA Studio' }, { id: 'favorites', label: 'Favoritos' }, { id: 'recent', label: 'Recentes' }, ...Object.entries(BUSINESS_CATEGORY_META).filter(([id]) => all.some((manifest) => manifest.category === id)).map(([id, meta]) => ({ id, label: meta.label }))].map((item) =>
          <button type="button" key={item.id} aria-pressed={category === item.id} onClick={() => setCategory(item.id)} className={cn('min-h-7 rounded-md px-2 text-xs transition-colors', category === item.id ? 'bg-[var(--wf-hover)] font-semibold text-[var(--wf-accent)]' : 'text-[var(--wf-muted)] hover:bg-[var(--wf-hover)]')}>{item.label}</button>)}
      </div>
      <CommandList className="min-h-0 max-h-none flex-1 p-2">
        <CommandEmpty>Nenhuma operação compatível encontrada.</CommandEmpty>
        {(category === 'all' || category === 'studio') && <CommandGroup heading="IA Studio · publicações reutilizáveis" className="text-[var(--wf-muted)]">
          {props.studioReleases?.flatMap((release) => [
            { type: 'ai.studio_agent', release, label: `${release.agentName} · Agente`, procedureId: undefined },
            ...(release.contract.modes.includes('task') ? [{ type: 'tool.studio_agent', release, label: `${release.agentName} · Especialista como ferramenta`, procedureId: undefined }] : []),
            ...release.procedures.flatMap((procedure) => [{ type: 'integration.studio_procedure', release, label: `${procedure.name} · Habilidade de ${release.agentName}`, procedureId: procedure.id }, ...(release.contract.modes.includes('task') ? [{ type: 'tool.studio_procedure', release, label: `${procedure.name} · Ferramenta de ${release.agentName}`, procedureId: procedure.id }] : [])]),
          ]).filter((entry) => (props.studioAllowedTypes || all.map((manifest) => manifest.type)).includes(entry.type) && entry.label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(query.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase())).map((entry) => <CommandItem key={`${entry.type}:${entry.release.releaseId}:${entry.procedureId || ''}`} value={`${entry.type}:${entry.release.releaseId}:${entry.procedureId || ''}`} onSelect={() => props.onAddStudio?.(entry)} draggable onDragStart={(event) => { event.dataTransfer.setData('application/dialogy-studio-flow', JSON.stringify({ type: entry.type, releaseId: entry.release.releaseId, procedureId: entry.procedureId })); event.dataTransfer.effectAllowed = 'copy'; }} className="gap-3 py-3 text-[var(--wf-text)] data-[selected=true]:bg-[var(--wf-hover)]"><WorkflowOperationIcon type={entry.type} /><span><span className="block text-sm">{entry.label}</span><span className="block text-xs text-[var(--wf-muted)]">Versão {entry.release.version} · {entry.release.contract.modes.map((mode) => mode === 'task' ? 'tarefa' : 'conversa').join(' / ')}</span></span></CommandItem>)}
          {props.studioLoading && <p role="status" className="p-3 text-xs">Carregando o Studio…</p>}{props.studioError && <p role="alert" className="p-3 text-xs text-[var(--wf-danger)]">{props.studioError}</p>}{!props.studioLoading && !props.studioError && !props.studioReleases?.length && <p className="p-3 text-xs">Habilite Uso no Flowbuilder no Studio e publique um agente para reutilizá-lo aqui.</p>}
        </CommandGroup>}
        {sections.filter((section) => section.manifests.length).map((section) => <CommandGroup key={section.id} heading={section.label} className="text-[var(--wf-muted)]">
          {section.manifests.map((manifest) => {
            const copy = getNodeCopy(manifest);
            const favorite = favorites.includes(manifest.type);
            return <CommandItem key={manifest.type} value={manifest.type} disabled={Boolean(props.unavailableReasons?.[manifest.type])} onSelect={() => { if (!props.unavailableReasons?.[manifest.type]) props.onAddCatalogItem(manifest); }} draggable
              onDragStart={(event) => { if (props.unavailableReasons?.[manifest.type]) { event.preventDefault(); return; } event.dataTransfer.setData('application/dialogy-workflow-node', manifest.type); event.dataTransfer.effectAllowed = 'copy'; }}
              className="group my-1 flex cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-[var(--wf-text)] data-[selected=true]:bg-[var(--wf-hover)] data-[selected=true]:text-[var(--wf-text)]">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ color: getNodeAccent(manifest.category), backgroundColor: `${getNodeAccent(manifest.category)}16` }}><WorkflowOperationIcon type={manifest.type} size={19} /></span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{copy.label}</span><span className="mt-1 block text-xs leading-5 text-[var(--wf-muted)]">{props.unavailableReasons?.[manifest.type] || copy.description}</span></span>
              <button type="button" aria-label={`${favorite ? 'Remover' : 'Adicionar'} ${copy.label} ${favorite ? 'dos' : 'aos'} favoritos`} aria-pressed={favorite} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--wf-muted)] hover:text-[var(--wf-accent)]" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onToggleFavorite?.(manifest.type); }}><Star size={15} fill={favorite ? 'currentColor' : 'none'} /></button>
            </CommandItem>;
          })}
        </CommandGroup>)}
        {props.libraryToolGroups.map((group) => <CommandGroup key={group.id} heading={group.label}>
          {group.tools.map((tool) => <CommandItem key={tool.name} value={`tool:${tool.name}`} disabled={!props.isNativeAgentToolAttachable(tool)} onSelect={() => props.onAddToolFromLibrary(tool)} draggable onDragStart={(event) => { if (!props.isNativeAgentToolAttachable(tool)) { event.preventDefault(); return; } event.dataTransfer.setData('application/dialogy-workflow-tool', JSON.stringify(tool)); event.dataTransfer.effectAllowed = 'copy'; }} className="gap-3 py-3 text-[var(--wf-text)] data-[selected=true]:bg-[var(--wf-hover)]"><Wrench size={18} /><span><span className="block text-sm">{props.getNativeAgentToolLabel(tool)}</span><span className="block text-xs text-[var(--wf-muted)]">{props.getNativeAgentToolUnavailableReason(tool) || tool.description}</span></span></CommandItem>)}
        </CommandGroup>)}
        {props.toolsLoading && <p role="status" className="p-4 text-xs text-[var(--wf-muted)]">Carregando ferramentas…</p>}
      </CommandList>
    </Command>
    <footer className="flex gap-4 border-t border-[var(--wf-border)] px-4 py-2 text-xs text-[var(--wf-muted)]"><span>↑ ↓ navegar</span><span>Enter inserir</span><span>Esc fechar</span></footer>
  </aside>;
}
