function getJwtRole(key: string): string | null {
  if (key.startsWith('sb_secret_')) return 'service_role';

  const payloadPart = key.split('.')[1];
  if (!payloadPart || typeof globalThis.atob !== 'function') return null;

  try {
    const normalizedPayload = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const paddedPayload = normalizedPayload.padEnd(Math.ceil(normalizedPayload.length / 4) * 4, '=');
    const payload = JSON.parse(globalThis.atob(paddedPayload)) as { role?: unknown };
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

export function resolveSupabasePublicKey({
  anonKey,
  publishableKey,
}: {
  anonKey?: string;
  publishableKey?: string;
}): string | undefined {
  const candidates = [anonKey, publishableKey].filter((value): value is string => Boolean(value));
  const safeKey = candidates.find((value) => getJwtRole(value) !== 'service_role');

  if (safeKey) return safeKey;
  if (candidates.length > 0) {
    throw new Error('[SUPABASE] A service_role key cannot be used by the browser or SSR client. Configure an anon or publishable key.');
  }

  return undefined;
}
