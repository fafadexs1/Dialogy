'use client';

import { ExternalLink, ImageIcon, Reply } from 'lucide-react';
import type { WhatsappCatalog } from '@/lib/whatsapp/catalog';
import { resolveClientMediaUrl } from '@/lib/storage-url';

export function CatalogPreview({ catalog }: { catalog: WhatsappCatalog }) {
  return (
    <div className="min-w-0 max-w-full space-y-3">
      <p className="whitespace-pre-wrap break-words text-sm">{catalog.body}</p>
      <div className="flex max-w-full snap-x gap-3 overflow-x-auto pb-2" role="region" aria-label="Produtos do catálogo" tabIndex={0}>
        {catalog.cards.map((card, index) => (
          <article key={index} className="w-60 shrink-0 snap-start overflow-hidden rounded-xl border border-border bg-background text-foreground">
            {card.imageUrl && !card.imageUrl.includes('{{') ? (
              // Catalog images include external URLs and private storage URLs.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={resolveClientMediaUrl(card.imageUrl)} alt={card.title || `Produto ${index + 1}`} className="aspect-[4/3] w-full object-cover" loading="lazy" />
            ) : <div className="flex aspect-[4/3] items-center justify-center bg-muted"><ImageIcon className="h-8 w-8 text-muted-foreground" /></div>}
            <div className="space-y-1 p-3">
              <p className="break-words text-sm font-semibold">{card.title || `Produto ${index + 1}`}</p>
              <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{card.body || 'Descrição do produto'}</p>
            </div>
            {card.buttons.map((button, buttonIndex) => (
              <div key={buttonIndex} className="flex items-center justify-center gap-2 border-t border-border px-3 py-2.5 text-center text-xs font-medium text-primary">
                {button.type === 'url' ? <ExternalLink className="h-3.5 w-3.5" /> : <Reply className="h-3.5 w-3.5" />}
                {button.displayText}
              </div>
            ))}
          </article>
        ))}
      </div>
      <p className="text-[10px] opacity-70">{catalog.cards.length} {catalog.cards.length === 1 ? 'produto' : 'produtos'} · Deslize para ver</p>
    </div>
  );
}
