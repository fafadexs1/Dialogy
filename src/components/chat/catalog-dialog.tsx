'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Loader2, Send } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CatalogEditor, emptyCatalogCard } from './catalog-editor';
import { whatsappCatalogSchema, type WhatsappCatalog } from '@/lib/whatsapp/catalog';
import { getWhatsappCatalogAvailability, sendWhatsappCatalogAction } from '@/actions/whatsapp-catalog';
import { useToast } from '@/hooks/use-toast';
import type { Message } from '@/lib/types';

export function CatalogDialog({ chatId, contactName, open, onOpenChange, onSent }: {
  chatId: string; contactName: string; open: boolean; onOpenChange: (open: boolean) => void;
  onSent: (message?: Message) => void;
}) {
  const [catalog, setCatalog] = useState<WhatsappCatalog>({ body: 'Confira nossos produtos!', cards: [emptyCatalogCard('product-1')] });
  const [availability, setAvailability] = useState<{ available: boolean; error?: string } | null>(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();
  const requestId = useRef<string | null>(null);
  const { toast } = useToast();
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void getWhatsappCatalogAvailability(chatId).then((result) => { if (!cancelled) setAvailability(result); })
      .catch(() => { if (!cancelled) setAvailability({ available: false, error: 'Falha ao verificar conexão. Feche e abra o catálogo para tentar novamente.' }); });
    return () => { cancelled = true; };
  }, [open, chatId]);
  const send = () => {
    const parsed = whatsappCatalogSchema.safeParse(catalog);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const product = issue?.path[0] === 'cards' && typeof issue.path[1] === 'number' ? `Produto ${issue.path[1] + 1}: ` : '';
      setError(`${product}${issue?.message || 'Revise o catálogo.'}`);
      return;
    }
    setError('');
    requestId.current ||= crypto.randomUUID();
    startTransition(async () => {
      try {
        const result = await sendWhatsappCatalogAction({ chatId, requestId: requestId.current!, catalog: parsed.data });
        if (!result.success) { requestId.current = null; setError(result.error || 'Falha ao enviar catálogo.'); return; }
        toast({ title: result.warning ? 'Confira o envio no WhatsApp' : 'Catálogo enviado', description: result.warning || `Enviado para ${contactName}.` });
        onSent(result.message);
        onOpenChange(false);
        requestId.current = null;
      } catch {
        setError('A confirmação do envio não chegou. Confira o histórico antes de tentar novamente.');
      }
    });
  };
  return (
    <Dialog open={open} onOpenChange={(value) => { if (!pending && !uploading) onOpenChange(value); }}>
      <DialogContent className="flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-2xl flex-col overflow-hidden">
        <DialogHeader><DialogTitle>Enviar catálogo</DialogTitle><DialogDescription>Monte os cartões para {contactName}. Cada produto precisa de foto, descrição e ao menos um botão.</DialogDescription></DialogHeader>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto pr-1">
          {!availability ? <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Verificando conexão…</p>
            : availability.available ? <CatalogEditor catalog={catalog} onChange={(value) => { setCatalog(value); setError(''); }} disabled={pending} onUploadingChange={setUploading} />
              : <p role="alert" className="py-4 text-sm text-muted-foreground">{availability.error}</p>}
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button type="button" variant="outline" disabled={pending || uploading} onClick={() => onOpenChange(false)}>Voltar</Button><Button type="button" disabled={pending || uploading || !availability?.available} onClick={send}>{pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Enviar catálogo</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
