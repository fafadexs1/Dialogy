import { z } from 'zod';
import { readStudioValue } from './data-mapping';

export const StudioCatalogImageSchema = z.object({
  catalogKey: z.string().min(1).max(200),
  productIdPath: z.string().min(1).max(200),
  imagePath: z.string().min(1).max(200),
  titlePath: z.string().min(1).max(200),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']).optional(),
  selectionMode: z.enum(['customer_choice', 'recommendation']).optional(),
  allowedHosts: z.array(z.string().min(1).max(253).regex(/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/)).min(1).max(20),
}).strict();
export type StudioCatalogImage = z.infer<typeof StudioCatalogImageSchema>;

/** Select a product, never a model-authored URL. Caller supplies integration outputs only. */
export function resolveStudioCatalogImage(config: StudioCatalogImage, productId: unknown, integrationValues: Record<string, unknown>) {
  const published = StudioCatalogImageSchema.parse(config);
  if ((typeof productId !== 'string' && typeof productId !== 'number') || productId === '' || (typeof productId === 'number' && !Number.isFinite(productId))) throw new Error('Selecione um produto do catálogo.');
  const catalog = readStudioValue(integrationValues, published.catalogKey);
  if (!Array.isArray(catalog) || catalog.length > 100) throw new Error('Consulte o catálogo antes de mostrar o produto.');
  const matches = catalog.filter((product) => readStudioValue(product, published.productIdPath) === productId);
  if (matches.length !== 1) throw new Error('O produto está ausente ou ambíguo no catálogo atual.');
  const product = matches[0];
  const image = readStudioValue(product, published.imagePath);
  const title = readStudioValue(product, published.titlePath);
  if (typeof image !== 'string' || image.length > 4096 || typeof title !== 'string' || !title.trim() || title.length > 500) throw new Error('A imagem ou o nome do produto está indisponível.');
  const url = new URL(image);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !published.allowedHosts.some((host) => url.hostname === host.toLowerCase())) {
    throw new Error('A imagem não pertence a um servidor publicado para este catálogo.');
  }
  return { productId, url: url.href, caption: title.trim(), mimeType: published.mimeType || 'image/jpeg' };
}
