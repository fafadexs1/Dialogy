import { describe, expect, it } from 'vitest';

import {
  isProductUpdatesLocalPreviewHostname,
  productUpdateReadReceiptKey,
} from '@/lib/product-update-announcement-receipt';

describe('product update announcement receipt', () => {
  it.each(['localhost', 'LOCALHOST', '127.0.0.1', '::1', '[::1]'])(
    'recognizes %s as a local preview hostname',
    (hostname) => {
      expect(isProductUpdatesLocalPreviewHostname(hostname)).toBe(true);
    },
  );

  it.each(['dialogy.local', '192.168.1.10', '0.0.0.0'])(
    'does not classify %s as a local preview hostname',
    (hostname) => {
      expect(isProductUpdatesLocalPreviewHostname(hostname)).toBe(false);
    },
  );

  it('scopes optimistic receipts by user and publication', () => {
    expect(productUpdateReadReceiptKey('user-1', 'update-1')).toBe(
      'dialogy:product-update-read:user-1:update-1',
    );
    expect(productUpdateReadReceiptKey('user-2', 'update-1')).not.toBe(
      productUpdateReadReceiptKey('user-1', 'update-1'),
    );
  });
});
