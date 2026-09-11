import { describe, expect, it } from 'vitest';
import { resolveStudioCatalogImage, type StudioCatalogImage } from '@/services/agent-studio/catalog-media';
const config: StudioCatalogImage = { catalogKey: 'products', productIdPath: 'sku', imagePath: 'photo.url', titlePath: 'name', allowedHosts: ['images.store.example'] };
const dress = { sku: 'dress-blue-m', name: 'Vestido azul · M', photo: { url: 'https://images.store.example/dress-blue-m.jpg' } };
describe('catalog-backed product images', () => {
  it('selects the exact product and its real catalog image and caption', () => {
    expect(resolveStudioCatalogImage(config, dress.sku, { products: [dress, { ...dress, sku: 'other', name: 'Outro vestido' }] })).toEqual({ productId: dress.sku, url: dress.photo.url, caption: dress.name, mimeType: 'image/jpeg' });
  });
  it('does not accept a URL as a product or a removed/ambiguous product', () => {
    for (const products of [[], [dress, dress]]) expect(() => resolveStudioCatalogImage(config, dress.sku, { products })).toThrow();
    expect(() => resolveStudioCatalogImage(config, dress.photo.url, { products: [dress] })).toThrow();
  });
  it.each(['http://images.store.example/x', 'https://images.store.example.evil.test/x', 'https://localhost/x', 'https://user:pass@images.store.example/x', 'https://images.store.example:8443/x', 'data:image/png;base64,abc'])('rejects an unauthorized catalog image %s', (url) => {
    expect(() => resolveStudioCatalogImage(config, dress.sku, { products: [{ ...dress, photo: { url } }] })).toThrow();
  });
  it('revalidates the selected product against updated catalog data', () => {
    const changed = { ...dress, photo: { url: 'https://images.store.example/new-photo.jpg' } };
    expect(resolveStudioCatalogImage(config, dress.sku, { products: [changed] }).url).toBe(changed.photo.url);
    expect(() => resolveStudioCatalogImage(config, dress.sku, { products: [{ ...dress, photo: {} }] })).toThrow();
  });
});
