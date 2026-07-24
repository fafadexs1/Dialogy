export function normalizeWebchatOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return null;
  }
}

export function isWebchatOriginAllowed(origin: string | null, allowedDomains: string[]) {
  if (allowedDomains.length === 0) return true;
  const normalizedOrigin = normalizeWebchatOrigin(origin);
  if (!normalizedOrigin) return false;
  const hostname = new URL(normalizedOrigin).hostname.toLowerCase();
  return allowedDomains.some((entry) => {
    const normalized = entry.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    return normalized === hostname || (normalized.startsWith('*.') && hostname.endsWith(normalized.slice(1)));
  });
}

