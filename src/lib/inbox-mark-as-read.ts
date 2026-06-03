const DEFAULT_RETRY_DELAYS_MS = [0, 500, 1500];

const wait = (delayMs: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, delayMs));

export async function persistChatRead(
  chatId: string,
  retryDelaysMs: number[] = DEFAULT_RETRY_DELAYS_MS,
): Promise<boolean> {
  for (const delayMs of retryDelaysMs) {
    if (delayMs > 0) {
      await wait(delayMs);
    }

    try {
      const response = await fetch('/api/chats/mark-as-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId }),
      });
      if (response.ok) return true;
    } catch {
      // Retry transient request failures before falling back to delta sync.
    }
  }

  return false;
}
