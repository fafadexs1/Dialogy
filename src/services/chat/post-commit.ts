import 'server-only';
import { after } from 'next/server';

/** Ancillary work cannot turn a committed Inbox mutation into a timeout. */
export function scheduleChatPostCommit(name: string, task: () => Promise<void>) {
  const run = async () => {
    try { await task(); }
    catch (error) { console.error(`[CHAT_POST_COMMIT][${name}]`, error); }
  };
  try { after(run); }
  catch { void run(); } // Long-lived worker/direct invocation without a Next request.
}
