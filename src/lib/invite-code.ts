export function normalizeInviteCode(value: string | null | undefined): string {
  let normalized = String(value ?? '').trim();

  if (!normalized) return '';

  const queryMatch = normalized.match(/[?&](?:code|invite|inviteCode)=([^&#]+)/i);
  const pathMatch = normalized.match(/\/(?:join|invite|invites)\/([^/?#]+)/i);

  if (queryMatch?.[1]) {
    normalized = queryMatch[1];
  } else if (pathMatch?.[1]) {
    normalized = pathMatch[1];
  } else if (normalized.includes('/')) {
    normalized = normalized.split('/').filter(Boolean).pop() || normalized;
  }

  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    // Keep the user's input if it is not valid URI-encoded text.
  }

  return normalized.trim().replace(/\s+/g, '').toUpperCase();
}

