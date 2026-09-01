'use client';

import { useRef, useState } from 'react';
import { BookOpen, Check, ChevronLeft, ChevronRight, Database, FileText, Pencil, Plus, Search, Trash2, UploadCloud } from 'lucide-react';
import { createClientUuid } from '@/lib/client-uuid';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { AgentStudioDocument } from '@/services/agent-studio/types';
import type { KnowledgeBaseDocument, KnowledgeCollection } from '@/lib/types';
import { importStudioKnowledgeFileAction } from '@/actions/agent-studio';

type Props = {
  document: AgentStudioDocument;
  onChange: (document: AgentStudioDocument) => void;
  collections: KnowledgeCollection[];
  documents: KnowledgeBaseDocument[];
};
type InlineSource = NonNullable<AgentStudioDocument['inlineKnowledge']>[number];

export function StudioKnowledgeSources({ document, onChange, collections, documents }: Props) {
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState('');
  const [dragging, setDragging] = useState(false);
  const [openSourceId, setOpenSourceId] = useState<string | null>(null);
  const [activePageBySource, setActivePageBySource] = useState<Record<string, number>>({});
  const [editorSearch, setEditorSearch] = useState('');
  const currentDocument = useRef(document);
  currentDocument.current = document;

  const sources = document.inlineKnowledge || [];
  const selected = document.resolveStage.knowledgeCollectionIds;
  const selectedSet = new Set(selected);
  const activeDocuments = documents.filter((source) => !['draft', 'archived', 'expired'].includes(source.status || 'active'));
  const selectedDocuments = activeDocuments.filter((source) => selectedSet.has(source.id) || (source.collectionIds || []).some((id) => selectedSet.has(id)));
  const selectedInline = sources.filter((source) => selectedSet.has(source.id));
  const activeCount = selectedDocuments.length + selectedInline.length;
  const normalizedSearch = search.trim().toLocaleLowerCase('pt-BR');
  const visibleDocuments = normalizedSearch
    ? activeDocuments.filter((source) => `${source.name} ${source.category || ''}`.toLocaleLowerCase('pt-BR').includes(normalizedSearch))
    : activeDocuments;

  const toggle = (id: string, checked: boolean) => onChange({
    ...document,
    resolveStage: {
      ...document.resolveStage,
      knowledgeCollectionIds: checked ? [...new Set([...selected, id])] : selected.filter((value) => value !== id),
    },
  });

  const add = () => {
    if (sources.length >= 20) {
      setError('Você pode adicionar até 20 fontes diretamente neste agente.');
      return;
    }
    const id = `source_${createClientUuid()}`;
    onChange({
      ...document,
      inlineKnowledge: [...sources, { id, name: 'Nova informação', content: '' }],
      resolveStage: { ...document.resolveStage, knowledgeCollectionIds: [...new Set([...selected, id])] },
    });
    setOpenSourceId(id);
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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível importar o arquivo.');
    } finally {
      setImporting(false);
    }
  };

  const receiveFile = (files: FileList | null) => {
    const file = files?.[0];
    if (file) void importFile(file);
  };

  const updateSource = (sourceId: string, patch: Partial<InlineSource>) => onChange({
    ...document,
    inlineKnowledge: sources.map((source) => source.id === sourceId ? { ...source, ...patch, ...('content' in patch || 'pages' in patch ? { contentHash: undefined } : {}) } : source),
  });

  const updatePage = (source: InlineSource, pageIndex: number, content: string) => {
    const pages = (source.pages || []).map((page, index) => index === pageIndex ? { ...page, content } : page);
    const combined = pages.map((page) => page.content).join('\n\n');
    if (combined.length > 100_000) { setError('O documento pode ter até 100 mil caracteres. Reduza o texto de alguma página.'); return; }
    setError('');
    updateSource(source.id, { pages, content: combined });
  };

  return (
    <section className="mt-3 overflow-hidden rounded-2xl border border-violet-200 bg-white shadow-sm">
      <div className="border-b border-violet-100 bg-gradient-to-r from-violet-50 via-white to-sky-50 px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white shadow-sm"><BookOpen className="h-5 w-5" /></span>
            <div>
              <h4 className="text-sm font-bold text-slate-950">Conhecimento da IA</h4>
              <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-slate-600">Escolha o que este agente pode consultar. Quando o cliente perguntar, a IA encontra somente os trechos mais relevantes para responder.</p>
            </div>
          </div>
          <Badge className={activeCount ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100' : 'bg-amber-100 text-amber-800 hover:bg-amber-100'}>{activeCount ? `${activeCount} fonte${activeCount === 1 ? '' : 's'} ativa${activeCount === 1 ? '' : 's'}` : 'Configure uma fonte'}</Badge>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {[
            ['1', 'Escolha ou adicione', 'Use documentos, coleções ou escreva aqui.'],
            ['2', 'A IA pesquisa', 'Ela busca apenas o conteúdo ligado à pergunta.'],
            ['3', 'Resposta segura', 'Sem fonte suficiente, ela não inventa.'],
          ].map(([number, title, description]) => (
            <div key={number} className="flex gap-2 rounded-xl border border-white bg-white/80 p-2.5 shadow-2xs">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[10px] font-bold text-violet-700">{number}</span>
              <span><strong className="block text-[11px] text-slate-800">{title}</strong><span className="block text-[10px] leading-snug text-slate-500">{description}</span></span>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-5 p-4 sm:p-5">
        {(collections.length > 0 || activeDocuments.length > 0) && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div><h5 className="text-xs font-bold text-slate-900">Fontes já disponíveis</h5><p className="mt-0.5 text-[10px] text-slate-500">Marque tudo que este agente está autorizado a usar.</p></div>
              {activeDocuments.length > 4 && <label className="relative w-full sm:w-56"><Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" /><Input value={search} onChange={(event) => setSearch(event.target.value)} className="h-9 pl-9 text-xs" placeholder="Buscar uma fonte" /></label>}
            </div>

            {collections.length > 0 && <div className="grid gap-2 sm:grid-cols-2">{collections.map((collection) => {
              const checked = selectedSet.has(collection.id);
              const count = activeDocuments.filter((source) => (source.collectionIds || []).includes(collection.id)).length;
              return <label key={collection.id} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition ${checked ? 'border-violet-400 bg-violet-50 ring-1 ring-violet-100' : 'border-slate-200 hover:border-violet-300 hover:bg-slate-50'}`}>
                <input className="sr-only" type="checkbox" checked={checked} onChange={(event) => toggle(collection.id, event.target.checked)} />
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${checked ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-500'}`}>{checked ? <Check className="h-4 w-4" /> : <Database className="h-4 w-4" />}</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-slate-800">{collection.name}</span><span className="block truncate text-[10px] text-slate-500">{collection.description || `${count} documento${count === 1 ? '' : 's'}`}</span></span>
              </label>;
            })}</div>}

            {visibleDocuments.length > 0 && <div className="grid gap-2 sm:grid-cols-2">{visibleDocuments.map((source) => {
              const direct = selectedSet.has(source.id);
              const viaCollection = (source.collectionIds || []).some((id) => selectedSet.has(id));
              const enabled = direct || viaCollection;
              return <label key={source.id} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition ${enabled ? 'border-sky-300 bg-sky-50/70' : 'border-slate-200 hover:border-sky-300 hover:bg-slate-50'}`}>
                <input className="sr-only" type="checkbox" checked={direct} onChange={(event) => toggle(source.id, event.target.checked)} />
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${enabled ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-500'}`}>{enabled ? <Check className="h-4 w-4" /> : <FileText className="h-4 w-4" />}</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-slate-800">{source.name}</span><span className="block truncate text-[10px] text-slate-500">{viaCollection && !direct ? 'Incluído pela coleção' : source.category || source.sourceFormat || 'Documento'}</span></span>
              </label>;
            })}</div>}
            {normalizedSearch && !visibleDocuments.length && <p className="rounded-xl bg-slate-50 p-3 text-center text-[11px] text-slate-500">Nenhuma fonte encontrada com “{search}”.</p>}
          </div>
        )}

        <div className="space-y-3 border-t border-slate-100 pt-5">
          <div><h5 className="text-xs font-bold text-slate-900">Adicione conhecimento sem sair desta página</h5><p className="mt-0.5 text-[10px] text-slate-500">Envie um arquivo ou escreva políticas, preços, horários e respostas frequentes.</p></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={`flex min-h-24 cursor-pointer items-center gap-3 rounded-xl border border-dashed p-4 transition ${dragging ? 'border-violet-500 bg-violet-50' : 'border-slate-300 bg-slate-50/70 hover:border-violet-400 hover:bg-violet-50/50'} ${importing ? 'cursor-wait opacity-60' : ''}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); receiveFile(event.dataTransfer.files); }}>
              <UploadCloud className="h-7 w-7 shrink-0 text-violet-600" />
              <span><strong className="block text-xs text-slate-800">{importing ? 'Lendo o arquivo…' : 'Enviar PDF ou texto'}</strong><span className="mt-1 block text-[10px] leading-snug text-slate-500">Clique ou arraste aqui. Depois, revise o conteúdo abaixo.</span></span>
              <input className="sr-only" type="file" disabled={importing || sources.length >= 20} accept=".pdf,.txt,.md,.csv,.json,application/pdf,text/plain,text/markdown,text/csv,application/json" onChange={(event) => { receiveFile(event.target.files); event.target.value = ''; }} />
            </label>
            <button type="button" onClick={add} disabled={sources.length >= 20 || importing} className="flex min-h-24 items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-4 text-left transition hover:border-emerald-400 hover:bg-emerald-50/50 disabled:opacity-50">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700"><Plus className="h-5 w-5" /></span>
              <span><strong className="block text-xs text-slate-800">Escrever uma informação</strong><span className="mt-1 block text-[10px] leading-snug text-slate-500">Crie uma fonte e edite tudo diretamente aqui.</span></span>
            </button>
          </div>
        </div>

        {sources.length > 0 && <div className="space-y-3 border-t border-slate-100 pt-5">
          <div><h5 className="text-xs font-bold text-slate-900">Seus arquivos e informações</h5><p className="mt-0.5 text-[10px] text-slate-500">Abra uma fonte para revisar exatamente o conteúdo que a IA poderá consultar.</p></div>
          <div className="space-y-2">{sources.map((source) => {
            const isOpen = openSourceId === source.id;
            const pageCount = source.pages?.length || 0;
            const words = source.content.trim() ? source.content.trim().split(/\s+/).length : 0;
            const currentPageIndex = Math.min(activePageBySource[source.id] || 0, Math.max(0, pageCount - 1));
            const currentPage = source.pages?.[currentPageIndex];
            const matches = editorSearch.trim() ? (source.content.toLocaleLowerCase('pt-BR').match(new RegExp(editorSearch.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').toLocaleLowerCase('pt-BR'), 'g')) || []).length : 0;
            return <article key={source.id} className={`overflow-hidden rounded-2xl border transition ${isOpen ? 'border-violet-300 bg-white shadow-sm ring-1 ring-violet-100' : 'border-slate-200 bg-white hover:border-violet-200'}`}>
              <div className="flex flex-wrap items-center gap-3 p-3.5">
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${source.mimeType === 'application/pdf' ? 'bg-red-50 text-red-600' : source.sourceType === 'file' ? 'bg-sky-50 text-sky-600' : 'bg-emerald-50 text-emerald-600'}`}><FileText className="h-5 w-5" /></span>
                <button type="button" onClick={() => { setOpenSourceId(isOpen ? null : source.id); setEditorSearch(''); }} className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-xs font-bold text-slate-900">{source.name}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-slate-500"><span>{source.sourceType === 'file' ? source.fileName || 'Arquivo importado' : 'Conteúdo escrito'}</span>{pageCount > 0 && <><span>·</span><span>{pageCount} página{pageCount === 1 ? '' : 's'}</span></>}<span>·</span><span>{words.toLocaleString('pt-BR')} palavras</span></span>
                </button>
                <label className="flex cursor-pointer items-center gap-1.5 text-[10px] font-semibold text-slate-600"><input type="checkbox" checked={selectedSet.has(source.id)} onChange={(event) => toggle(source.id, event.target.checked)} />Ativa</label>
                <Button type="button" size="sm" variant="outline" className="h-8 text-[10px]" onClick={() => { setOpenSourceId(isOpen ? null : source.id); setEditorSearch(''); }}><Pencil className="mr-1 h-3 w-3" />{isOpen ? 'Fechar' : 'Editar'}</Button>
                <Button type="button" size="icon" variant="ghost" className="h-8 w-8 text-slate-400 hover:text-red-600" aria-label={`Remover fonte ${source.name}`} onClick={() => { if (openSourceId === source.id) setOpenSourceId(null); onChange({ ...document, inlineKnowledge: sources.filter((item) => item.id !== source.id), resolveStage: { ...document.resolveStage, knowledgeCollectionIds: selected.filter((id) => id !== source.id) } }); }}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>

              {isOpen && <div className="border-t border-slate-200 bg-slate-50/70 p-4 sm:p-5">
                <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_240px]">
                  <label className="block text-[11px] font-semibold text-slate-700">Nome da fonte<Input className="mt-1.5 bg-white text-xs" maxLength={200} value={source.name} onChange={(event) => updateSource(source.id, { name: event.target.value })} /></label>
                  <label className="block text-[11px] font-semibold text-slate-700">Buscar neste conteúdo<div className="relative mt-1.5"><Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" /><Input className="bg-white pl-9 pr-14 text-xs" value={editorSearch} onChange={(event) => setEditorSearch(event.target.value)} placeholder="Localizar texto" />{editorSearch && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-semibold text-violet-700">{matches}</span>}</div></label>
                </div>

                {pageCount > 0 && currentPage ? <div className="grid gap-4 lg:grid-cols-[150px_1fr]">
                  <aside className="max-h-[520px] space-y-2 overflow-y-auto pr-1"><p className="sticky top-0 bg-slate-50 pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">Páginas</p>{source.pages!.map((page, pageIndex) => <button key={page.number} type="button" onClick={() => setActivePageBySource((current) => ({ ...current, [source.id]: pageIndex }))} className={`w-full rounded-xl border p-2 text-left transition ${pageIndex === currentPageIndex ? 'border-violet-400 bg-violet-50 ring-1 ring-violet-100' : 'border-slate-200 bg-white hover:border-violet-200'}`}><span className="block text-[10px] font-bold text-slate-700">Página {page.number}</span><span className="mt-1 block line-clamp-3 text-[9px] leading-relaxed text-slate-400">{page.content || 'Página sem texto detectado'}</span></button>)}</aside>
                  <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-3"><div><strong className="block text-xs text-slate-900">Página {currentPage.number}</strong><span className="text-[9px] text-slate-500">Edite o texto extraído que será pesquisado pela IA</span></div><div className="flex items-center gap-1"><Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={currentPageIndex === 0} onClick={() => setActivePageBySource((current) => ({ ...current, [source.id]: currentPageIndex - 1 }))}><ChevronLeft className="h-3.5 w-3.5" /></Button><span className="min-w-14 text-center text-[10px] font-semibold text-slate-600">{currentPageIndex + 1} / {pageCount}</span><Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={currentPageIndex === pageCount - 1} onClick={() => setActivePageBySource((current) => ({ ...current, [source.id]: currentPageIndex + 1 }))}><ChevronRight className="h-3.5 w-3.5" /></Button></div></div>
                    <Textarea className="min-h-[420px] resize-y rounded-none border-0 bg-white p-5 font-mono text-xs leading-6 shadow-none focus-visible:ring-0" maxLength={100000} value={currentPage.content} onChange={(event) => updatePage(source, currentPageIndex, event.target.value)} placeholder="Esta página não possui texto. Você pode escrever o conteúdo que a IA deve consultar." />
                  </div>
                </div> : <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3"><div><strong className="block text-xs text-slate-900">Editor de conteúdo</strong><span className="text-[9px] text-slate-500">TXT, Markdown, CSV, JSON ou texto escrito diretamente</span></div><span className="text-[10px] font-medium text-slate-500">{source.content.length.toLocaleString('pt-BR')} caracteres · {source.content.split('\n').length} linhas</span></div>
                  <div className="grid grid-cols-[44px_1fr]"><pre aria-hidden className="max-h-[520px] overflow-hidden border-r border-slate-200 bg-slate-50 py-4 text-right font-mono text-[10px] leading-6 text-slate-400">{source.content.split('\n').map((_, line) => line + 1).join('\n')}</pre><Textarea className="min-h-[420px] max-h-[520px] resize-y rounded-none border-0 bg-white p-4 font-mono text-xs leading-6 shadow-none focus-visible:ring-0" maxLength={100000} value={source.content} onScroll={(event) => { const gutter = event.currentTarget.previousElementSibling; if (gutter instanceof HTMLElement) gutter.scrollTop = event.currentTarget.scrollTop; }} onChange={(event) => updateSource(source.id, { content: event.target.value })} placeholder="Escreva a informação como explicaria para uma pessoa nova na equipe." /></div>
                </div>}
                {source.sourceType === 'file' && <p className="mt-3 text-[9px] leading-relaxed text-slate-500">O arquivo original não é alterado. Este editor controla o texto revisado que será indexado e consultado pelo agente na próxima publicação.</p>}
              </div>}
            </article>;
          })}</div>
        </div>}

        {!collections.length && !sources.length && !activeDocuments.length && <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-[11px] text-slate-500">Este agente ainda não possui fontes. Use uma das opções acima para começar.</p>}
        {error && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-[11px] text-amber-800">{error}</p>}
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3"><input className="mt-0.5" type="checkbox" checked={document.resolveStage.allowGeneralAiChat} onChange={(event) => onChange({ ...document, resolveStage: { ...document.resolveStage, allowGeneralAiChat: event.target.checked } })} /><span><strong className="block text-xs text-slate-800">Permitir conversa geral</strong><span className="mt-0.5 block text-[10px] leading-relaxed text-slate-500">A IA pode ajudar a entender o pedido, mas continua proibida de inventar informações da empresa ou afirmar que realizou ações.</span></span></label>
        <p className="flex items-start gap-2 text-[10px] leading-relaxed text-slate-500"><Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />Ao publicar, o Dialogy guarda uma cópia destas fontes. Mudanças futuras não alteram atendimentos que já começaram.</p>
        {document.restoredKnowledgeReleaseId && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800">Este rascunho usa o conhecimento de uma versão recuperada. <button className="font-semibold underline" onClick={() => onChange({ ...document, restoredKnowledgeReleaseId: undefined })}>Usar os documentos atuais na próxima publicação</button></p>}
      </div>
    </section>
  );
}
