'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Brain, CheckCircle2, Loader2, Sparkles } from 'lucide-react';

import {
  generateConversationKnowledgeDraft,
  publishConversationKnowledgeDraft,
} from '@/actions/autopilot';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import type { AutopilotConfig, KnowledgeBaseDocument } from '@/lib/types';

type ConversationLearningDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chatId: string | null;
  workspaceId: string | null;
  agent: AutopilotConfig | null;
  onPublished?: () => void;
};

export function ConversationLearningDialog({
  open,
  onOpenChange,
  chatId,
  workspaceId,
  agent,
  onPublished,
}: ConversationLearningDialogProps) {
  const { toast } = useToast();
  const requestKeyRef = useRef('');
  const [document, setDocument] = useState<KnowledgeBaseDocument | null>(null);
  const [reason, setReason] = useState('');
  const [collectionName, setCollectionName] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);

  useEffect(() => {
    if (!open || !chatId || !workspaceId || !agent?.id) return;
    const requestKey = `${chatId}:${agent.id}`;
    if (requestKeyRef.current === requestKey && (document || error || reason)) return;
    requestKeyRef.current = requestKey;
    setDocument(null);
    setReason('');
    setError('');
    setCollectionName(null);
    setIsGenerating(true);

    void generateConversationKnowledgeDraft({ workspaceId, configId: agent.id, chatId })
      .then((result) => {
        setDocument(result.document);
        setReason(result.reason || '');
        setCollectionName(result.collectionName || null);
        setError(result.error || '');
      })
      .finally(() => setIsGenerating(false));
  }, [agent?.id, chatId, document, error, open, reason, workspaceId]);

  const updateDocument = <K extends keyof KnowledgeBaseDocument>(key: K, value: KnowledgeBaseDocument[K]) => {
    setDocument((current) => current ? { ...current, [key]: value } : current);
  };

  const regenerate = () => {
    requestKeyRef.current = '';
    setDocument(null);
    setReason('');
    setError('');
  };

  const publish = async () => {
    if (!document || !chatId || !workspaceId || !agent?.id) return;
    setIsPublishing(true);
    const result = await publishConversationKnowledgeDraft({
      workspaceId,
      configId: agent.id,
      chatId,
      document,
    });
    setIsPublishing(false);
    if (!result.success) {
      toast({ title: 'Nao foi possivel publicar', description: result.error, variant: 'destructive' });
      return;
    }
    toast({
      title: 'Aprendizado publicado',
      description: `A nota foi adicionada a base de conhecimento de ${agent.name}.`,
    });
    requestKeyRef.current = '';
    setDocument(null);
    setReason('');
    onPublished?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-cyan-500" />
            Aprender com esta conversa
          </DialogTitle>
          <DialogDescription>
            A IA transforma o atendimento em uma orientacao reutilizavel. O historico bruto nao sera salvo na base.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border bg-muted/35 px-3 py-2 text-sm">
          <span className="font-medium">Agente:</span> {agent?.name || 'Nao selecionado'}
          {collectionName && <span className="text-muted-foreground"> · Colecao: {collectionName}</span>}
        </div>

        {isGenerating && (
          <div className="flex min-h-56 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
            <Loader2 className="h-7 w-7 animate-spin text-cyan-500" />
            <div>
              <p className="font-medium text-foreground">Analisando problema, acao e resultado...</p>
              <p className="text-sm">Tambem estamos comparando a sugestao com a base atual.</p>
            </div>
          </div>
        )}

        {!isGenerating && !document && (
          <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-6 text-center">
            <AlertTriangle className="h-7 w-7 text-amber-500" />
            <div>
              <p className="font-medium">Nenhum aprendizado seguro foi gerado</p>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                {error || reason || 'Nao foi encontrada uma resolucao clara e reutilizavel nesta conversa.'}
              </p>
            </div>
            <Button variant="outline" onClick={regenerate}>
              <Sparkles className="mr-2 h-4 w-4" />
              Analisar novamente
            </Button>
          </div>
        )}

        {!isGenerating && document && (
          <div className="space-y-4">
            {reason && (
              <div className="flex gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3 text-sm">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                <p>{reason}</p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="learning-title">Titulo da nota</Label>
              <Input
                id="learning-title"
                value={document.name}
                onChange={(event) => updateDocument('name', event.target.value)}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="learning-category">Categoria</Label>
                <Input
                  id="learning-category"
                  value={document.category || ''}
                  onChange={(event) => updateDocument('category', event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Tipo de conhecimento</Label>
                <Select
                  value={document.contextRole || 'procedure'}
                  onValueChange={(value) => updateDocument('contextRole', value)}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="procedure">Procedimento</SelectItem>
                    <SelectItem value="fact">Fato / resposta</SelectItem>
                    <SelectItem value="policy">Politica</SelectItem>
                    <SelectItem value="persona">Tom e comportamento</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="learning-summary">Resumo para busca</Label>
              <Textarea
                id="learning-summary"
                className="min-h-20"
                value={document.summary || ''}
                onChange={(event) => updateDocument('summary', event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="learning-content">Orientacao operacional</Label>
              <Textarea
                id="learning-content"
                className="min-h-64 font-mono text-sm"
                value={document.content}
                onChange={(event) => updateDocument('content', event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="learning-answer">Resposta sugerida ao cliente</Label>
              <Textarea
                id="learning-answer"
                className="min-h-24"
                value={document.canonicalAnswer || ''}
                onChange={(event) => updateDocument('canonicalAnswer', event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="learning-tags">Tags</Label>
              <Input
                id="learning-tags"
                value={(document.tags || []).join(', ')}
                onChange={(event) => updateDocument('tags', event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean))}
                placeholder="suporte, conexao, los"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={publish} disabled={!document || isGenerating || isPublishing}>
            {isPublishing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            Aprovar e publicar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
