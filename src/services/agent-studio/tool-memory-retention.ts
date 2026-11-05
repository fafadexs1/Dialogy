import 'server-only';
import { purgeExpiredStudioToolMemory } from './tool-memory-store';

let timer: ReturnType<typeof setInterval> | undefined;
let running = false;
export function startStudioToolMemoryRetention() {
  if (timer) return;
  const tick = () => {
    if (running) return;
    running = true;
    void purgeExpiredStudioToolMemory().catch(() => console.error('[STUDIO_TOOL_MEMORY] Falha ao remover observações expiradas.')).finally(() => { running = false; });
  };
  tick();
  timer = setInterval(tick, 24 * 60 * 60_000);
  (timer as ReturnType<typeof setInterval> & { unref?: () => void }).unref?.();
}
export function stopStudioToolMemoryRetention() {
  if (timer) clearInterval(timer);
  timer = undefined;
}
