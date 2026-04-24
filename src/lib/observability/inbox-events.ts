type InboxEventLevel = 'info' | 'warn' | 'error';

type InboxEventPayload = Record<string, unknown>;

function shouldLogInboxEvents(level: InboxEventLevel): boolean {
  if (process.env.NODE_ENV === 'test') return false;
  if (level === 'error' || level === 'warn') return true;
  return process.env.NEXT_PUBLIC_INBOX_DEBUG === 'true' || process.env.INBOX_DEBUG === 'true';
}

export function recordInboxEvent(
  event: string,
  payload: InboxEventPayload = {},
  level: InboxEventLevel = 'info',
): void {
  if (!shouldLogInboxEvents(level)) return;

  const entry = {
    scope: 'inbox',
    event,
    timestamp: new Date().toISOString(),
    ...payload,
  };

  if (level === 'error') {
    console.error('[INBOX_EVENT]', entry);
    return;
  }

  if (level === 'warn') {
    console.warn('[INBOX_EVENT]', entry);
    return;
  }

  console.info('[INBOX_EVENT]', entry);
}
