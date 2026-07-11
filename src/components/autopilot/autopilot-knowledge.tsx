import { useEffect, useRef, useState } from 'react';
import { Activity, CheckCircle2, FileText, Files, FlaskConical, FolderOpen, Loader2, PencilLine, Plus, RefreshCw, Server, Sparkles, Trash2, UploadCloud, Wrench, XCircle } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import type { AutopilotRagHealth, KnowledgeBaseDocument, KnowledgeCollection } from '@/lib/types';
import type { RagLabReport } from '@/services/rag/evaluation';
import { cn } from '@/lib/utils';

type AgentToolCatalogItem = {
  name: string;
  description: string;
  riskLevel: 'low' | 'medium' | 'high';
  source: 'dialogy' | 'mcp';
  serverName?: string;
};

type KnowledgeDocumentMetadataPatch = Partial<Pick<
  KnowledgeBaseDocument,
  'summary' | 'tags' | 'contextRole' | 'canonicalAnswer' | 'workflowHints'
>>;

interface AutopilotKnowledgeProps {
  documents: KnowledgeBaseDocument[];
  collections: KnowledgeCollection[];
  toolCatalog: AgentToolCatalogItem[];
  onUpload: (files: FileList | null) => Promise<void>;
  onRemove: (id: string) => void;
  onUpdateContent: (id: string, content: string) => void;
  onUpdateName: (id: string, name: string) => void;
  onUpdateCategory: (id: string, category: string) => void;
  onUpdateMaxPromptChars: (id: string, maxPromptChars: number | null) => void;
  onUpdateMetadata: (id: string, patch: KnowledgeDocumentMetadataPatch) => void;
  onUpdateCollections: (id: string, collectionIds: string[]) => void;
  onAddCollection: (name: string) => boolean;
  onRemoveCollection: (id: string) => void;
  onAddManual: () => void;
  onImproveDocument: (document: KnowledgeBaseDocument) => Promise<void>;
  isUploading: boolean;
  ragHealth: AutopilotRagHealth | null;
  onReindex: () => Promise<void>;
  isReindexing: boolean;
  ragLabReport: RagLabReport | null;
  onRunRagLab: () => Promise<void>;
  isRunningRagLab: boolean;
}

