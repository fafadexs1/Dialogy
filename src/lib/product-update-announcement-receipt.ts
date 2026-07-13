export const LEGACY_LOCAL_PRODUCT_UPDATE_READ_KEY = 'dialogy:local-product-update-demo:read';

export function isProductUpdatesLocalPreviewHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

export function productUpdateReadReceiptKey(userId: string, updateId: string): string {
  return `dialogy:product-update-read:${userId}:${updateId}`;
}
