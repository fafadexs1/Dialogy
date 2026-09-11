'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Code,
  Combine,
  Copy,
  Database,
  Eraser,
  ExternalLink,
  Eye,
  FileCheck,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  Layers,
  List,
  ListOrdered,
  Lock,
  Pencil,
  Plus,
  Quote,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Split,
  Table,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import { createClientUuid } from '@/lib/client-uuid';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { AgentStudioDocument } from '@/services/agent-studio/types';
import type { KnowledgeBaseDocument, KnowledgeCollection } from '@/lib/types';
import { importStudioKnowledgeFileAction, optimizeStudioKnowledgeAction } from '@/actions/agent-studio';
import { cleanDocumentText } from '@/services/agent-studio/knowledge-text';

type Props = {
  document: AgentStudioDocument;
  onChange: (document: AgentStudioDocument) => void;
  collections: KnowledgeCollection[];
  documents: KnowledgeBaseDocument[];
};

type InlineSource = NonNullable<AgentStudioDocument['inlineKnowledge']>[number];
type EditorTab = 'editor' | 'preview' | 'pages' | 'metadata' | 'protection';

const RAG_CANONICAL_TEMPLATE = `# Nome da Política ou Procedimento

## Resumo para Recuperação RAG
Explique em 2 a 3 frases o objetivo desta informação para o agente localizar com precisão.

## Regras e Condições Oficiais
- Regra 1: Definição clara, exata e sem ambiguidades.
- Regra 2: Valores, prazos e condições obrigatórias (ex: R$ 0,00, até 24h úteis).

## Exceções e Restrições
- Casos em que a regra acima NÃO se aplica.
- Quando a IA deve transferir o cliente para atendimento humano.

## Perguntas Frequentes e Respostas Oficiais (FAQ)
**P: Qual é a pergunta mais comum feita pelo cliente?**
R: Resposta oficial direta e objetiva, sem informações desnecessárias.
`;

function estimateRagChunks(text: string): number {
  const chars = text.trim().length;
  if (!chars) return 0;
  return Math.max(1, Math.ceil(chars / 800));
}

function computeClientHash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  const hex = Math.abs(hash).toString(16).padStart(8, '0');
  return `sha256_${hex}${hex}${hex}${hex}`.slice(0, 64);
}

