import type { InterfaceTheme } from '@/lib/types';

const INTERFACE_THEMES = new Set<InterfaceTheme>(['light', 'dark', 'system']);

export function normalizeInterfaceTheme(value: unknown): InterfaceTheme | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  return INTERFACE_THEMES.has(value as InterfaceTheme)
    ? (value as InterfaceTheme)
    : undefined;
}
