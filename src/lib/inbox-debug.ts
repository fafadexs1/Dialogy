const INBOX_DEBUG_ENABLED = process.env.NEXT_PUBLIC_INBOX_DEBUG === 'true';

export function inboxDebug(...args: unknown[]) {
  if (!INBOX_DEBUG_ENABLED) return;
  console.debug(...args);
}
