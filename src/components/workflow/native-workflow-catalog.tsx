'use client';

import { useMemo, useState, useEffect, type RefObject } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Braces,
  ChevronDown,
  ChevronRight,
  Database,
  Eye,
  EyeOff,
  Filter,
  GitBranch,
  GripVertical,
  HelpCircle,
  Layers,
  LayoutGrid,
  ListChecks,
  Loader2,
  LucideIcon,
  MessageSquareText,
  PanelLeftClose,
  Play,
  Plus,
  Search,
  Send,
  Settings2,
  Sparkles,
  Wrench,
  X,
  Zap,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type {
  WorkflowNodeCategory,
  WorkflowNodeManifest,
} from '@/services/workflow-runtime/catalog';
import type {
  WorkflowNode,
} from '@/services/workflow-runtime/types';
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
};

export function NativeWorkflowCatalog({
  open,
  onClose,
  query,
  onQueryChange,
  selectedWorkflowNode,
  pendingConnection,
  recommendedManifests,
  groupedManifests,
  attachmentManifests,
  libraryToolGroups,
  toolsLoading = false,
  editorMode,
  onAddCatalogItem,
  onAddToolFromLibrary,
  isNativeAgentToolAttachable,
  getNativeAgentToolLabel,
  getNativeAgentToolUnavailableReason,
  getNodeCopy,
  getNodeIcon,
  getNodeAccent,
  isNarrowViewport,
  panelRef,
}: NativeWorkflowCatalogProps) {
  // Selected category filter tab: 'all' | category
  const [selectedCategoryTab, setSelectedCategoryTab] = useState<string>('all');

  // Open categories set for accordions
  const [openCategories, setOpenCategories] = useState<Set<string>>(() => {
    // Default open recommended and first 4 categories
    return new Set(['recommended', 'triggers', 'interaction', 'ai', 'logic', 'data', 'integrations', 'utilities', 'output', 'advanced']);
  });

  // When searching, auto open all categories with results
  useEffect(() => {
    if (query.trim().length > 0) {
      const allKeys = new Set<string>(['recommended', 'advanced', 'tools']);
      groupedManifests.forEach((group) => allKeys.add(group.category));
      setOpenCategories(allKeys);
    }
  }, [query, groupedManifests]);

  const toggleCategory = (categoryKey: string) => {
    setOpenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryKey)) {
        next.delete(categoryKey);
      } else {
        next.add(categoryKey);
      }
      return next;
    });
  };

  const handleExpandAll = () => {
    const allKeys = new Set<string>(['recommended', 'advanced', 'tools']);
    groupedManifests.forEach((group) => allKeys.add(group.category));
    setOpenCategories(allKeys);
  };

  const handleCollapseAll = () => {
    setOpenCategories(new Set());
  };

  // Filter groups by tab
  const displayedGroups = useMemo(() => {
    if (selectedCategoryTab === 'all') return groupedManifests;
    if (selectedCategoryTab === 'recommended') return [];
    if (selectedCategoryTab === 'advanced') return [];
    return groupedManifests.filter((group) => group.category === selectedCategoryTab);
  }, [groupedManifests, selectedCategoryTab]);

  const showRecommended = useMemo(() => {
    if (selectedCategoryTab === 'all' || selectedCategoryTab === 'recommended') {
      return recommendedManifests.length > 0;
    }
    return false;
  }, [recommendedManifests.length, selectedCategoryTab]);

  const showAdvanced = useMemo(() => {
    if (selectedCategoryTab === 'all' || selectedCategoryTab === 'advanced') {
      return attachmentManifests.length > 0;
    }
    return false;
  }, [attachmentManifests.length, selectedCategoryTab]);

  const totalVisibleBlocks = useMemo(() => {
    let count = 0;
    if (showRecommended) count += recommendedManifests.length;
    displayedGroups.forEach((g) => {
      count += g.manifests.length;
    });
    if (showAdvanced) count += attachmentManifests.length;
    return count;
  }, [displayedGroups, recommendedManifests.length, showAdvanced, showRecommended, attachmentManifests.length]);

  if (!open) return null;

  return (
    <aside
      ref={panelRef}
      aria-label="Biblioteca de blocos"
      aria-modal={isNarrowViewport || undefined}
      role={isNarrowViewport ? 'dialog' : undefined}
      className={cn(
        'absolute bottom-3 left-3 top-3 z-50 flex shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-800 bg-[#0b1219]/95 shadow-[0_20px_50px_rgba(0,0,0,0.55)] backdrop-blur-2xl transition-all duration-200',
        isNarrowViewport ? 'w-[calc(100vw-1.5rem)]' : 'w-[370px]'
      )}
    >
      {/* Header */}
      <div className="border-b border-white/[0.07] bg-[#0f1722]/90 px-4 pb-3 pt-3.5">
        <div className="mb-2.5 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                {selectedWorkflowNode ? 'Próximo passo' : 'Biblioteca de Blocos'}
              </span>
              <Badge variant="outline" className="h-4.5 border-slate-700 bg-slate-800/80 px-1.5 text-[9px] font-medium text-slate-300">
                {totalVisibleBlocks} blocos
              </Badge>
            </div>
            <p className="mt-0.5 truncate text-[11px] text-slate-400">
              {selectedWorkflowNode
                ? `Após "${selectedWorkflowNode.name}"`
                : 'Arraste ou clique para inserir na tela'}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8 rounded-lg text-slate-400 hover:bg-white/[0.08] hover:text-white"
            title="Fechar biblioteca"
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        </div>

        {/* Business Search Bar */}
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Buscar por nome, função ou ação..."
            className="h-9 rounded-xl border border-slate-700/60 bg-[#070d14] pl-9 pr-8 text-xs text-slate-200 placeholder:text-slate-500 focus-visible:border-slate-500 focus-visible:ring-1 focus-visible:ring-slate-500"
          />
          {query ? (
            <button
              type="button"
              onClick={() => onQueryChange('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-white"
              title="Limpar busca"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        {/* Category Pills / Filter Tabs */}
        <div className="mt-2.5 flex items-center justify-between gap-1">
          <div className="flex flex-1 items-center gap-1 overflow-x-auto pb-0.5 [scrollbar-width:none]">
            <button
              type="button"
              onClick={() => setSelectedCategoryTab('all')}
              className={cn(
                'rounded-lg px-2.5 py-1 text-[11px] font-medium transition whitespace-nowrap',
                selectedCategoryTab === 'all'
                  ? 'bg-slate-700/80 text-white shadow-xs'
                  : 'bg-white/[0.03] text-slate-400 hover:bg-white/[0.06] hover:text-slate-200'
              )}
            >
              Todos
            </button>
            {recommendedManifests.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedCategoryTab('recommended')}
                className={cn(
                  'flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition whitespace-nowrap',
                  selectedCategoryTab === 'recommended'
                    ? 'bg-slate-700/80 text-white shadow-xs'
                    : 'bg-white/[0.03] text-slate-400 hover:bg-white/[0.06] hover:text-slate-200'
                )}
              >
                <Sparkles className="h-3 w-3" />
                Sugeridos
              </button>
            )}
            {groupedManifests.map((group) => {
              const meta = BUSINESS_CATEGORY_META[group.category] || group.meta;
              const isSelected = selectedCategoryTab === group.category;
              return (
                <button
                  key={group.category}
                  type="button"
                  onClick={() => setSelectedCategoryTab(group.category)}
                  className={cn(
                    'rounded-lg px-2 py-1 text-[11px] font-medium transition whitespace-nowrap',
                    isSelected
                      ? 'bg-slate-700/80 text-white shadow-xs'
                      : 'bg-white/[0.03] text-slate-400 hover:bg-white/[0.06] hover:text-slate-200'
                  )}
                >
                  {meta.label.split(' ')[0]}
                </button>
              );
            })}
          </div>

          <div className="flex items-center pl-1 border-l border-white/[0.08]">
            <button
              type="button"
              onClick={openCategories.size > 0 ? handleCollapseAll : handleExpandAll}
              className="text-[10px] text-slate-400 hover:text-slate-200 transition px-1 py-0.5 whitespace-nowrap"
              title={openCategories.size > 0 ? 'Recolher todos' : 'Expandir todos'}
            >
              {openCategories.size > 0 ? 'Recolher' : 'Expandir'}
            </button>
          </div>
        </div>
      </div>

      {/* Main Accordion Body */}
      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3 [scrollbar-width:thin]">
        {/* Recommended Blocks Accordion */}
        {showRecommended && (
          <div className="rounded-xl border border-white/[0.06] bg-[#0e1620]/60 overflow-hidden transition">
            <button
              type="button"
              onClick={() => toggleCategory('recommended')}
              className="flex w-full items-center justify-between px-3 py-2.5 text-left transition hover:bg-white/[0.03]"
            >
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-md border border-slate-700/60 bg-slate-800/80 text-slate-300">
                  <Sparkles className="h-3.5 w-3.5" />
                </div>
                <div>
                  <span className="text-xs font-semibold text-slate-200">Recomendados agora</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-white/[0.04] border border-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
                  {recommendedManifests.length}
                </span>
                <ChevronDown
                  className={cn(
                    'h-4 w-4 text-slate-400 transition-transform duration-200',
                    openCategories.has('recommended') ? 'rotate-180' : ''
                  )}
                />
              </div>
            </button>

            {openCategories.has('recommended') && (
              <div className="grid gap-1.5 p-2 pt-0">
                {recommendedManifests.map((manifest) => (
                  <CatalogItemCard
                    key={`rec-${manifest.type}`}
                    manifest={manifest}
                    copy={getNodeCopy(manifest)}
                    Icon={getNodeIcon(manifest.type)}
                    accent={getNodeAccent(manifest.category)}
                    onAdd={() => onAddCatalogItem(manifest)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Category Accordions */}
        {displayedGroups.map((group) => {
          const meta = BUSINESS_CATEGORY_META[group.category] || group.meta;
          const Icon = meta.icon || group.meta.icon;
          const isOpen = openCategories.has(group.category);

          return (
            <div
              key={group.category}
              className="rounded-xl border border-white/[0.06] bg-[#0e1620]/60 overflow-hidden transition"
            >
              <button
                type="button"
                onClick={() => toggleCategory(group.category)}
                className="flex w-full items-center justify-between px-3 py-2.5 text-left transition hover:bg-white/[0.03]"
              >
                <div className="flex items-center gap-2.5">
                  <div className="flex h-6 w-6 items-center justify-center rounded-md border border-slate-700/60 bg-slate-800/80 text-slate-300">
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-slate-200">{meta.label}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-white/[0.04] border border-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
                    {group.manifests.length}
                  </span>
                  <ChevronDown
                    className={cn(
                      'h-4 w-4 text-slate-400 transition-transform duration-200',
                      isOpen ? 'rotate-180' : ''
                    )}
                  />
                </div>
              </button>

              {isOpen && (
                <div className="grid gap-1.5 p-2 pt-0">
                  {group.manifests.map((manifest) => (
                    <CatalogItemCard
                      key={manifest.type}
                      manifest={manifest}
                      copy={getNodeCopy(manifest)}
                      Icon={getNodeIcon(manifest.type)}
                      accent={getNodeAccent(manifest.category)}
                      onAdd={() => onAddCatalogItem(manifest)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Advanced Attachments Accordion */}
        {showAdvanced && (
          <div className="rounded-xl border border-white/[0.06] bg-[#0e1620]/60 overflow-hidden transition">
            <button
              type="button"
              onClick={() => toggleCategory('advanced')}
              className="flex w-full items-center justify-between px-3 py-2.5 text-left transition hover:bg-white/[0.03]"
            >
              <div className="flex items-center gap-2.5">
                <div className="flex h-6 w-6 items-center justify-center rounded-md border border-slate-700/60 bg-slate-800/80 text-slate-300">
                  <Settings2 className="h-3.5 w-3.5" />
                </div>
                <div>
                  <span className="text-xs font-semibold text-slate-200">Recursos Avançados</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-white/[0.04] border border-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
                  {attachmentManifests.length}
                </span>
                <ChevronDown
                  className={cn(
                    'h-4 w-4 text-slate-400 transition-transform duration-200',
                    openCategories.has('advanced') ? 'rotate-180' : ''
                  )}
                />
              </div>
            </button>

            {openCategories.has('advanced') && (
              <div className="space-y-2 p-2 pt-0">
                <p className="px-1 text-[11px] leading-relaxed text-slate-400">
                  Normalmente modelo, memória e proteções são configurados dentro do próprio Agente de IA.
                </p>
                <div className="grid gap-1.5">
                  {attachmentManifests.map((manifest) => (
                    <CatalogItemCard
                      key={manifest.type}
                      manifest={manifest}
                      copy={getNodeCopy(manifest)}
                      Icon={getNodeIcon(manifest.type)}
                      accent={getNodeAccent(manifest.category)}
                      onAdd={() => onAddCatalogItem(manifest)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tools loading state */}
        {editorMode === 'advanced' && toolsLoading && (
          <div className="flex items-center gap-2.5 rounded-xl border border-white/[0.06] bg-[#0e1620]/60 p-3 text-xs text-slate-300">
            <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
            <span>Carregando catálogo de ferramentas…</span>
          </div>
        )}

        {/* Agent Tools Library */}
        {libraryToolGroups.length > 0 && (
          <div className="rounded-xl border border-white/[0.06] bg-[#0e1620]/60 overflow-hidden transition">
            <button
              type="button"
              onClick={() => toggleCategory('tools')}
              className="flex w-full items-center justify-between px-3 py-2.5 text-left transition hover:bg-white/[0.03]"
            >
              <div className="flex items-center gap-2.5">
                <div className="flex h-6 w-6 items-center justify-center rounded-md border border-slate-700/60 bg-slate-800/80 text-slate-300">
                  <Wrench className="h-3.5 w-3.5" />
                </div>
                <div>
                  <span className="text-xs font-semibold text-slate-200">Ferramentas & Integrações MCP</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <ChevronDown
                  className={cn(
                    'h-4 w-4 text-slate-400 transition-transform duration-200',
                    openCategories.has('tools') ? 'rotate-180' : ''
                  )}
                />
              </div>
            </button>

            {openCategories.has('tools') && (
              <div className="space-y-3 p-2 pt-0">
                {libraryToolGroups.map((group) => (
                  <div key={group.id} className="space-y-1">
                    <p className="px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      {group.label}
                    </p>
                    <div className="grid gap-1.5">
                      {group.tools.map((tool) => {
                        const eligible = isNativeAgentToolAttachable(tool);
                        const label = getNativeAgentToolLabel(tool);
                        const reason = getNativeAgentToolUnavailableReason(tool);

                        return (
                          <button
                            key={tool.name}
                            type="button"
                            draggable={eligible}
                            disabled={!eligible}
                            title={reason || tool.description}
                            onClick={() => onAddToolFromLibrary(tool)}
                            onDragStart={(event) =>
                              event.dataTransfer.setData(
                                'application/dialogy-workflow-tool',
                                JSON.stringify(tool)
                              )
                            }
                            className="group flex w-full items-center gap-2.5 rounded-xl border border-white/[0.04] bg-[#111822]/80 p-2 text-left transition hover:border-slate-600 hover:bg-[#16212e] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-700/60 bg-slate-800/90 text-slate-300">
                              <Wrench className="h-3.5 w-3.5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-medium text-slate-200 group-hover:text-white">
                                {label}
                              </span>
                              <span className="block truncate text-[10px] text-slate-400">
                                {reason || tool.description}
                              </span>
                            </div>
                            <span className="text-[10px] font-medium text-slate-400 opacity-0 group-hover:opacity-100 transition">
                              + Inserir
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Empty State */}
        {!toolsLoading &&
          !showRecommended &&
          displayedGroups.length === 0 &&
          !showAdvanced &&
          libraryToolGroups.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-800 bg-white/[0.01] p-6 text-center">
              <HelpCircle className="mx-auto mb-2 h-7 w-7 text-slate-500 opacity-60" />
              <p className="text-xs font-medium text-slate-300">Nenhum bloco encontrado</p>
              <p className="mt-1 text-[11px] text-slate-500">
                Tente buscar por termos como "mensagem", "condição", "agente" ou "webhook".
              </p>
              {query && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => onQueryChange('')}
                  className="mt-3 h-7 rounded-lg border-slate-700 bg-slate-800/80 text-[11px] text-slate-300 hover:bg-slate-700 hover:text-white"
                >
                  Limpar busca
                </Button>
              )}
            </div>
          )}
      </div>
    </aside>
  );
}

function CatalogItemCard({
  manifest,
  copy,
  Icon,
  accent,
  onAdd,
}: {
  manifest: WorkflowNodeManifest;
  copy: { label: string; description: string };
  Icon: LucideIcon;
  accent: string;
  onAdd: () => void;
}) {
  return (
    <button
      type="button"
      draggable
      onClick={onAdd}
      title={`Adicionar ${copy.label}${manifest.attachment ? '' : ' e conectar ao bloco selecionado'}`}
      onDragStart={(event) => {
        event.dataTransfer.setData('application/dialogy-workflow-node', manifest.type);
        event.dataTransfer.effectAllowed = 'copy';
      }}
      className="group relative flex w-full items-start gap-2.5 rounded-xl border border-white/[0.04] bg-[#111822]/80 p-2 text-left transition-all duration-150 hover:border-slate-600/70 hover:bg-[#16212e] active:scale-[0.99] cursor-grab active:cursor-grabbing"
    >
      <div
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-700/60 bg-slate-800/90 text-slate-300 shadow-xs group-hover:border-slate-500 group-hover:text-white transition mt-0.5"
      >
        <Icon className="h-3.5 w-3.5" />
      </div>

      <div className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold text-slate-200 group-hover:text-white transition">
          {copy.label}
        </span>
        <span className="block truncate text-[10px] leading-tight text-slate-400 mt-0.5">
          {copy.description}
        </span>
      </div>

      <div className="flex items-center gap-1 self-center opacity-0 group-hover:opacity-100 transition shrink-0">
        <span className="rounded border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-[9px] font-medium text-slate-400 group-hover:text-slate-200">
          + Inserir
        </span>
      </div>
    </button>
  );
}