export function AutopilotKnowledge({
  documents,
  collections,
  toolCatalog,
  onUpload,
  onRemove,
  onUpdateContent,
  onUpdateName,
  onUpdateCategory,
  onUpdateMaxPromptChars,
  onUpdateMetadata,
  onUpdateCollections,
  onAddCollection,
  onRemoveCollection,
  onAddManual,
  onImproveDocument,
  isUploading,
  ragHealth,
  onReindex,
  isReindexing,
  ragLabReport,
  onRunRagLab,
  isRunningRagLab,
}: AutopilotKnowledgeProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [toolQuery, setToolQuery] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [collectionError, setCollectionError] = useState('');
  const [documentQuery, setDocumentQuery] = useState('');
  const [improvingDocumentId, setImprovingDocumentId] = useState<string | null>(null);
  const [contentDraft, setContentDraft] = useState('');
  const pendingContentRef = useRef<{ id: string; value: string } | null>(null);
  const contentCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onUpdateContentRef = useRef(onUpdateContent);

  const selectedDoc = documents.find((doc) => doc.id === selectedDocId) || null;

  useEffect(() => {
    onUpdateContentRef.current = onUpdateContent;
  }, [onUpdateContent]);

  useEffect(() => {
    if (documents.length === 0) {
      setSelectedDocId(null);
      return;
    }

    if (!selectedDocId || !documents.some((doc) => doc.id === selectedDocId)) {
      setSelectedDocId(documents[0].id);
    }
  }, [documents, selectedDocId]);

  useEffect(() => {
    if (!selectedDoc) {
      setContentDraft('');
      return;
    }

    const pending = pendingContentRef.current;
    if (pending?.id === selectedDoc.id && pending.value !== selectedDoc.content) return;
    if (pending?.id === selectedDoc.id) pendingContentRef.current = null;
    setContentDraft(selectedDoc.content);
  }, [selectedDoc?.content, selectedDoc?.id]);

  useEffect(() => () => {
    if (contentCommitTimerRef.current) clearTimeout(contentCommitTimerRef.current);
    const pending = pendingContentRef.current;
    if (pending) onUpdateContentRef.current(pending.id, pending.value);
  }, []);

  const commitPendingContent = () => {
    if (contentCommitTimerRef.current) {
      clearTimeout(contentCommitTimerRef.current);
      contentCommitTimerRef.current = null;
    }
    const pending = pendingContentRef.current;
    if (!pending) return;
    pendingContentRef.current = null;
    onUpdateContentRef.current(pending.id, pending.value);
  };

  const updateContentDraft = (id: string, value: string) => {
    setContentDraft(value);
    pendingContentRef.current = { id, value };
    if (contentCommitTimerRef.current) clearTimeout(contentCommitTimerRef.current);
    contentCommitTimerRef.current = setTimeout(() => {
      contentCommitTimerRef.current = null;
      const pending = pendingContentRef.current;
      if (!pending) return;
      onUpdateContentRef.current(pending.id, pending.value);
    }, 180);
  };

  const handleDrag = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (event.type === 'dragenter' || event.type === 'dragover') {
      setDragActive(true);
    } else if (event.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);

    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      void onUpload(event.dataTransfer.files);
    }
  };

  const filteredTools = toolCatalog
    .filter((tool) => {
      if (toolQuery == null) return false;
      const query = toolQuery.toLowerCase();
      return (
        tool.name.toLowerCase().includes(query) ||
        tool.description.toLowerCase().includes(query) ||
        (tool.serverName || '').toLowerCase().includes(query)
      );
    })
    .slice(0, 12);
  const normalizedDocumentQuery = documentQuery.trim().toLocaleLowerCase('pt-BR');
  const filteredDocuments = normalizedDocumentQuery
    ? documents.filter((document) => {
        const collectionNames = (document.collectionIds?.length ? document.collectionIds : ['general'])
          .map((id) => collections.find((collection) => collection.id === id)?.name || '')
          .join(' ');
        return [document.name, document.category, document.summary, ...(document.tags || []), collectionNames]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase('pt-BR')
          .includes(normalizedDocumentQuery);
      })
    : documents;
  const categorySuggestions = Array.from(new Set(
    documents.map((document) => document.category?.trim()).filter((category): category is string => Boolean(category))
  )).sort((left, right) => left.localeCompare(right, 'pt-BR'));
  const toolLookup = new Map<string, AgentToolCatalogItem>();
  for (const tool of toolCatalog) {
    const aliases = [
      tool.name,
      tool.name.split(':').at(-1) || '',
      tool.name.replace(/^mcp:[^:]+:/, ''),
    ].filter(Boolean);
    for (const alias of aliases) {
      toolLookup.set(alias.toLowerCase(), tool);
    }
  }
  const mentionedTools = selectedDoc
    ? Array.from(contentDraft.matchAll(/@([a-zA-Z0-9_.:-]+)/g)).map((match) => {
        const mention = match[1] || '';
        return {
          mention,
          tool: toolLookup.get(mention.toLowerCase()) || null,
        };
      })
    : [];
  const uniqueMentionedTools = mentionedTools.filter((item, index, all) => (
    all.findIndex((candidate) => candidate.mention === item.mention) === index
  ));

  const updateToolMentionState = (value: string, caret: number | null) => {
    if (caret == null) {
      setToolQuery(null);
      setMentionStart(null);
      return;
    }

    const beforeCaret = value.slice(0, caret);
    const match = /(?:^|\s)@([a-zA-Z0-9_.:-]*)$/.exec(beforeCaret);
    if (!match || match.index == null) {
      setToolQuery(null);
      setMentionStart(null);
      return;
    }

    const absoluteStart = match.index + match[0].lastIndexOf('@');
    setToolQuery(match[1] || '');
    setMentionStart(absoluteStart);
  };

  const insertToolMention = (toolName: string) => {
    if (!selectedDoc || mentionStart == null) return;
    const textarea = textareaRef.current;
    const caret = textarea?.selectionStart ?? contentDraft.length;
    const before = contentDraft.slice(0, mentionStart);
    const after = contentDraft.slice(caret);
    const nextValue = `${before}@${toolName} ${after}`;
    const nextCaret = before.length + toolName.length + 2;
    updateContentDraft(selectedDoc.id, nextValue);
    setToolQuery(null);
    setMentionStart(null);
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  return (
    <div
      className="nodrag nowheel nopan grid min-w-0 gap-6 2xl:grid-cols-[340px_minmax(0,1fr)]"
      onKeyDown={(event) => event.stopPropagation()}
    >
      <Card className="min-w-0 overflow-hidden rounded-[28px] border border-border bg-card shadow-sm">
        <CardHeader className="border-b border-border/60 bg-muted/30">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-xl text-foreground">
                <Files className="h-5 w-5 text-primary" />
                Base de conhecimento
              </CardTitle>
              <CardDescription>
                Carregue arquivos ou mantenha notas manuais para orientar respostas do agente.
              </CardDescription>
            </div>
            <Badge variant="outline" className="rounded-full">
              {documents.length} {documents.length === 1 ? 'item' : 'itens'}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="flex min-w-0 flex-col gap-4 p-4 sm:p-5">
          <div className="rounded-[20px] border border-border bg-muted/20 p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Activity className="h-4 w-4" />
                Saude do indice
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 rounded-xl text-xs"
                onClick={() => void onReindex()}
                disabled={isReindexing}
              >
                {isReindexing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Reindexar
              </Button>
            </div>
            {ragHealth ? (
              <>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-xl border border-border bg-background p-2">
                    <div className="font-semibold text-foreground">{ragHealth.indexedDocuments}/{ragHealth.configuredDocuments}</div>
                    <div className="text-muted-foreground">indexados</div>
                  </div>
                  <div className="rounded-xl border border-border bg-background p-2">
                    <div className="font-semibold text-foreground">{ragHealth.indexedChunks}</div>
                    <div className="text-muted-foreground">chunks</div>
                  </div>
                  <div className="rounded-xl border border-border bg-background p-2">
                    <div className={cn('font-semibold', ragHealth.missingDocuments > 0 ? 'text-amber-600 dark:text-amber-300' : 'text-emerald-600 dark:text-emerald-300')}>
                      {ragHealth.missingDocuments}
                    </div>
                    <div className="text-muted-foreground">pendentes</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {ragHealth.collections.map((collection) => (
                    <Badge key={collection.id} variant="outline" className="rounded-full text-[10px]">
                      {collection.name}: {collection.indexedDocuments}/{collection.documents}
                    </Badge>
                  ))}
                </div>
                <p className="mt-3 text-[11px] leading-4 text-muted-foreground">
                  Consultas RAG nos ultimos 7 dias: {ragHealth.recentRetrievals}.
                  {ragHealth.lastRetrievalAt
                    ? ` Ultima em ${new Date(ragHealth.lastRetrievalAt).toLocaleDateString('pt-BR')}.`
                    : ' Nenhuma consulta registrada.'}
                </p>
                {(ragHealth.staleDocuments > 0 || ragHealth.wrongDimensionChunks > 0) && (
                  <p className="mt-3 text-[11px] leading-4 text-amber-600 dark:text-amber-300">
                    {ragHealth.staleDocuments} documento(s) antigo(s) ou {ragHealth.wrongDimensionChunks} chunk(s) invalido(s) aguardam reparo.
                  </p>
                )}
                {ragHealth.quarantinedDocuments > 0 && (
                  <p className="mt-3 text-[11px] leading-4 text-amber-600 dark:text-amber-300">
                    {ragHealth.quarantinedDocuments} transcricao(oes) de conversa bloqueada(s) do indice para proteger a resposta do agente.
                  </p>
                )}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">A saude do indice estara disponivel apos carregar o agente publicado.</p>
            )}
          </div>

          <div className="rounded-[20px] border border-border bg-muted/20 p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <FlaskConical className="h-4 w-4" />
                Laboratorio RAG
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 rounded-xl text-xs"
                onClick={() => void onRunRagLab()}
                disabled={isRunningRagLab}
              >
                {isRunningRagLab ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
                Executar
              </Button>
            </div>
            {ragLabReport ? (
              <>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-xl border border-border bg-background p-2">
                    <div className="font-semibold text-foreground">{Math.round(ragLabReport.top1Accuracy * 100)}%</div>
                    <div className="text-muted-foreground">Top-1</div>
                  </div>
                  <div className="rounded-xl border border-border bg-background p-2">
                    <div className="font-semibold text-foreground">{Math.round(ragLabReport.top3Accuracy * 100)}%</div>
                    <div className="text-muted-foreground">Top-3</div>
                  </div>
                  <div className="rounded-xl border border-border bg-background p-2">
                    <div className={cn('font-semibold', ragLabReport.collectionLeaks > 0 ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-300')}>
                      {ragLabReport.collectionLeaks}
                    </div>
                    <div className="text-muted-foreground">vazamentos</div>
                  </div>
                </div>
                <p className="mt-3 text-[11px] text-muted-foreground">
                  {ragLabReport.passed}/{ragLabReport.total} casos aprovados. Intencao: {Math.round(ragLabReport.intentAccuracy * 100)}%.
                </p>
                <div className="mt-3 grid max-h-56 gap-2 overflow-y-auto">
                  {ragLabReport.cases.map((evalCase) => (
                    <div key={evalCase.id} className="rounded-xl border border-border bg-background px-3 py-2 text-[11px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium text-foreground">{evalCase.title}</span>
                        {evalCase.passed
                          ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                          : <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />}
                      </div>
                      <p className="mt-1 truncate text-muted-foreground">{evalCase.customerMessage}</p>
                      <p className="mt-1 truncate text-muted-foreground">
                        Esperado: {evalCase.expectedDocumentName} | Top-1: {evalCase.selectedDocuments[0]?.name || 'nenhum'}
                      </p>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-xs leading-5 text-muted-foreground">
                Executa perguntas aplicaveis a esta base e mede Top-1, Top-3, intencao e isolamento por colecao.
              </p>
            )}
          </div>

          <div className="rounded-[20px] border border-border bg-muted/20 p-3">
            <div className="mb-3 flex items-center justify-between">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <FolderOpen className="h-4 w-4" />
                Colecoes
              </p>
              <Badge variant="outline" className="rounded-full text-[10px]">{collections.length}</Badge>
            </div>
            <div className="mb-3 flex gap-2">
              <Input
                value={newCollectionName}
                onChange={(event) => {
                  setNewCollectionName(event.target.value);
                  setCollectionError('');
                }}
                placeholder="Financeiro"
                className="h-9 rounded-xl bg-background text-sm"
              />
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="h-9 w-9 shrink-0 rounded-xl"
                onClick={() => {
                  if (!onAddCollection(newCollectionName)) {
                    setCollectionError('Nome vazio ou ja utilizado.');
                    return;
                  }
                  setNewCollectionName('');
                }}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {collectionError && <p className="mb-3 text-[11px] text-destructive">{collectionError}</p>}
            <div className="flex flex-wrap gap-2">
              {collections.map((collection) => (
                <span key={collection.id} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs">
                  {collection.name}
                  {!collection.isDefault && collection.id !== 'general' && (
                    <button type="button" onClick={() => onRemoveCollection(collection.id)} className="text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </span>
              ))}
            </div>
          </div>

          <div
            className={cn(
              'rounded-[24px] border-2 border-dashed px-5 py-6 text-center transition-colors',
              dragActive
                ? 'border-primary bg-primary/10'
                : 'border-border bg-muted/30 hover:border-primary/40 hover:bg-muted/50'
            )}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".txt,.md,.csv,.json,.pdf"
              className="hidden"
              onChange={(event) => void onUpload(event.target.files)}
            />
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-background text-primary shadow-sm">
              {isUploading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <UploadCloud className="h-5 w-5" />
              )}
            </div>
            <p className="mt-4 text-sm font-semibold text-foreground">Importar arquivos de contexto</p>
            <p className="mt-1 text-xs text-muted-foreground">Arraste ou clique para enviar `.txt`, `.md`, `.csv`, `.json` e `.pdf`. O indice RAG normaliza o conteudo para Markdown ao publicar.</p>
          </div>

          <Button onClick={onAddManual} variant="outline" className="w-full rounded-2xl">
            <Plus className="mr-2 h-4 w-4" />
            Nova nota manual
          </Button>

          <div className="rounded-[20px] border border-primary/20 bg-primary/5 px-4 py-3 text-xs leading-5 text-muted-foreground">
            Use <span className="font-mono font-semibold text-foreground">@nome_da_tool</span> em notas de procedimento para orientar quando uma ferramenta deve ser usada.
            Ex: <span className="font-mono font-semibold text-foreground">@mcp:servidor:trocar_wifi</span>.
          </div>

          <Input
            value={documentQuery}
            onChange={(event) => setDocumentQuery(event.target.value)}
            placeholder="Buscar por nome, tag, categoria ou colecao"
            aria-label="Buscar documentos da base de conhecimento"
            className="h-10 rounded-2xl bg-background text-sm"
          />

          <ScrollArea className="h-[min(52vh,520px)] rounded-[24px] border border-border bg-muted/20">
            <div className="grid gap-2 p-3">
              {filteredDocuments.length > 0 ? (
                filteredDocuments.map((doc) => {
                  const isSelected = selectedDoc?.id === doc.id;

                  return (
                    <div
                      key={doc.id}
                      onClick={() => {
                        commitPendingContent();
                        setSelectedDocId(doc.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          commitPendingContent();
                          setSelectedDocId(doc.id);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      className={cn(
                        'group flex w-full min-w-0 items-start justify-between gap-3 rounded-2xl border px-3 py-3 text-left transition-all',
                        isSelected
                          ? 'border-primary/30 bg-primary/10 shadow-sm'
                          : 'border-transparent bg-background/70 hover:border-border hover:bg-background'
                      )}
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <div
                          className={cn(
                            'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                            isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                          )}
                        >
                          <FileText className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 space-y-1">
                          <p className="truncate text-sm font-medium text-foreground">{doc.name || 'Documento sem nome'}</p>
                          <p className="text-xs text-muted-foreground">
                            {(doc.tokens || 0).toLocaleString()} tokens estimados
                          </p>
                          <p className="truncate text-[11px] text-primary/80">
                            {(doc.collectionIds?.length ? doc.collectionIds : ['general'])
                              .map((id) => collections.find((collection) => collection.id === id)?.name)
                              .filter(Boolean)
                              .join(', ') || 'Geral'}
                          </p>
                        </div>
                      </div>

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 rounded-full text-muted-foreground hover:text-destructive"
                        onClick={(event) => {
                          event.stopPropagation();
                          onRemove(doc.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })
              ) : documents.length === 0 ? (
                <div className="flex min-h-[220px] flex-col items-center justify-center rounded-[20px] border border-dashed border-border bg-background/60 px-6 text-center">
                  <FileText className="h-10 w-10 text-muted-foreground/50" />
                  <p className="mt-4 text-sm font-medium text-foreground">Nenhum documento adicionado</p>
                  <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">
                    Envie arquivos ou crie notas manuais para construir o contexto do agente.
                  </p>
                </div>
              ) : (
                <div className="flex min-h-[160px] flex-col items-center justify-center px-6 text-center">
                  <FileText className="h-8 w-8 text-muted-foreground/50" />
                  <p className="mt-3 text-sm font-medium text-foreground">Nenhum documento encontrado</p>
                  <p className="mt-1 text-xs text-muted-foreground">Tente buscar por outro nome, tag, categoria ou colecao.</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <Card className="min-w-0 overflow-hidden rounded-[28px] border border-border bg-card shadow-sm">
        {selectedDoc ? (
          <>
            <CardHeader className="border-b border-border/60 bg-muted/30">
              <div className="flex min-w-0 flex-col gap-4 2xl:flex-row 2xl:items-start 2xl:justify-between">
                <div className="min-w-0 flex-1 space-y-3">
                  <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <PencilLine className="h-3.5 w-3.5 text-primary" />
                    Editor de documento
                  </div>
                  <div className="grid min-w-0 gap-3 md:grid-cols-2 2xl:grid-cols-[minmax(240px,1.2fr)_minmax(180px,0.75fr)_minmax(160px,0.55fr)]">
                    <div className="min-w-0 space-y-1.5 md:col-span-2 2xl:col-span-1">
                      <Label htmlFor="autopilot-doc-name" className="text-xs uppercase tracking-wide text-muted-foreground">
                        Título do documento
                      </Label>
                      <Input
                        id="autopilot-doc-name"
                        value={selectedDoc.name}
                        onChange={(event) => onUpdateName(selectedDoc.id, event.target.value)}
                        className="h-12 rounded-2xl border-border bg-background text-base font-semibold"
                      />
                    </div>
                    <div className="min-w-0 space-y-1.5">
                      <Label htmlFor="autopilot-doc-category" className="text-xs uppercase tracking-wide text-muted-foreground">
                        Categoria
                      </Label>
                      <Input
                        id="autopilot-doc-category"
                        list="autopilot-doc-category-options"
                        value={selectedDoc.category || ''}
                        onChange={(event) => onUpdateCategory(selectedDoc.id, event.target.value)}
                        placeholder="Ex: commercial_sales_flow"
                        className="h-12 rounded-2xl border-border bg-background font-mono text-sm"
                      />
                      <datalist id="autopilot-doc-category-options">
                        {categorySuggestions.map((category) => <option key={category} value={category} />)}
                      </datalist>
                    </div>
                    <div className="min-w-0 space-y-1.5">
                      <Label htmlFor="autopilot-doc-max-prompt-chars" className="text-xs uppercase tracking-wide text-muted-foreground">
                        Limite no prompt
                      </Label>
                      <Input
                        id="autopilot-doc-max-prompt-chars"
                        type="number"
                        min={1}
                        step={100}
                        value={selectedDoc.maxPromptChars ?? ''}
                        onChange={(event) => {
                          const rawValue = event.target.value.trim();
                          const parsedValue = Number.parseInt(rawValue, 10);
                          onUpdateMaxPromptChars(
                            selectedDoc.id,
                            rawValue && Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : null
                          );
                        }}
                        placeholder="Padrao: 1200"
                        className="h-12 rounded-2xl border-border bg-background font-mono text-sm"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">Colecoes autorizadas</Label>
                    <div className="flex flex-wrap gap-2">
                      {collections.map((collection) => {
                        const activeCollectionIds = selectedDoc.collectionIds?.length ? selectedDoc.collectionIds : ['general'];
                        const checked = activeCollectionIds.includes(collection.id);
                        return (
                          <label key={collection.id} className="flex cursor-pointer items-center gap-2 rounded-full border border-border bg-background px-3 py-2 text-xs">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) => {
                                const nextIds = event.target.checked
                                  ? Array.from(new Set([...activeCollectionIds, collection.id]))
                                  : activeCollectionIds.filter((id) => id !== collection.id);
                                onUpdateCollections(selectedDoc.id, nextIds.length > 0 ? nextIds : ['general']);
                              }}
                            />
                            {collection.name}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-full"
                    disabled={improvingDocumentId === selectedDoc.id || !selectedDoc.content.trim()}
                    onClick={async () => {
                      setImprovingDocumentId(selectedDoc.id);
                      try {
                        await onImproveDocument(selectedDoc);
                      } finally {
                        setImprovingDocumentId(null);
                      }
                    }}
                  >
                    {improvingDocumentId === selectedDoc.id
                      ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      : <Sparkles className="mr-2 h-4 w-4" />}
                    Melhorar para IA
                  </Button>
                  <Badge variant="outline" className="rounded-full">
                    {(selectedDoc.tokens || 0).toLocaleString()} tokens
                  </Badge>
                  <Badge variant="outline" className="max-w-full rounded-full text-[11px]">
                    {selectedDoc.sourceFormat === 'pdf' ? 'PDF' : selectedDoc.sourceFormat === 'markdown' ? 'Markdown' : selectedDoc.sourceFormat || 'Documento'}
                  </Badge>
                </div>
              </div>
            </CardHeader>

            <CardContent className="min-w-0 p-4 sm:p-5">
              <div className="grid gap-4">
                <div className="grid min-w-0 gap-3 rounded-[20px] border border-border bg-muted/20 p-4 lg:grid-cols-2">
                  <div className="min-w-0 space-y-1.5">
                    <Label htmlFor="autopilot-doc-summary" className="text-xs uppercase tracking-wide text-muted-foreground">
                      Resumo para recuperacao
                    </Label>
                    <Textarea
                      id="autopilot-doc-summary"
                      value={selectedDoc.summary || ''}
                      onChange={(event) => onUpdateMetadata(selectedDoc.id, { summary: event.target.value || null })}
                      placeholder="Resumo curto usado para facilitar a busca no RAG."
                      className="min-h-[104px] resize-y rounded-2xl border-border bg-background text-sm leading-5"
                    />
                  </div>
                  <div className="min-w-0 space-y-1.5">
                    <Label htmlFor="autopilot-doc-canonical-answer" className="text-xs uppercase tracking-wide text-muted-foreground">
                      Resposta canonica
                    </Label>
                    <Textarea
                      id="autopilot-doc-canonical-answer"
                      value={selectedDoc.canonicalAnswer || ''}
                      onChange={(event) => onUpdateMetadata(selectedDoc.id, { canonicalAnswer: event.target.value || null })}
                      placeholder="Resposta oficial e objetiva quando houver uma resposta direta."
                      className="min-h-[104px] resize-y rounded-2xl border-border bg-background text-sm leading-5"
                    />
                  </div>
                  <div className="min-w-0 space-y-1.5">
                    <Label htmlFor="autopilot-doc-tags" className="text-xs uppercase tracking-wide text-muted-foreground">
                      Tags de busca
                    </Label>
                    <Input
                      key={`${selectedDoc.id}-tags-${(selectedDoc.tags || []).join(',')}`}
                      id="autopilot-doc-tags"
                      defaultValue={(selectedDoc.tags || []).join(', ')}
                      onBlur={(event) => onUpdateMetadata(selectedDoc.id, {
                        tags: event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean),
                      })}
                      placeholder="wifi, senha, roteador"
                      className="h-11 rounded-2xl border-border bg-background text-sm"
                    />
                  </div>
                  <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(140px,0.45fr)_minmax(0,1fr)]">
                    <div className="min-w-0 space-y-1.5">
                      <Label htmlFor="autopilot-doc-context-role" className="text-xs uppercase tracking-wide text-muted-foreground">
                        Papel
                      </Label>
                      <select
                        id="autopilot-doc-context-role"
                        value={selectedDoc.contextRole || ''}
                        onChange={(event) => onUpdateMetadata(selectedDoc.id, { contextRole: event.target.value || null })}
                        className="flex h-11 w-full rounded-2xl border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        <option value="">Automatico</option>
                        <option value="fact">Fato</option>
                        <option value="procedure">Procedimento</option>
                        <option value="policy">Politica</option>
                        <option value="persona">Persona</option>
                      </select>
                    </div>
                    <div className="min-w-0 space-y-1.5">
                      <Label htmlFor="autopilot-doc-workflow-hints" className="text-xs uppercase tracking-wide text-muted-foreground">
                        Hints de fluxo
                      </Label>
                      <Input
                        key={`${selectedDoc.id}-workflow-hints-${(selectedDoc.workflowHints || []).join(',')}`}
                        id="autopilot-doc-workflow-hints"
                        defaultValue={(selectedDoc.workflowHints || []).join(', ')}
                        onBlur={(event) => onUpdateMetadata(selectedDoc.id, {
                          workflowHints: event.target.value.split(',').map((hint) => hint.trim()).filter(Boolean),
                        })}
                        placeholder="quando usar, intencao relacionada"
                        className="h-11 rounded-2xl border-border bg-background text-sm"
                      />
                    </div>
                  </div>
                </div>
                <div className="relative h-[min(68vh,720px)] min-h-[440px] rounded-[24px] border border-border bg-background shadow-sm">
                  <Textarea
                    ref={textareaRef}
                    className="relative z-10 h-full min-h-0 resize-none overflow-y-auto rounded-[24px] border-0 bg-background px-5 py-4 font-mono text-sm leading-6 text-foreground shadow-none selection:bg-primary/20 focus-visible:ring-2"
                    placeholder="Insira o conteúdo que o agente deve consultar durante o atendimento."
                    value={contentDraft}
                    onChange={(event) => {
                      updateContentDraft(selectedDoc.id, event.target.value);
                      updateToolMentionState(event.target.value, event.target.selectionStart);
                    }}
                    onBlur={commitPendingContent}
                    onKeyUp={(event) => updateToolMentionState(event.currentTarget.value, event.currentTarget.selectionStart)}
                    onClick={(event) => updateToolMentionState(event.currentTarget.value, event.currentTarget.selectionStart)}
                  />
                </div>

                {toolQuery != null && (
                  <div className="overflow-hidden rounded-[20px] border border-border bg-popover text-popover-foreground shadow-lg">
                    <div className="border-b border-border px-4 py-3">
                      <div className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">Selecionar ferramenta</div>
                      <div className="mt-1 text-xs text-muted-foreground">Digite @ e escolha uma tool interna ou MCP.</div>
                    </div>
                    <div className="max-h-72 overflow-y-auto p-2">
                      {filteredTools.length > 0 ? (
                        filteredTools.map((tool) => (
                          <button
                            key={tool.name}
                            type="button"
                            onMouseDown={(event) => {
                              event.preventDefault();
                              insertToolMention(tool.name);
                            }}
                            className="flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left transition-colors hover:bg-muted"
                          >
                            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-primary">
                              {tool.source === 'mcp' ? <Server className="h-4 w-4" /> : <Wrench className="h-4 w-4" />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="truncate font-mono text-xs font-semibold">@{tool.name}</span>
                                <Badge variant={tool.source === 'mcp' ? 'secondary' : 'outline'} className="rounded-full text-[10px]">
                                  {tool.source === 'mcp' ? tool.serverName || 'MCP' : 'Interna'}
                                </Badge>
                                <Badge variant={tool.riskLevel === 'high' ? 'destructive' : 'outline'} className="rounded-full text-[10px]">
                                  {tool.riskLevel}
                                </Badge>
                              </div>
                              <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{tool.description}</p>
                            </div>
                          </button>
                        ))
                      ) : (
                        <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                          Nenhuma tool encontrada para @{toolQuery}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {uniqueMentionedTools.length > 0 && (
                  <div className="rounded-[20px] border border-border bg-muted/20 px-4 py-3">
                    <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                      Tools detectadas neste documento
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {uniqueMentionedTools.map(({ mention, tool }) => (
                        <div
                          key={mention}
                          className={cn(
                            'inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium',
                            tool
                              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                              : 'border-destructive/30 bg-destructive/10 text-destructive'
                          )}
                          title={tool?.description || 'Tool nao reconhecida no catalogo do agente'}
                        >
                          {tool?.source === 'mcp' ? <Server className="h-3.5 w-3.5 shrink-0" /> : <Wrench className="h-3.5 w-3.5 shrink-0" />}
                          <span className="truncate font-mono">@{mention}</span>
                          <span className="shrink-0 rounded-full bg-background/70 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                            {tool ? (tool.source === 'mcp' ? tool.serverName || 'MCP' : 'Interna') : 'Nao encontrada'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-3 rounded-[24px] border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    Use @nome_da_tool para vincular procedimentos a ferramentas. A reindexação ocorre quando você salva o agente.
                  </span>
                  <span className="font-medium text-foreground">
                    {contentDraft.trim().length.toLocaleString()} caracteres
                  </span>
                </div>
              </div>
            </CardContent>
          </>
        ) : (
          <CardContent className="flex min-h-[520px] flex-col items-center justify-center px-6 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-muted text-muted-foreground">
              <FileText className="h-7 w-7" />
            </div>
            <h3 className="mt-5 text-lg font-semibold text-foreground">Selecione um documento</h3>
            <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
              Escolha um item na coluna lateral para editar o conteúdo e revisar a base de conhecimento do agente.
            </p>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
