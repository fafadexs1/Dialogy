import { enqueueMarketingAutoClose, shouldEnqueueJob } from '@/lib/queue';
import { executeMarketingAutoClose, getMarketingAutoCloseMs } from './auto-close';

export async function scheduleMarketingAutoClose(
  chatId: string,
  workspaceId: string,
  marketingSentAt: Date,
  autoCloseMs?: number,
  marketingMessageId?: string,
) {
  const delayMs = autoCloseMs ?? await getMarketingAutoCloseMs(workspaceId);
  if (delayMs <= 0) return;

  const payload = {
    chatId, workspaceId, marketingSentAt: marketingSentAt.toISOString(), autoCloseMs: delayMs,
    ...(marketingMessageId ? { marketingMessageId } : {}),
  };
  const runAt = new Date(marketingSentAt.getTime() + delayMs);
  if (shouldEnqueueJob('marketing_auto_close')) {
    await enqueueMarketingAutoClose(payload, { runAt, maxAttempts: 3 });
    return;
  }

  const timer = setTimeout(() => {
    void executeMarketingAutoClose({ ...payload, marketingSentAt }).catch(error => {
      console.error('[MARKETING_AUTO_CLOSE] Falha no encerramento local:', error);
    });
  }, Math.max(0, runAt.getTime() - Date.now()));
  timer.unref?.();
}
