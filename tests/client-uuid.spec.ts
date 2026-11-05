import { afterEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { createClientUuid } from '@/lib/client-uuid';

afterEach(() => vi.unstubAllGlobals());

describe('client UUIDs on HTTP origins', () => {
  it('generates valid, distinct v4 identifiers without crypto.randomUUID', () => {
    vi.stubGlobal('crypto', { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });
    const ids = Array.from({ length: 1000 }, () => createClientUuid());
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
  });
  it('does not call randomUUID even if a browser exposes a non-callable value', () => {
    vi.stubGlobal('crypto', { getRandomValues: webcrypto.getRandomValues.bind(webcrypto), randomUUID: undefined });
    expect(createClientUuid()).toHaveLength(36);
  });

  it('keeps rendering in an environment without a Web Crypto global', () => {
    vi.stubGlobal('crypto', undefined);
    expect(createClientUuid()).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
  });
});
