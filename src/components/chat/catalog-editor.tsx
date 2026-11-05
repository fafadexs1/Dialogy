'use client';

import { Plus, Trash2, Upload } from 'lucide-react';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { MAX_CATALOG_CARDS, type WhatsappCatalog } from '@/lib/whatsapp/catalog';
import { uploadFileToStorage } from '@/lib/supabase/storage';
import { createUniqueMediaStoragePath } from '@/lib/media-file-name';
import { CatalogPreview } from './catalog-preview';

export function emptyCatalogCard(id: string): WhatsappCatalog['cards'][number] {
  return { title: '', body: '', imageUrl: '', buttons: [{ type: 'reply', displayText: 'Tenho interesse', id }] };
}

export function CatalogEditor({ catalog, onChange, disabled = false, allowUpload = true, onUploadingChange }: {
  catalog: WhatsappCatalog; onChange: (value: WhatsappCatalog) => void; disabled?: boolean; allowUpload?: boolean;
  onUploadingChange?: (uploading: boolean) => void;
}) {
  const prefix = useId();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const updateCard = (index: number, patch: Partial<WhatsappCatalog['cards'][number]>) => {
    onChange({ ...catalog, cards: catalog.cards.map((card, position) => position === index ? { ...card, ...patch } : card) });
  };
  const uploadPhoto = async (index: number, file?: File) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setError('Use uma foto JPG ou PNG de até 5 MB.');
      return;
    }
    setUploading(true);
    onUploadingChange?.(true);
    setError('');
    try {
      const result = await uploadFileToStorage(file, 'temp-media', createUniqueMediaStoragePath(file.name, 'catalog'));
      if (result.error || !result.publicUrl) throw new Error(result.error || 'Falha ao carregar foto.');
      updateCard(index, { imageUrl: result.publicUrl });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao carregar foto.'); }
    finally { setUploading(false); onUploadingChange?.(false); }
  };
  return (
    <div className="min-w-0 space-y-5">
      <fieldset disabled={disabled || uploading} className="min-w-0 space-y-4 disabled:opacity-60">
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-body`}>Mensagem de apresentação</Label>
          <Textarea id={`${prefix}-body`} value={catalog.body} maxLength={1024} rows={2} onChange={(event) => onChange({ ...catalog, body: event.target.value })} placeholder="Confira nossos produtos!" />
        </div>
        {catalog.cards.map((card, index) => {
          const link = card.buttons.find((button) => button.type === 'url');
          const reply = card.buttons.find((button) => button.type === 'reply');
          const setLink = (url: string, displayText = link?.displayText || 'Compre agora') => updateCard(index, {
            buttons: [...(url ? [{ type: 'url' as const, url, displayText }] : []), ...card.buttons.filter((button) => button.type !== 'url')],
          });
          return (
            <section key={index} className="min-w-0 space-y-3 rounded-xl border border-border p-4" aria-label={`Produto ${index + 1}`}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Produto {index + 1}</h3>
                <Button type="button" variant="ghost" size="icon" disabled={catalog.cards.length === 1} aria-label={`Remover produto ${index + 1}`} onClick={() => onChange({ ...catalog, cards: catalog.cards.filter((_, position) => position !== index) })}><Trash2 className="h-4 w-4" /></Button>
              </div>
              <div className="space-y-1.5"><Label htmlFor={`${prefix}-${index}-title`}>Nome</Label><Input id={`${prefix}-${index}-title`} value={card.title} maxLength={100} onChange={(event) => updateCard(index, { title: event.target.value })} placeholder="Nome do produto" /></div>
              <div className="space-y-1.5"><Label htmlFor={`${prefix}-${index}-description`}>Descrição e preço</Label><Textarea id={`${prefix}-${index}-description`} value={card.body} maxLength={900} rows={3} onChange={(event) => updateCard(index, { body: event.target.value })} placeholder="Descreva o produto, opções e valor." /></div>
              <div className="space-y-1.5">
                <Label htmlFor={`${prefix}-${index}-image`}>Foto (URL HTTPS)</Label>
                <Input id={`${prefix}-${index}-image`} value={card.imageUrl} onChange={(event) => updateCard(index, { imageUrl: event.target.value })} placeholder="https://.../produto.jpg" />
                {allowUpload && <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-primary"><Upload className="h-3.5 w-3.5" />Carregar foto<input type="file" className="sr-only" aria-label={`Carregar foto do produto ${index + 1}`} accept="image/jpeg,image/png" onChange={(event) => { void uploadPhoto(index, event.target.files?.[0]); event.target.value = ''; }} /></label>}
              </div>
              <div className="space-y-1.5"><Label htmlFor={`${prefix}-${index}-url`}>Link de compra (opcional)</Label><Input id={`${prefix}-${index}-url`} value={link?.type === 'url' ? link.url : ''} onChange={(event) => setLink(event.target.value)} placeholder="https://sualoja.com/produto" /></div>
              {link && <div className="space-y-1.5"><Label htmlFor={`${prefix}-${index}-link-label`}>Texto do botão de compra</Label><Input id={`${prefix}-${index}-link-label`} value={link.displayText} maxLength={25} onChange={(event) => setLink(link.type === 'url' ? link.url : '', event.target.value)} /></div>}
              <div className="space-y-1.5"><Label htmlFor={`${prefix}-${index}-reply`}>Botão de resposta</Label><Input id={`${prefix}-${index}-reply`} value={reply?.displayText || ''} maxLength={25} onChange={(event) => updateCard(index, {
                buttons: [...card.buttons.filter((button) => button.type !== 'reply'), ...(event.target.value ? [{ type: 'reply' as const, displayText: event.target.value, id: reply?.type === 'reply' ? reply.id : `product-${crypto.randomUUID()}` }] : [])],
              })} placeholder="Tenho interesse" /></div>
              {!allowUpload && <div className="space-y-1.5"><Label htmlFor={`${prefix}-${index}-reply-id`}>Identificador da resposta</Label><Input id={`${prefix}-${index}-reply-id`} value={reply?.type === 'reply' ? reply.id : ''} disabled={!reply} maxLength={200} onChange={(event) => updateCard(index, { buttons: card.buttons.map((button) => button.type === 'reply' ? { ...button, id: event.target.value } : button) })} placeholder="produto-1" /><p className="text-xs text-muted-foreground">Use esse valor no próximo menu ou condição do fluxo.</p></div>}
            </section>
          );
        })}
        <Button type="button" variant="outline" disabled={catalog.cards.length >= MAX_CATALOG_CARDS} onClick={() => onChange({ ...catalog, cards: [...catalog.cards, emptyCatalogCard(`product-${crypto.randomUUID()}`)] })}><Plus className="mr-2 h-4 w-4" />Adicionar produto ({catalog.cards.length}/{MAX_CATALOG_CARDS})</Button>
      </fieldset>
      {uploading && <p role="status" className="text-sm text-muted-foreground">Carregando foto…</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="min-w-0 rounded-xl bg-muted/50 p-3"><p className="mb-3 text-xs font-semibold text-muted-foreground">Prévia do catálogo</p><CatalogPreview catalog={catalog} /></div>
    </div>
  );
}