function SimpleMarkdownPreview({ content }: { content: string }) {
  if (!content.trim()) {
    return (
      <div className="flex min-h-[300px] flex-col items-center justify-center p-8 text-center text-slate-400">
        <FileText className="mb-2 h-8 w-8 text-slate-300" />
        <p className="text-xs">Nenhum conteúdo para visualizar.</p>
        <p className="text-[11px] text-slate-400">Escreva no editor para ver o texto formatado aqui.</p>
      </div>
    );
  }

  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeBuffer: string[] = [];
  let inTable = false;
  let tableRows: string[][] = [];

  const flushCode = (index: number) => {
    if (codeBuffer.length) {
      elements.push(
        <pre key={`code_${index}`} className="my-3 overflow-x-auto rounded-xl bg-slate-900 p-4 font-mono text-xs text-emerald-300">
          <code>{codeBuffer.join('\n')}</code>
        </pre>
      );
      codeBuffer = [];
    }
  };

  const flushTable = (index: number) => {
    if (tableRows.length) {
      const header = tableRows[0];
      const rows = tableRows.slice(1).filter((r) => !r.every((c) => /^[ -:]+$/.test(c)));
      elements.push(
        <div key={`table_${index}`} className="my-4 overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-left text-xs">
            {header && (
              <thead className="bg-slate-100 text-slate-700">
                <tr>{header.map((col, cIdx) => <th key={cIdx} className="border-b border-slate-200 px-3 py-2 font-semibold">{col.trim()}</th>)}</tr>
              </thead>
            )}
            <tbody>
              {rows.map((row, rIdx) => (
                <tr key={rIdx} className={rIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                  {row.map((cell, cIdx) => <td key={cIdx} className="border-b border-slate-100 px-3 py-2 text-slate-600">{cell.trim()}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      tableRows = [];
    }
  };

  lines.forEach((line, index) => {
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        flushCode(index);
        inCodeBlock = false;
      } else {
        if (inTable) { flushTable(index); inTable = false; }
        inCodeBlock = true;
      }
      return;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      return;
    }

    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      inTable = true;
      const cells = line.trim().slice(1, -1).split('|');
      tableRows.push(cells);
      return;
    } else if (inTable) {
      flushTable(index);
      inTable = false;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      elements.push(<div key={`empty_${index}`} className="h-2" />);
      return;
    }

    if (trimmed.startsWith('# ')) {
      elements.push(<h1 key={index} className="mt-5 border-b border-slate-200 pb-2 text-base font-bold text-slate-950">{trimmed.slice(2)}</h1>);
    } else if (trimmed.startsWith('## ')) {
      elements.push(<h2 key={index} className="mt-4 text-sm font-bold text-violet-950">{trimmed.slice(3)}</h2>);
    } else if (trimmed.startsWith('### ')) {
      elements.push(<h3 key={index} className="mt-3 text-xs font-bold text-slate-800">{trimmed.slice(4)}</h3>);
    } else if (trimmed.startsWith('> ')) {
      const isRule = trimmed.toLowerCase().includes('regra') || trimmed.toLowerCase().includes('importante');
      elements.push(
        <blockquote key={index} className={`my-2 rounded-r-xl border-l-4 p-3 text-xs leading-relaxed ${isRule ? 'border-amber-500 bg-amber-50/80 text-amber-950' : 'border-violet-500 bg-violet-50/70 text-violet-950'}`}>
          {trimmed.slice(2)}
        </blockquote>
      );
    } else if (trimmed.startsWith('- [ ] ') || trimmed.startsWith('- [x] ')) {
      const checked = trimmed.startsWith('- [x] ');
      elements.push(
        <div key={index} className="flex items-center gap-2 py-0.5 text-xs text-slate-700">
          <input type="checkbox" readOnly checked={checked} className="rounded text-violet-600" />
          <span className={checked ? 'line-through text-slate-400' : ''}>{trimmed.slice(6)}</span>
        </div>
      );
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      elements.push(
        <li key={index} className="ml-4 list-disc text-xs leading-relaxed text-slate-700">
          {trimmed.slice(2)}
        </li>
      );
    } else if (/^\d+\.\s/.test(trimmed)) {
      elements.push(
        <li key={index} className="ml-4 list-decimal text-xs leading-relaxed text-slate-700">
          {trimmed.replace(/^\d+\.\s/, '')}
        </li>
      );
    } else if (trimmed === '---') {
      elements.push(<hr key={index} className="my-4 border-slate-200" />);
    } else {
      elements.push(<p key={index} className="text-xs leading-relaxed text-slate-700">{trimmed}</p>);
    }
  });

  if (inCodeBlock) flushCode(lines.length);
  if (inTable) flushTable(lines.length);

  return <div className="space-y-2 p-5">{elements}</div>;
}

export function StudioKnowledgeSources({ document, onChange, collections, documents }: Props) {
  const [error, setError] = useState('');
  const [successNotice, setSuccessNotice] = useState('');
  const [importing, setImporting] = useState(false);
  const [optimizingSourceId, setOptimizingSourceId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [dragging, setDragging] = useState(false);
  const [openSourceId, setOpenSourceId] = useState<string | null>(null);
  const [activeTabBySource, setActiveTabBySource] = useState<Record<string, EditorTab>>({});
  const [activePageBySource, setActivePageBySource] = useState<Record<string, number>>({});
  const [editorSearch, setEditorSearch] = useState('');
  const [editorReplace, setEditorReplace] = useState('');
  const [showReplaceBar, setShowReplaceBar] = useState(false);
  const [inspectingCatalogDoc, setInspectingCatalogDoc] = useState<KnowledgeBaseDocument | null>(null);

  const currentDocument = useRef(document);
  currentDocument.current = document;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const defaultCollectionId = collections.find((c) => c.isDefault)?.id || collections[0]?.id || 'general';
  const normalizedDocuments = documents.map((source) => ({
    ...source,
    collectionIds: (Array.isArray(source.collectionIds) && source.collectionIds.length > 0)
      ? source.collectionIds
      : [defaultCollectionId],
  }));

  const sources = document.inlineKnowledge || [];
  const selected = document.resolveStage.knowledgeCollectionIds;
  const selectedSet = new Set(selected);
  const activeDocuments = normalizedDocuments.filter((source) => !['draft', 'archived', 'expired'].includes(source.status || 'active'));
  const selectedDocuments = activeDocuments.filter((source) => selectedSet.has(source.id) || (source.collectionIds || []).some((id) => selectedSet.has(id)));
  const selectedInline = sources.filter((source) => selectedSet.has(source.id));
  const activeCount = selectedDocuments.length + selectedInline.length;
  const normalizedSearch = search.trim().toLocaleLowerCase('pt-BR');
  const visibleDocuments = normalizedSearch
    ? activeDocuments.filter((source) => `${source.name} ${source.category || ''}`.toLocaleLowerCase('pt-BR').includes(normalizedSearch))
    : activeDocuments;

  useEffect(() => {
    if (!successNotice) return;
    const timer = setTimeout(() => setSuccessNotice(''), 4000);
    return () => clearTimeout(timer);
  }, [successNotice]);

  const toggle = (id: string, checked: boolean) => onChange({
    ...document,
    resolveStage: {
      ...document.resolveStage,
      knowledgeCollectionIds: checked ? [...new Set([...selected, id])] : selected.filter((value) => value !== id),
    },
  });

  const updateSource = (sourceId: string, patch: Partial<InlineSource>) => {
    onChange({
      ...document,
      inlineKnowledge: sources.map((source) => {
        if (source.id !== sourceId) return source;
        const updated = { ...source, ...patch };
        if ('content' in patch) {
          updated.contentHash = computeClientHash(patch.content || '');
        }
        return updated;
      }),
    });
  };

  const add = () => {
    if (sources.length >= 20) {
      setError('Você pode adicionar até 20 fontes diretamente neste agente.');
      return;
    }
    const id = `source_${createClientUuid()}`;
    const newSource: InlineSource = {
      id,
      name: 'Nova política ou instrução',
      content: '',
      sourceType: 'manual',
      importedAt: new Date().toISOString(),
      contentHash: computeClientHash(''),
      contextRole: 'policy',
    };
    onChange({
      ...document,
      inlineKnowledge: [...sources, newSource],
      resolveStage: { ...document.resolveStage, knowledgeCollectionIds: [...new Set([...selected, id])] },
    });
    setOpenSourceId(id);
    setActiveTabBySource((prev) => ({ ...prev, [id]: 'editor' }));
  };

  const importFile = async (file: File) => {
    if (sources.length >= 20) {
      setError('Você pode adicionar até 20 fontes diretamente neste agente.');
      return;
    }
    setError('');
    setImporting(true);
    try {
      const formData = new FormData();
      formData.set('file', file);
      const result = await importStudioKnowledgeFileAction(document.id, formData);
      if (!result.success) throw new Error(result.error);
      const current = currentDocument.current;
      onChange({
        ...current,
        inlineKnowledge: [...(current.inlineKnowledge || []), result.source],
        resolveStage: {
          ...current.resolveStage,
          knowledgeCollectionIds: [...new Set([...current.resolveStage.knowledgeCollectionIds, result.source.id])],
        },
      });
      setOpenSourceId(result.source.id);
      setActiveTabBySource((prev) => ({ ...prev, [result.source.id]: 'editor' }));
      setSuccessNotice(`Arquivo “${file.name}” lido e indexado com sucesso no RAG deste agente.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível importar o arquivo.');
    } finally {
      setImporting(false);
    }
  };

  const copyCatalogDocumentToAgent = (catalogDoc: KnowledgeBaseDocument) => {
    if (sources.length >= 20) {
      setError('Limite de 20 fontes por agente atingido. Remova alguma antes de importar outra.');
      return;
    }
    const id = `source_${createClientUuid()}`;
    const importedSource: InlineSource = {
      id,
      name: `${catalogDoc.name} (Cópia personalizada)`,
      content: catalogDoc.content || '',
      sourceType: 'manual',
      importedAt: new Date().toISOString(),
      contentHash: computeClientHash(catalogDoc.content || ''),
      summary: catalogDoc.summary || undefined,
      category: catalogDoc.category || undefined,
      canonicalAnswer: catalogDoc.canonicalAnswer || undefined,
      contextRole: (catalogDoc.contextRole as InlineSource['contextRole']) || 'fact',
      tags: catalogDoc.tags || [],
    };
    onChange({
      ...document,
      inlineKnowledge: [...sources, importedSource],
      resolveStage: { ...document.resolveStage, knowledgeCollectionIds: [...new Set([...selected, id])] },
    });
    setInspectingCatalogDoc(null);
    setOpenSourceId(id);
    setActiveTabBySource((prev) => ({ ...prev, [id]: 'editor' }));
    setSuccessNotice(`Cópia de “${catalogDoc.name}” adicionada às fontes exclusivas deste agente para edição.`);
  };

  const receiveFile = (files: FileList | null) => {
    const file = files?.[0];
    if (file) void importFile(file);
  };

  const updatePage = (source: InlineSource, pageIndex: number, newPageContent: string) => {
    const pages = (source.pages || []).map((page, index) => index === pageIndex ? { ...page, content: newPageContent } : page);
    const combined = pages.map((page) => page.content).join('\n\n');
    if (combined.length > 100_000) {
      setError('O documento pode ter até 100 mil caracteres. Reduza o texto de alguma página.');
      return;
    }
    setError('');
    updateSource(source.id, { pages, content: combined });
  };

  const addPageToSource = (source: InlineSource) => {
    const pages = source.pages || [];
    const newPageNumber = pages.length + 1;
    const newPages = [...pages, { number: newPageNumber, content: '' }];
    updateSource(source.id, { pages: newPages });
    setActivePageBySource((prev) => ({ ...prev, [source.id]: newPages.length - 1 }));
    setSuccessNotice(`Página ${newPageNumber} adicionada.`);
  };

  const deletePageFromSource = (source: InlineSource, pageIndex: number) => {
    const pages = source.pages || [];
    if (pages.length <= 1) {
      setError('Um documento com páginas precisa ter pelo menos 1 página. Para remover o documento, use o ícone da lixeira.');
      return;
    }
    const filtered = pages.filter((_, idx) => idx !== pageIndex);
    const renumbered = filtered.map((p, idx) => ({ ...p, number: idx + 1 }));
    const combined = renumbered.map((p) => p.content).join('\n\n');
    updateSource(source.id, { pages: renumbered, content: combined });
    setActivePageBySource((prev) => ({ ...prev, [source.id]: Math.max(0, pageIndex - 1) }));
    setSuccessNotice('Página removida.');
  };

  const mergePagesToContinuous = (source: InlineSource) => {
    const combined = (source.pages || []).map((p) => p.content).join('\n\n').trim();
    updateSource(source.id, { pages: undefined, content: combined });
    setSuccessNotice('Páginas mescladas em documento de texto contínuo.');
  };

  const splitContinuousToPages = (source: InlineSource) => {
    const blocks = source.content.split(/\n---\n/).map((b) => b.trim()).filter(Boolean);
    const pages = blocks.length > 1
      ? blocks.map((content, idx) => ({ number: idx + 1, content }))
      : [{ number: 1, content: source.content }];
    updateSource(source.id, { pages });
    setActivePageBySource((prev) => ({ ...prev, [source.id]: 0 }));
    setSuccessNotice(`Documento dividido em ${pages.length} página(s).`);
  };

  const applyFormatting = (source: InlineSource, prefix: string, suffix = '') => {
    const textarea = textareaRef.current;
    if (!textarea) {
      updateSource(source.id, { content: `${source.content}\n${prefix}${suffix}`.trim() });
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = textarea.value;
    const selectedText = value.slice(start, end) || 'texto';
    const replacement = `${prefix}${selectedText}${suffix}`;
    const nextContent = value.slice(0, start) + replacement + value.slice(end);
    if (nextContent.length > 100_000) {
      setError('O documento pode ter até 100 mil caracteres.');
      return;
    }
    updateSource(source.id, { content: nextContent });
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, start + prefix.length + selectedText.length);
    }, 50);
  };

  const handleCleanText = (source: InlineSource) => {
    const cleaned = cleanDocumentText(source.content);
    const updatedPages = source.pages?.map((p) => ({ ...p, content: cleanDocumentText(p.content) }));
    updateSource(source.id, { content: cleaned, pages: updatedPages });
    setSuccessNotice('Texto limpo e normalizado (quebras de linha desnecessárias, hifens e espaços duplos corrigidos).');
  };

  const handleInsertTemplate = (source: InlineSource) => {
    if (source.content.trim().length > 0) {
      if (!confirm('Inserir o modelo substituirá o texto atual. Deseja continuar?')) return;
    }
    updateSource(source.id, { content: RAG_CANONICAL_TEMPLATE, pages: undefined });
    setSuccessNotice('Modelo RAG Canônico inserido com sucesso.');
  };

  const handleReplaceAll = (source: InlineSource) => {
    if (!editorSearch) return;
    const re = new RegExp(editorSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const replaced = source.content.replace(re, editorReplace);
    updateSource(source.id, { content: replaced });
    setSuccessNotice('Substituições concluídas.');
  };

  const handleAiOptimize = async (source: InlineSource) => {
    if (!source.content.trim()) {
      setError('Adicione texto antes de solicitar a otimização por IA.');
      return;
    }
    setError('');
    setOptimizingSourceId(source.id);
    try {
      const res = await optimizeStudioKnowledgeAction(document.id, {
        name: source.name,
        content: source.content,
        category: source.category,
      });
      if (!res.success || !res.improved) throw new Error(res.error || 'Falha ao otimizar com IA.');
      updateSource(source.id, {
        content: res.improved.content,
        name: res.improved.name || source.name,
        summary: res.improved.summary,
        category: res.improved.category,
        tags: res.improved.tags,
        contextRole: (res.improved.contextRole as InlineSource['contextRole']) || source.contextRole,
        canonicalAnswer: res.improved.canonicalAnswer,
        pages: undefined, // AI generates continuous optimized markdown
      });
      setSuccessNotice('✨ Documento otimizado com sucesso para recuperação semântica RAG!');
      setActiveTabBySource((prev) => ({ ...prev, [source.id]: 'preview' }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erro ao otimizar documento com IA.');
    } finally {
      setOptimizingSourceId(null);
    }
  };

  return (
    <section className="mt-3 overflow-hidden rounded-2xl border border-violet-200 bg-white shadow-sm">
      {/* Header Banner */}
      <div className="border-b border-violet-100 bg-gradient-to-r from-violet-50 via-white to-sky-50 px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white shadow-sm">
              <BookOpen className="h-5 w-5" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-bold text-slate-950">Conhecimento e RAG do Agente</h4>
                <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-[10px] font-semibold text-emerald-800">
                  <ShieldCheck className="mr-1 h-3 w-3 text-emerald-600" />
                  Grounding Ativo
                </Badge>
              </div>
              <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-slate-600">
                Gerencie, edite de forma profissional e acompanhe o status de leitura e proteção de todos os documentos consultados pela IA.
              </p>
            </div>
          </div>
          <Badge className={activeCount ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100' : 'bg-amber-100 text-amber-800 hover:bg-amber-100'}>
            {activeCount ? `${activeCount} fonte${activeCount === 1 ? '' : 's'} protegida${activeCount === 1 ? '' : 's'} no RAG` : 'Configure uma fonte'}
          </Badge>
        </div>

        {/* 3 Pillars of RAG Protection */}
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <div className="flex gap-2.5 rounded-xl border border-white bg-white/80 p-2.5 shadow-2xs">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
              <FileCheck className="h-3.5 w-3.5" />
            </span>
            <div>
              <strong className="block text-[11px] text-slate-800">1. Leitura e Chunks RAG</strong>
              <span className="block text-[10px] leading-snug text-slate-500">
                PDFs e textos lidos, divididos em passagens semânticas e indexados.
              </span>
            </div>
          </div>
          <div className="flex gap-2.5 rounded-xl border border-white bg-white/80 p-2.5 shadow-2xs">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
              <ShieldCheck className="h-3.5 w-3.5" />
            </span>
            <div>
              <strong className="block text-[11px] text-slate-800">2. Proteção Anti-Alucinação</strong>
              <span className="block text-[10px] leading-snug text-slate-500">
                A IA é blindada sob estas fontes e proibida de inventar fatos ausentes.
              </span>
            </div>
          </div>
          <div className="flex gap-2.5 rounded-xl border border-white bg-white/80 p-2.5 shadow-2xs">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
              <Lock className="h-3.5 w-3.5" />
            </span>
            <div>
              <strong className="block text-[11px] text-slate-800">3. Integridade e Snapshot</strong>
              <span className="block text-[10px] leading-snug text-slate-500">
                Hash SHA-256 e versão imutável que protege atendimentos em andamento.
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-5 p-4 sm:p-5">
        {/* Global Catalog Documents */}
        {(collections.length > 0 || activeDocuments.length > 0) && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h5 className="text-xs font-bold text-slate-900">Fontes já disponíveis no Workspace</h5>
                <p className="mt-0.5 text-[10px] text-slate-500">
                  Marque as bases autorizadas para este agente ou inspecione o conteúdo para importar uma cópia personalizada.
                </p>
              </div>
              {activeDocuments.length > 4 && (
                <label className="relative w-full sm:w-56">
                  <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    className="h-9 pl-9 text-xs"
                    placeholder="Buscar uma fonte"
                  />
                </label>
              )}
            </div>

            {/* Collections */}
            {collections.length > 0 && (
              <div className="grid gap-2 sm:grid-cols-2">
                {collections.map((collection) => {
                  const checked = selectedSet.has(collection.id);
                  const count = activeDocuments.filter((source) => (source.collectionIds || []).includes(collection.id)).length;
                  return (
                    <label
                      key={collection.id}
                      className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition ${checked ? 'border-violet-400 bg-violet-50 ring-1 ring-violet-100' : 'border-slate-200 hover:border-violet-300 hover:bg-slate-50'}`}
                    >
                      <input
                        className="sr-only"
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => toggle(collection.id, event.target.checked)}
                      />
                      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${checked ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                        {checked ? <Check className="h-4 w-4" /> : <Database className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold text-slate-800">{collection.name}</span>
                        <span className="block truncate text-[10px] text-slate-500">{collection.description || `${count} documento${count === 1 ? '' : 's'}`}</span>
                      </span>
                      <Badge variant="outline" className={`text-[9px] ${checked ? 'border-violet-300 bg-violet-100/50 text-violet-800' : 'text-slate-400'}`}>
                        {checked ? 'RAG Ativo' : 'Inativo'}
                      </Badge>
                    </label>
                  );
                })}
              </div>
            )}

            {/* Catalog Documents List */}
            {visibleDocuments.length > 0 && (
              <div className="grid gap-2 sm:grid-cols-2">
                {visibleDocuments.map((source) => {
                  const direct = selectedSet.has(source.id);
                  const viaCollection = (source.collectionIds || []).some((id) => selectedSet.has(id));
                  const enabled = direct || viaCollection;
                  const words = source.content?.trim() ? source.content.trim().split(/\s+/).length : 0;
                  return (
                    <div
                      key={source.id}
                      className={`flex items-center justify-between gap-2 rounded-xl border p-3 transition ${enabled ? 'border-sky-300 bg-sky-50/70' : 'border-slate-200 hover:border-sky-300 hover:bg-slate-50'}`}
                    >
                      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                        <input
                          className="sr-only"
                          type="checkbox"
                          checked={direct}
                          onChange={(event) => toggle(source.id, event.target.checked)}
                        />
                        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${enabled ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                          {enabled ? <Check className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-semibold text-slate-800">{source.name}</span>
                          <span className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-500">
                            <span>{viaCollection && !direct ? 'Incluído pela coleção' : source.category || 'Catálogo Geral'}</span>
                            <span>·</span>
                            <span>{words} palavras</span>
                          </span>
                        </span>
                      </label>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Badge variant="outline" className={`text-[9px] ${enabled ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'text-slate-400'}`}>
                          {enabled ? 'Protegido' : 'Inativo'}
                        </Badge>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-[10px] text-slate-600 hover:bg-sky-100"
                          onClick={() => setInspectingCatalogDoc(source)}
                        >
                          <Eye className="mr-1 h-3 w-3" />
                          Inspecionar
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {normalizedSearch && !visibleDocuments.length && (
              <p className="rounded-xl bg-slate-50 p-3 text-center text-[11px] text-slate-500">
                Nenhuma fonte encontrada com “{search}”.
              </p>
            )}
          </div>
        )}

        {/* Add Knowledge Section */}
        <div className="space-y-3 border-t border-slate-100 pt-5">
          <div>
            <h5 className="text-xs font-bold text-slate-900">Adicione conhecimento exclusivo para este Agente</h5>
            <p className="mt-0.5 text-[10px] text-slate-500">
              Faça upload de PDFs ou textos, ou escreva políticas que você poderá editar de forma profissional abaixo.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label
              className={`flex min-h-24 cursor-pointer items-center gap-3 rounded-xl border border-dashed p-4 transition ${dragging ? 'border-violet-500 bg-violet-50' : 'border-slate-300 bg-slate-50/70 hover:border-violet-400 hover:bg-violet-50/50'} ${importing ? 'cursor-wait opacity-60' : ''}`}
              onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                receiveFile(event.dataTransfer.files);
              }}
            >
              <UploadCloud className="h-7 w-7 shrink-0 text-violet-600" />
              <span>
                <strong className="block text-xs text-slate-800">{importing ? 'Lendo e extraindo RAG…' : 'Enviar PDF, TXT ou Markdown'}</strong>
                <span className="mt-1 block text-[10px] leading-snug text-slate-500">
                  Clique ou arraste aqui. O arquivo é lido, dividido em passagens e protegido pelo RAG.
                </span>
              </span>
              <input
                className="sr-only"
                type="file"
                disabled={importing || sources.length >= 20}
                accept=".pdf,.txt,.md,.csv,.json,application/pdf,text/plain,text/markdown,text/csv,application/json"
                onChange={(event) => {
                  receiveFile(event.target.files);
                  event.target.value = '';
                }}
              />
            </label>
            <button
              type="button"
              onClick={add}
              disabled={sources.length >= 20 || importing}
              className="flex min-h-24 items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-4 text-left transition hover:border-emerald-400 hover:bg-emerald-50/50 disabled:opacity-50"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                <Plus className="h-5 w-5" />
              </span>
              <span>
                <strong className="block text-xs text-slate-800">Criar informação do zero</strong>
                <span className="mt-1 block text-[10px] leading-snug text-slate-500">
                  Escreva e estruture políticas, tabelas de preços e FAQs diretamente no editor profissional.
                </span>
              </span>
            </button>
          </div>
        </div>

        {/* Inline Sources List & Professional Editor */}
        {sources.length > 0 && (
          <div className="space-y-3 border-t border-slate-100 pt-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h5 className="text-xs font-bold text-slate-900">Fontes Exclusivas deste Agente</h5>
                <p className="mt-0.5 text-[10px] text-slate-500">
                  Abra uma fonte para editar com ferramentas profissionais e inspecionar o status de leitura e proteção RAG.
                </p>
              </div>
              <Badge variant="outline" className="text-[10px] text-slate-500">
                {sources.length} de 20 fontes configuradas
              </Badge>
            </div>

            <div className="space-y-3">
              {sources.map((source) => {
                const isOpen = openSourceId === source.id;
                const activeTab = activeTabBySource[source.id] || 'editor';
                const pageCount = source.pages?.length || 0;
                const words = source.content.trim() ? source.content.trim().split(/\s+/).length : 0;
                const chars = source.content.length;
                const isProtected = selectedSet.has(source.id);
                const estimatedChunks = estimateRagChunks(source.content);
                const isOptimizing = optimizingSourceId === source.id;
                const currentPageIndex = Math.min(activePageBySource[source.id] || 0, Math.max(0, pageCount - 1));
                const currentPage = source.pages?.[currentPageIndex];
                const matches = editorSearch.trim()
                  ? (source.content.toLocaleLowerCase('pt-BR').match(new RegExp(editorSearch.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').toLocaleLowerCase('pt-BR'), 'g')) || []).length
                  : 0;
                const hashDisplay = source.contentHash || computeClientHash(source.content);

                return (
                  <article
                    key={source.id}
                    className={`overflow-hidden rounded-2xl border transition ${isOpen ? 'border-violet-400 bg-white shadow-md ring-1 ring-violet-200' : 'border-slate-200 bg-white hover:border-violet-200'}`}
                  >
                    {/* Header Row */}
                    <div className="flex flex-wrap items-center gap-3 p-3.5">
                      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${source.mimeType === 'application/pdf' ? 'bg-red-50 text-red-600' : source.sourceType === 'file' ? 'bg-sky-50 text-sky-600' : 'bg-emerald-50 text-emerald-600'}`}>
                        <FileText className="h-5 w-5" />
                      </span>

                      <button
                        type="button"
                        onClick={() => {
                          setOpenSourceId(isOpen ? null : source.id);
                          setEditorSearch('');
                        }}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-xs font-bold text-slate-900">{source.name}</span>
                          {/* RAG Read Status Badge */}
                          {chars > 15 ? (
                            <Badge className="border-emerald-200 bg-emerald-50 text-[9px] font-semibold text-emerald-800">
                              <CheckCircle2 className="mr-1 h-3 w-3 text-emerald-600" />
                              Lido pelo RAG
                            </Badge>
                          ) : (
                            <Badge className="border-amber-200 bg-amber-50 text-[9px] font-semibold text-amber-800">
                              <AlertTriangle className="mr-1 h-3 w-3 text-amber-600" />
                              Sem texto legível
                            </Badge>
                          )}
                          {/* RAG Protection Badge */}
                          {isProtected ? (
                            <Badge className="border-violet-200 bg-violet-50 text-[9px] font-semibold text-violet-800">
                              <ShieldCheck className="mr-1 h-3 w-3 text-violet-600" />
                              Protegido sob RAG
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[9px] text-slate-400">
                              Não protegido (Inativo)
                            </Badge>
                          )}
                        </div>

                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
                          <span>{source.sourceType === 'file' ? source.fileName || 'Arquivo' : 'Manual'}</span>
                          <span>·</span>
                          {pageCount > 0 && (
                            <>
                              <span>{pageCount} página{pageCount === 1 ? '' : 's'} lida{pageCount === 1 ? '' : 's'}</span>
                              <span>·</span>
                            </>
                          )}
                          <span>{words.toLocaleString('pt-BR')} palavras</span>
                          <span>·</span>
                          <span className="font-medium text-slate-700">~{estimatedChunks} chunk{estimatedChunks === 1 ? '' : 's'} RAG</span>
                        </div>
                      </button>

                      {/* Protection Toggle Checkbox */}
                      <label className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[10px] font-semibold transition ${isProtected ? 'border-violet-300 bg-violet-50 text-violet-800' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                        <input
                          type="checkbox"
                          className="rounded text-violet-600"
                          checked={isProtected}
                          onChange={(event) => toggle(source.id, event.target.checked)}
                        />
                        {isProtected ? 'Protegido no RAG' : 'Ativar no RAG'}
                      </label>

                      {/* Edit Button */}
                      <Button
                        type="button"
                        size="sm"
                        variant={isOpen ? 'default' : 'outline'}
                        className={`h-8 text-[10px] ${isOpen ? 'bg-violet-600 text-white hover:bg-violet-500' : ''}`}
                        onClick={() => {
                          setOpenSourceId(isOpen ? null : source.id);
                          setEditorSearch('');
                        }}
                      >
                        <Pencil className="mr-1 h-3 w-3" />
                        {isOpen ? 'Fechar' : 'Editar'}
                      </Button>

                      {/* Remove Button */}
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-slate-400 hover:text-red-600"
                        aria-label={`Remover fonte ${source.name}`}
                        onClick={() => {
                          if (openSourceId === source.id) setOpenSourceId(null);
                          onChange({
                            ...document,
                            inlineKnowledge: sources.filter((item) => item.id !== source.id),
                            resolveStage: {
                              ...document.resolveStage,
                              knowledgeCollectionIds: selected.filter((id) => id !== source.id),
                            },
                          });
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    {/* Expanded Professional Workstation */}
                    {isOpen && (
                      <div className="border-t border-slate-200 bg-slate-50/70 p-4 sm:p-5">
                        {/* Title & Metadata row */}
                        <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_200px]">
                          <label className="block text-[11px] font-semibold text-slate-700">
                            Título da Fonte
                            <Input
                              className="mt-1 bg-white text-xs font-medium"
                              maxLength={200}
                              value={source.name}
                              onChange={(event) => updateSource(source.id, { name: event.target.value })}
                            />
                          </label>
                          <label className="block text-[11px] font-semibold text-slate-700">
                            Categoria / Papel
                            <select
                              value={source.contextRole || 'fact'}
                              onChange={(event) => updateSource(source.id, { contextRole: event.target.value as InlineSource['contextRole'] })}
                              className="mt-1 flex h-9 w-full rounded-md border border-input bg-white px-3 py-1 text-xs text-slate-800 shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-400"
                            >
                              <option value="fact">Fato / Informação</option>
                              <option value="policy">Regra / Política</option>
                              <option value="procedure">Procedimento</option>
                              <option value="persona">Persona / Tom</option>
                            </select>
                          </label>
                        </div>

                        {/* Navigation Tabs */}
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
                          <div className="flex flex-wrap items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setActiveTabBySource((prev) => ({ ...prev, [source.id]: 'editor' }))}
                              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${activeTab === 'editor' ? 'bg-violet-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-200/60'}`}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Editor de Conteúdo
                            </button>
                            <button
                              type="button"
                              onClick={() => setActiveTabBySource((prev) => ({ ...prev, [source.id]: 'preview' }))}
                              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${activeTab === 'preview' ? 'bg-violet-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-200/60'}`}
                            >
                              <Eye className="h-3.5 w-3.5" />
                              Preview Formatado
                            </button>
                            {pageCount > 0 && (
                              <button
                                type="button"
                                onClick={() => setActiveTabBySource((prev) => ({ ...prev, [source.id]: 'pages' }))}
                                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${activeTab === 'pages' ? 'bg-violet-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-200/60'}`}
                              >
                                <Layers className="h-3.5 w-3.5" />
                                Gerenciar Páginas ({pageCount})
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setActiveTabBySource((prev) => ({ ...prev, [source.id]: 'metadata' }))}
                              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${activeTab === 'metadata' ? 'bg-violet-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-200/60'}`}
                            >
                              <Database className="h-3.5 w-3.5" />
                              Metadados RAG
                            </button>
                            <button
                              type="button"
                              onClick={() => setActiveTabBySource((prev) => ({ ...prev, [source.id]: 'protection' }))}
                              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${activeTab === 'protection' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-200/60'}`}
                            >
                              <ShieldCheck className="h-3.5 w-3.5" />
                              Raio-X & Proteção
                            </button>
                          </div>

                          {/* Quick AI & Clean Actions */}
                          <div className="flex items-center gap-1.5">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={isOptimizing}
                              onClick={() => void handleAiOptimize(source)}
                              className="h-8 border-violet-200 bg-violet-50 text-[11px] font-semibold text-violet-800 hover:bg-violet-100"
                            >
                              {isOptimizing ? (
                                <>
                                  <RefreshCw className="mr-1 h-3.5 w-3.5 animate-spin" />
                                  Otimizando RAG...
                                </>
                              ) : (
                                <>
                                  <Sparkles className="mr-1 h-3.5 w-3.5 text-violet-600" />
                                  Otimizar para RAG
                                </>
                              )}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-8 text-[11px] text-slate-600 hover:bg-slate-200/60"
                              onClick={() => handleCleanText(source)}
                              title="Corrige quebras de linha automáticas de PDFs, hifens cortados e múltiplos espaços"
                            >
                              <Eraser className="mr-1 h-3.5 w-3.5 text-slate-500" />
                              Limpar Texto
                            </Button>
                          </div>
                        </div>

                        {/* TAB 1: PROFESSIONAL EDITOR */}
                        {activeTab === 'editor' && (
                          <div className="space-y-3">
                            {/* Formatting Toolbar */}
                            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow-2xs">
                              <div className="flex flex-wrap items-center gap-1">
                                <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-slate-600" title="Título Principal (H1)" onClick={() => applyFormatting(source, '# ')}>
                                  <Heading1 className="h-3.5 w-3.5" />
                                </Button>
                                <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-slate-600" title="Subtítulo (H2)" onClick={() => applyFormatting(source, '## ')}>
                                  <Heading2 className="h-3.5 w-3.5" />
                                </Button>
                                <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-slate-600" title="Seção (H3)" onClick={() => applyFormatting(source, '### ')}>
                                  <Heading3 className="h-3.5 w-3.5" />
                                </Button>
                                <span className="h-4 w-px bg-slate-200" />
                                <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-slate-700 font-bold" title="Negrito" onClick={() => applyFormatting(source, '**', '**')}>
                                  <strong>B</strong>
                                </Button>
                                <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-slate-700 italic" title="Itálico" onClick={() => applyFormatting(source, '*', '*')}>
                                  <em>I</em>
                                </Button>
                                <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-slate-600" title="Código Inline" onClick={() => applyFormatting(source, '`', '`')}>
                                  <Code className="h-3.5 w-3.5" />
                                </Button>
                                <span className="h-4 w-px bg-slate-200" />
                                <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-slate-600" title="Lista com Marcadores" onClick={() => applyFormatting(source, '- ')}>
                                  <List className="h-3.5 w-3.5" />
                                </Button>
                                <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-slate-600" title="Lista Numerada" onClick={() => applyFormatting(source, '1. ')}>
                                  <ListOrdered className="h-3.5 w-3.5" />
                                </Button>
                                <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-slate-600" title="Tabela Markdown" onClick={() => applyFormatting(source, '\n| Item | Descrição | Valor |\n| --- | --- | --- |\n| Exemplo | Especificação | R$ 0,00 |\n')}>
                                  <Table className="h-3.5 w-3.5" />
                                </Button>
                                <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-slate-600" title="Citação / Regra Oficial" onClick={() => applyFormatting(source, '> ⚠️ **Regra Oficial:** ')}>
                                  <Quote className="h-3.5 w-3.5" />
                                </Button>
                                <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-slate-600" title="Linha Divisória" onClick={() => applyFormatting(source, '\n---\n')}>
                                  <span className="text-[11px] font-bold">—</span>
                                </Button>
                                <span className="h-4 w-px bg-slate-200" />
                                <Button type="button" size="sm" variant="ghost" className="h-7 text-[10px] text-slate-600" onClick={() => handleInsertTemplate(source)}>
                                  Inserir Modelo RAG
                                </Button>
                              </div>

                              <div className="flex items-center gap-1.5">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className={`h-7 px-2 text-[10px] ${showReplaceBar ? 'bg-slate-200' : ''}`}
                                  onClick={() => setShowReplaceBar(!showReplaceBar)}
                                >
                                  <Search className="mr-1 h-3 w-3" />
                                  Localizar
                                </Button>
                              </div>
                            </div>

                            {/* Search and Replace bar */}
                            {showReplaceBar && (
                              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-violet-200 bg-violet-50/50 p-2.5 text-xs">
                                <div className="relative flex-1 min-w-40">
                                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                                  <Input
                                    value={editorSearch}
                                    onChange={(event) => setEditorSearch(event.target.value)}
                                    placeholder="Localizar no texto..."
                                    className="h-8 bg-white pl-8 text-xs"
                                  />
                                  {editorSearch && (
                                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-violet-700">
                                      {matches} {matches === 1 ? 'resultado' : 'resultados'}
                                    </span>
                                  )}
                                </div>
                                <Input
                                  value={editorReplace}
                                  onChange={(event) => setEditorReplace(event.target.value)}
                                  placeholder="Substituir por..."
                                  className="h-8 w-48 bg-white text-xs"
                                />
                                <Button type="button" size="sm" variant="secondary" className="h-8 text-xs" onClick={() => handleReplaceAll(source)}>
                                  Substituir todos
                                </Button>
                                <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => setShowReplaceBar(false)}>
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            )}

                            {/* Page or Continuous View */}
                            {pageCount > 0 && currentPage ? (
                              <div className="grid gap-4 lg:grid-cols-[160px_1fr]">
                                <aside className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
                                  <div className="sticky top-0 flex items-center justify-between bg-slate-50 pb-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                                    <span>Páginas ({pageCount})</span>
                                    <button
                                      type="button"
                                      onClick={() => addPageToSource(source)}
                                      className="rounded bg-violet-100 px-1.5 py-0.5 text-violet-700 hover:bg-violet-200"
                                      title="Adicionar página"
                                    >
                                      + Página
                                    </button>
                                  </div>
                                  {source.pages!.map((page, pageIndex) => (
                                    <button
                                      key={page.number}
                                      type="button"
                                      onClick={() => setActivePageBySource((current) => ({ ...current, [source.id]: pageIndex }))}
                                      className={`w-full rounded-xl border p-2 text-left transition ${pageIndex === currentPageIndex ? 'border-violet-500 bg-violet-50 ring-1 ring-violet-200' : 'border-slate-200 bg-white hover:border-violet-300'}`}
                                    >
                                      <div className="flex items-center justify-between">
                                        <span className="text-[10px] font-bold text-slate-800">Página {page.number}</span>
                                        <span className="text-[9px] text-slate-400">{page.content.length} c</span>
                                      </div>
                                      <span className="mt-1 block line-clamp-2 text-[9px] leading-relaxed text-slate-500">
                                        {page.content || '(Página vazia)'}
                                      </span>
                                    </button>
                                  ))}
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="w-full text-[10px]"
                                    onClick={() => mergePagesToContinuous(source)}
                                  >
                                    <Combine className="mr-1 h-3 w-3" />
                                    Unificar Páginas
                                  </Button>
                                </aside>

                                <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
                                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/50 px-4 py-2.5">
                                    <div className="flex items-center gap-2">
                                      <strong className="text-xs text-slate-900">Página {currentPage.number} de {pageCount}</strong>
                                      <Badge variant="outline" className="text-[9px] text-slate-500">
                                        {currentPage.content.length.toLocaleString('pt-BR')} caracteres
                                      </Badge>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                      <Button
                                        type="button"
                                        size="icon"
                                        variant="ghost"
                                        className="h-7 w-7"
                                        disabled={currentPageIndex === 0}
                                        onClick={() => setActivePageBySource((current) => ({ ...current, [source.id]: currentPageIndex - 1 }))}
                                      >
                                        <ChevronLeft className="h-3.5 w-3.5" />
                                      </Button>
                                      <span className="min-w-14 text-center text-[10px] font-semibold text-slate-600">
                                        {currentPageIndex + 1} / {pageCount}
                                      </span>
                                      <Button
                                        type="button"
                                        size="icon"
                                        variant="ghost"
                                        className="h-7 w-7"
                                        disabled={currentPageIndex === pageCount - 1}
                                        onClick={() => setActivePageBySource((current) => ({ ...current, [source.id]: currentPageIndex + 1 }))}
                                      >
                                        <ChevronRight className="h-3.5 w-3.5" />
                                      </Button>
                                      <span className="h-4 w-px bg-slate-200" />
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 text-[10px] text-red-600 hover:bg-red-50"
                                        onClick={() => deletePageFromSource(source, currentPageIndex)}
                                      >
                                        <Trash2 className="mr-1 h-3 w-3" />
                                        Excluir Página
                                      </Button>
                                    </div>
                                  </div>

                                  <Textarea
                                    ref={textareaRef}
                                    className="min-h-[440px] resize-y rounded-none border-0 bg-white p-5 font-mono text-xs leading-6 shadow-none focus-visible:ring-0"
                                    maxLength={100000}
                                    value={currentPage.content}
                                    onChange={(event) => updatePage(source, currentPageIndex, event.target.value)}
                                    placeholder="Escreva ou cole o conteúdo desta página..."
                                  />
                                </div>
                              </div>
                            ) : (
                              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
                                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/50 px-4 py-2.5">
                                  <div className="flex items-center gap-2">
                                    <strong className="text-xs text-slate-900">Editor Contínuo</strong>
                                    <Badge variant="outline" className="text-[9px] text-slate-500">
                                      {source.content.length.toLocaleString('pt-BR')} / 100.000 caracteres
                                    </Badge>
                                    <Badge variant="outline" className="text-[9px] text-slate-500">
                                      {source.content.split('\n').length} linhas
                                    </Badge>
                                  </div>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 text-[10px] text-slate-600"
                                    onClick={() => splitContinuousToPages(source)}
                                  >
                                    <Split className="mr-1 h-3 w-3" />
                                    Dividir em Páginas
                                  </Button>
                                </div>

                                <div className="grid grid-cols-[44px_1fr]">
                                  <pre
                                    aria-hidden
                                    className="max-h-[520px] overflow-hidden border-r border-slate-200 bg-slate-50 py-4 text-right font-mono text-[10px] leading-6 text-slate-400 select-none"
                                  >
                                    {source.content.split('\n').map((_, line) => line + 1).join('\n')}
                                  </pre>
                                  <Textarea
                                    ref={textareaRef}
                                    className="min-h-[440px] max-h-[520px] resize-y rounded-none border-0 bg-white p-4 font-mono text-xs leading-6 shadow-none focus-visible:ring-0"
                                    maxLength={100000}
                                    value={source.content}
                                    onScroll={(event) => {
                                      const gutter = event.currentTarget.previousElementSibling;
                                      if (gutter instanceof HTMLElement) gutter.scrollTop = event.currentTarget.scrollTop;
                                    }}
                                    onChange={(event) => updateSource(source.id, { content: event.target.value })}
                                    placeholder="Escreva ou edite a informação como explicaria para um novo atendente da sua equipe..."
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* TAB 2: FORMATTED MARKDOWN PREVIEW */}
                        {activeTab === 'preview' && (
                          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
                            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-xs">
                              <span className="font-semibold text-slate-700">Visualização Formatada (Markdown & RAG)</span>
                              <span className="text-[10px] text-slate-500">Exatamente como as seções e regras são interpretadas na busca</span>
                            </div>
                            <SimpleMarkdownPreview content={source.content} />
                          </div>
                        )}

                        {/* TAB 3: PAGES MANAGER */}
                        {activeTab === 'pages' && pageCount > 0 && (
                          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
                            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                              <div>
                                <h6 className="text-xs font-bold text-slate-900">Gerenciador de Páginas do Documento</h6>
                                <p className="text-[10px] text-slate-500">Organize, adicione ou exclua páginas extraídas do PDF.</p>
                              </div>
                              <div className="flex items-center gap-2">
                                <Button type="button" size="sm" variant="outline" className="text-xs" onClick={() => addPageToSource(source)}>
                                  <Plus className="mr-1 h-3.5 w-3.5" />
                                  Adicionar Página
                                </Button>
                                <Button type="button" size="sm" variant="outline" className="text-xs" onClick={() => mergePagesToContinuous(source)}>
                                  <Combine className="mr-1 h-3.5 w-3.5" />
                                  Unificar Tudo em Texto Contínuo
                                </Button>
                              </div>
                            </div>

                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                              {source.pages!.map((page, idx) => (
                                <div key={page.number} className="rounded-xl border border-slate-200 p-3 shadow-2xs">
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold text-slate-800">Página {page.number}</span>
                                    <div className="flex items-center gap-1">
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 px-2 text-[10px]"
                                        onClick={() => {
                                          setActivePageBySource((prev) => ({ ...prev, [source.id]: idx }));
                                          setActiveTabBySource((prev) => ({ ...prev, [source.id]: 'editor' }));
                                        }}
                                      >
                                        Editar
                                      </Button>
                                      <Button
                                        type="button"
                                        size="icon"
                                        variant="ghost"
                                        className="h-7 w-7 text-red-500 hover:bg-red-50"
                                        onClick={() => deletePageFromSource(source, idx)}
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  </div>
                                  <p className="mt-2 line-clamp-4 font-mono text-[10px] leading-relaxed text-slate-600">
                                    {page.content || '(Sem texto detectado nesta página)'}
                                  </p>
                                  <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-[9px] text-slate-400">
                                    <span>{page.content.length} caracteres</span>
                                    <span>~{estimateRagChunks(page.content)} chunk(s)</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* TAB 4: ADVANCED RAG METADATA */}
                        {activeTab === 'metadata' && (
                          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
                            <div>
                              <h6 className="text-xs font-bold text-slate-900">Metadados Avançados de Recuperação Semântica</h6>
                              <p className="text-[10px] text-slate-500">
                                Campos especiais que aumentam drasticamente a precisão da IA durante a busca e garantem respostas canônicas.
                              </p>
                            </div>

                            <div className="grid gap-4 sm:grid-cols-2">
                              <label className="block text-[11px] font-semibold text-slate-700">
                                Resumo para Busca Semântica (Summary)
                                <Textarea
                                  className="mt-1 text-xs"
                                  rows={3}
                                  maxLength={2000}
                                  value={source.summary || ''}
                                  onChange={(event) => updateSource(source.id, { summary: event.target.value })}
                                  placeholder="Resumo claro do assunto tratado neste documento para facilitar o embedding..."
                                />
                              </label>

                              <label className="block text-[11px] font-semibold text-slate-700">
                                Resposta Canônica Oficial (Direct Answer)
                                <Textarea
                                  className="mt-1 text-xs"
                                  rows={3}
                                  maxLength={4000}
                                  value={source.canonicalAnswer || ''}
                                  onChange={(event) => updateSource(source.id, { canonicalAnswer: event.target.value })}
                                  placeholder="Quando o cliente fizer a pergunta principal deste tema, responda exatamente isto..."
                                />
                              </label>

                              <label className="block text-[11px] font-semibold text-slate-700">
                                Categoria da Informação
                                <Input
                                  className="mt-1 text-xs"
                                  maxLength={100}
                                  value={source.category || ''}
                                  onChange={(event) => updateSource(source.id, { category: event.target.value })}
                                  placeholder="Ex: financeiro, suporte, planos, garantia"
                                />
                              </label>

                              <label className="block text-[11px] font-semibold text-slate-700">
                                Tags de Busca (Separadas por vírgula)
                                <Input
                                  className="mt-1 text-xs"
                                  value={(source.tags || []).join(', ')}
                                  onChange={(event) => updateSource(source.id, {
                                    tags: event.target.value.split(',').map((t) => t.trim()).filter(Boolean),
                                  })}
                                  placeholder="segunda via, boleto, vencimento, pix"
                                />
                              </label>
                            </div>
                          </div>
                        )}

                        {/* TAB 5: RAG X-RAY & PROTECTION STATUS */}
                        {activeTab === 'protection' && (
                          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
                            <div>
                              <h6 className="text-xs font-bold text-slate-900">Diagnóstico de Leitura e Proteção sob o RAG</h6>
                              <p className="text-[10px] text-slate-500">
                                Visão técnica transparente sobre o processamento de texto e as garantias de segurança ativas.
                              </p>
                            </div>

                            <div className="grid gap-4 sm:grid-cols-2">
                              {/* Read Status Panel */}
                              <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
                                <div className="flex items-center gap-2">
                                  <FileCheck className="h-5 w-5 text-emerald-700" />
                                  <strong className="text-xs font-bold text-emerald-950">Status de Leitura: Processado com Sucesso</strong>
                                </div>
                                <div className="mt-3 space-y-2 text-xs text-slate-700">
                                  <div className="flex justify-between border-b border-emerald-100 pb-1">
                                    <span className="text-slate-500">Palavras extraídas:</span>
                                    <span className="font-bold text-slate-900">{words.toLocaleString('pt-BR')}</span>
                                  </div>
                                  <div className="flex justify-between border-b border-emerald-100 pb-1">
                                    <span className="text-slate-500">Caracteres totais:</span>
                                    <span className="font-bold text-slate-900">{chars.toLocaleString('pt-BR')} / 100.000</span>
                                  </div>
                                  <div className="flex justify-between border-b border-emerald-100 pb-1">
                                    <span className="text-slate-500">Passagens / Chunks RAG:</span>
                                    <span className="font-bold text-emerald-800">~{estimatedChunks} blocos semânticos</span>
                                  </div>
                                  <div className="flex justify-between border-b border-emerald-100 pb-1">
                                    <span className="text-slate-500">Páginas indexadas:</span>
                                    <span className="font-bold text-slate-900">{pageCount > 0 ? `${pageCount} páginas` : 'Texto único contínuo'}</span>
                                  </div>
                                  <div className="flex justify-between pb-1">
                                    <span className="text-slate-500">Data de processamento:</span>
                                    <span className="font-medium text-slate-700">{source.importedAt ? new Date(source.importedAt).toLocaleString('pt-BR') : 'Recente'}</span>
                                  </div>
                                </div>

                                <div className="mt-4">
                                  <div className="mb-1 flex justify-between text-[10px] text-slate-500">
                                    <span>Orçamento de Contexto do Agente</span>
                                    <span>{Math.round((chars / 100000) * 100)}% usado</span>
                                  </div>
                                  <Progress value={Math.min(100, Math.round((chars / 100000) * 100))} className="h-2" />
                                </div>
                              </div>

                              {/* Protection & Security Panel */}
                              <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-4">
                                <div className="flex items-center gap-2">
                                  <ShieldCheck className="h-5 w-5 text-violet-700" />
                                  <strong className="text-xs font-bold text-violet-950">Status de Proteção sob o RAG</strong>
                                </div>

                                <div className="mt-3 space-y-2.5 text-xs">
                                  <div className="flex items-start gap-2">
                                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                                    <div>
                                      <strong className="text-slate-900">Grounding Estrito (Anti-Alucinação)</strong>
                                      <p className="text-[10px] text-slate-600">A IA só pode responder fatos respaldados por esta fonte e recusará responder se a informação estiver ausente.</p>
                                    </div>
                                  </div>

                                  <div className="flex items-start gap-2">
                                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                                    <div>
                                      <strong className="text-slate-900">Snapshot Imutável na Publicação</strong>
                                      <p className="text-[10px] text-slate-600">Ao publicar o agente, este documento é congelado. Edições futuras não quebram atendimentos em andamento.</p>
                                    </div>
                                  </div>

                                  <div className="flex items-start gap-2">
                                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                                    <div>
                                      <strong className="text-slate-900">Validação de Segurança de Conteúdo</strong>
                                      <p className="text-[10px] text-slate-600">Bloqueia vazamento de logs crus de chat e garante conformidade de privacidade de clientes.</p>
                                    </div>
                                  </div>

                                  <div className="mt-3 rounded-lg border border-violet-200 bg-white p-2.5">
                                    <span className="block text-[10px] font-bold text-slate-700">Chave Criptográfica de Integridade (SHA-256)</span>
                                    <div className="mt-1 flex items-center justify-between gap-2 font-mono text-[9px] text-violet-900">
                                      <span className="truncate">{hashDisplay}</span>
                                      <Button
                                        type="button"
                                        size="icon"
                                        variant="ghost"
                                        className="h-6 w-6 shrink-0"
                                        title="Copiar hash SHA-256"
                                        onClick={() => {
                                          void navigator.clipboard.writeText(hashDisplay);
                                          setSuccessNotice('Hash SHA-256 copiado.');
                                        }}
                                      >
                                        <Copy className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        <p className="mt-3 text-[9px] leading-relaxed text-slate-500">
                          {source.sourceType === 'file'
                            ? 'O arquivo original enviado permanece intacto. Este editor controla o texto revisado e estruturado que será indexado no RAG deste agente.'
                            : 'Esta fonte foi criada diretamente neste agente e pode ser revisada ou otimizada a qualquer momento.'}
                        </p>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </div>
        )}

        {/* Global Agent Chat Permissions */}
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 transition hover:border-slate-300">
          <input
            className="mt-0.5 rounded text-violet-600"
            type="checkbox"
            checked={document.resolveStage.allowGeneralAiChat}
            onChange={(event) => onChange({
              ...document,
              resolveStage: { ...document.resolveStage, allowGeneralAiChat: event.target.checked },
            })}
          />
          <span>
            <strong className="block text-xs text-slate-800">Permitir conversa geral contextual</strong>
            <span className="mt-0.5 block text-[10px] leading-relaxed text-slate-500">
              A IA pode saudar o cliente e ajudar a entender o pedido, mas continua expressamente proibida de inventar informações da empresa ou alegar que realizou ações.
            </span>
          </span>
        </label>

        {/* Success Notice Banner */}
        {successNotice && (
          <div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>{successNotice}</span>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div role="alert" className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
              <span>{error}</span>
            </div>
            <button type="button" onClick={() => setError('')} className="text-red-500 hover:text-red-700">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Restored Knowledge Warning */}
        {document.restoredKnowledgeReleaseId && (
          <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800">
            Este rascunho usa o conhecimento de uma versão recuperada.{' '}
            <button
              className="font-semibold underline"
              onClick={() => onChange({ ...document, restoredKnowledgeReleaseId: undefined })}
            >
              Usar os documentos atuais na próxima publicação
            </button>
          </p>
        )}
      </div>

      {/* Catalog Document Inspection Dialog */}
      {inspectingCatalogDoc && (
        <Dialog open={Boolean(inspectingCatalogDoc)} onOpenChange={(open) => { if (!open) setInspectingCatalogDoc(null); }}>
          <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
            <DialogHeader>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="border-sky-300 bg-sky-50 text-[10px] text-sky-800">
                  {inspectingCatalogDoc.category || 'Catálogo Geral'}
                </Badge>
                <DialogTitle className="text-base font-bold text-slate-900">
                  {inspectingCatalogDoc.name}
                </DialogTitle>
              </div>
              <DialogDescription className="text-xs text-slate-500">
                Documento compartilhado do workspace. Você pode inspecionar o conteúdo ou importar uma cópia exclusiva para este agente editar.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="grid grid-cols-3 gap-2 rounded-xl border border-slate-100 bg-slate-50 p-3 text-center text-xs">
                <div>
                  <span className="block text-[10px] text-slate-400">Palavras</span>
                  <strong className="text-slate-800">{(inspectingCatalogDoc.content?.split(/\s+/).length || 0).toLocaleString('pt-BR')}</strong>
                </div>
                <div>
                  <span className="block text-[10px] text-slate-400">Caracteres</span>
                  <strong className="text-slate-800">{(inspectingCatalogDoc.content?.length || 0).toLocaleString('pt-BR')}</strong>
                </div>
                <div>
                  <span className="block text-[10px] text-slate-400">Status RAG</span>
                  <strong className="text-emerald-700">Indexado</strong>
                </div>
              </div>

              {inspectingCatalogDoc.summary && (
                <div className="rounded-xl border border-violet-100 bg-violet-50/60 p-3 text-xs">
                  <strong className="block text-[10px] font-bold uppercase tracking-wide text-violet-800">Resumo de Recuperação</strong>
                  <p className="mt-1 text-slate-700">{inspectingCatalogDoc.summary}</p>
                </div>
              )}

              {inspectingCatalogDoc.canonicalAnswer && (
                <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3 text-xs">
                  <strong className="block text-[10px] font-bold uppercase tracking-wide text-emerald-800">Resposta Canônica Oficial</strong>
                  <p className="mt-1 text-slate-700">{inspectingCatalogDoc.canonicalAnswer}</p>
                </div>
              )}

              <div className="overflow-hidden rounded-xl border border-slate-200">
                <div className="border-b border-slate-200 bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
                  Conteúdo do Documento
                </div>
                <div className="max-h-[320px] overflow-y-auto p-4 font-mono text-xs leading-relaxed text-slate-800 whitespace-pre-wrap">
                  {inspectingCatalogDoc.content}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 pt-3">
              <Button type="button" variant="outline" onClick={() => setInspectingCatalogDoc(null)}>
                Fechar
              </Button>
              <Button
                type="button"
                className="bg-violet-600 text-white hover:bg-violet-500"
                onClick={() => copyCatalogDocumentToAgent(inspectingCatalogDoc)}
              >
                <Plus className="mr-1.5 h-4 w-4" />
                Copiar para Edição Exclusiva deste Agente
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}

