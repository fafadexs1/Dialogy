import 'server-only';

import { unstable_cache } from 'next/cache';

import { db } from '@/lib/db';

const getSystemSettingsCached = unstable_cache(
  async (keys: string[]): Promise<Record<string, string>> => {
    const result = await db.query(
      'SELECT key, value FROM system_settings WHERE key = ANY($1)',
      [keys],
    );

    return Object.fromEntries(result.rows.map((row) => [row.key, row.value]));
  },
  ['system-settings'],
  { tags: ['system-settings'], revalidate: false },
);

function normalizeKeys(keys: string[]): string[] {
  return [...new Set(keys.filter(Boolean))].sort();
}

/**
 * Server-only settings reader. Keep this outside a `use server` module so it
 * cannot be registered as a remotely invokable Server Action.
 */
export async function getSystemSettings(keys: string[]): Promise<Record<string, string>> {
  const normalized = normalizeKeys(keys);
  if (normalized.length === 0) return {};
  return getSystemSettingsCached(normalized);
}
