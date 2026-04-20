import { useEffect, useRef, useState } from 'react';
import { FileText, Files, Loader2, PencilLine, Plus, Trash2, UploadCloud } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import type { KnowledgeBaseDocument } from '@/lib/types';
import { cn } from '@/lib/utils';

interface AutopilotKnowledgeProps {
  documents: KnowledgeBaseDocument[];
  onUpload: (files: FileList | null) => Promise<void>;
  onRemove: (id: string) => void;
  onUpdateContent: (id: string, content: string) => void;
  onUpdateName: (id: string, name: string) => void;
  onAddManual: () => void;
  isUploading: boolean;
}

export function AutopilotKnowledge({
  documents,
  onUpload,
  onRemove,
  onUpdateContent,
  onUpdateName,
  onAddManual,
  isUploading,
}: AutopilotKnowledgeProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);

  useEffect(() => {
    if (documents.length === 0) {
      setSelectedDocId(null);
      return;
    }

    if (!selectedDocId || !documents.some((doc) => doc.id === selectedDocId)) {
      setSelectedDocId(documents[0].id);
    }
  }, [documents, selectedDocId]);

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

  const selectedDoc = documents.find((doc) => doc.id === selectedDocId) || null;

  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
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
              accept=".txt,.md,.csv,.json"
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
            <p className="mt-1 text-xs text-muted-foreground">Arraste ou clique para enviar `.txt`, `.md`, `.csv` e `.json`.</p>
          </div>

          <Button onClick={onAddManual} variant="outline" className="w-full rounded-2xl">
            <Plus className="mr-2 h-4 w-4" />
            Nova nota manual
          </Button>

          <ScrollArea className="max-h-[520px] rounded-[24px] border border-border bg-muted/20">
            <div className="grid gap-2 p-3">
              {documents.length > 0 ? (
                documents.map((doc) => {
                  const isSelected = selectedDoc?.id === doc.id;

                  return (
                    <div
                      key={doc.id}
                      onClick={() => setSelectedDocId(doc.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
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
              ) : (
                <div className="flex min-h-[220px] flex-col items-center justify-center rounded-[20px] border border-dashed border-border bg-background/60 px-6 text-center">
                  <FileText className="h-10 w-10 text-muted-foreground/50" />
                  <p className="mt-4 text-sm font-medium text-foreground">Nenhum documento adicionado</p>
                  <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">
                    Envie arquivos ou crie notas manuais para construir o contexto do agente.
                  </p>
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
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <PencilLine className="h-3.5 w-3.5 text-primary" />
                    Editor de documento
                  </div>
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

                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="rounded-full">
                    {(selectedDoc.tokens || 0).toLocaleString()} tokens
                  </Badge>
                  <Badge variant="outline" className="max-w-full rounded-full font-mono text-[11px]">
                    {selectedDoc.id}
                  </Badge>
                </div>
              </div>
            </CardHeader>

            <CardContent className="min-w-0 p-4 sm:p-5">
              <div className="grid gap-4">
                <Textarea
                  className="min-h-[440px] resize-y rounded-[24px] border-border bg-background px-5 py-4 font-mono text-sm leading-6 shadow-sm"
                  placeholder="Insira o conteúdo que o agente deve consultar durante o atendimento."
                  value={selectedDoc.content}
                  onChange={(event) => onUpdateContent(selectedDoc.id, event.target.value)}
                />

                <div className="flex flex-col gap-3 rounded-[24px] border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    Atualize o conteúdo livremente. A reindexação ocorre quando você salva o agente.
                  </span>
                  <span className="font-medium text-foreground">
                    {selectedDoc.content.trim().length.toLocaleString()} caracteres
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
