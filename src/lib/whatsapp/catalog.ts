import { z } from 'zod';

export const MAX_CATALOG_CARDS = 10;

const httpsUrl = z.string().trim().max(2048).url('Informe uma URL válida.').refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch { return false; }
}, 'Use uma URL HTTPS sem credenciais.');

const catalogButtonSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('url'),
    displayText: z.string().trim().min(1).max(25),
    url: httpsUrl,
  }),
  z.object({
    type: z.literal('reply'),
    displayText: z.string().trim().min(1).max(25),
    id: z.string().trim().min(1).max(200),
  }),
]);

export const whatsappCatalogSchema = z.object({
  body: z.string().trim().min(1, 'Escreva a mensagem de apresentação.').max(1024),
  cards: z.array(z.object({
    title: z.string().trim().min(1, 'Informe o nome do produto.').max(100),
    body: z.string().trim().min(1, 'Escreva a descrição do produto.').max(900),
    imageUrl: httpsUrl,
    buttons: z.array(catalogButtonSchema).min(1).max(3),
  })).min(1, 'Adicione pelo menos um produto.').max(MAX_CATALOG_CARDS),
});

export type WhatsappCatalog = z.infer<typeof whatsappCatalogSchema>;

export function buildCatalogPreview(catalog: WhatsappCatalog): string {
  return [catalog.body, ...catalog.cards.map((card) => `${card.title}\n${card.body}`)].join('\n\n');
}

export const CATALOG_CONNECTION_HELP = 'O catálogo em carrossel está disponível nas conexões por QR Code (Evolution/Baileys). Para a conexão oficial da Meta, use um template de carrossel aprovado.';

export function supportsWhatsappCatalog(instanceType: unknown): boolean {
  return instanceType === 'baileys' || instanceType === 'WHATSAPP-BAILEYS';
}
