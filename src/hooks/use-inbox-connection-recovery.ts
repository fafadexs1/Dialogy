'use client';

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';

type RunDeltaSync = (options?: { force?: boolean }) => Promise<void>;

const INITIAL_RECOVERY_DELAY_MS = 750;
const VISIBLE_RECOVERY_INTERVAL_MS = 4000;
const HIDDEN_RECOVERY_INTERVAL_MS = 8000;
const OFFLINE_RECOVERY_INTERVAL_MS = 8000;
const MAX_RECOVERY_INTERVAL_MS = 30000;

function isBrowserOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function getRecoveryInterval(attempts: number) {
  if (!isBrowserOnline()) return OFFLINE_RECOVERY_INTERVAL_MS;

  const isVisible = typeof document === 'undefined' || document.visibilityState === 'visible';
  const baseInterval = isVisible ? VISIBLE_RECOVERY_INTERVAL_MS : HIDDEN_RECOVERY_INTERVAL_MS;
  const backoff = Math.min(attempts * 2000, MAX_RECOVERY_INTERVAL_MS - baseInterval);

  return Math.min(baseInterval + backoff, MAX_RECOVERY_INTERVAL_MS);
}

export function useInboxConnectionRecovery({
  workspaceId,
  runDeltaSync,
  realtimeHealthyRef,
}: {
  workspaceId: string | null | undefined;
  runDeltaSync: RunDeltaSync;
  realtimeHealthyRef: MutableRefObject<boolean>;
}) {
  const runDeltaSyncRef = useRef(runDeltaSync);
  const attemptsRef = useRef(0);
  const [isRecovering, setIsRecovering] = useState(false);

  useEffect(() => {
    runDeltaSyncRef.current = runDeltaSync;
  }, [runDeltaSync]);

  const clearRecoverySync = useCallback(() => {
    attemptsRef.current = 0;
    setIsRecovering(false);
  }, []);

  const scheduleRecoverySync = useCallback((reason?: string) => {
    if (!workspaceId || realtimeHealthyRef.current) return;
    if (reason) {
      console.info('[INBOX_RECOVERY] Scheduling delta sync recovery:', reason);
    }
    setIsRecovering(true);
  }, [realtimeHealthyRef, workspaceId]);

  useEffect(() => {
    if (!isRecovering || !workspaceId) return;

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const runRecoveryLoop = async () => {
      if (cancelled) return;
      if (!workspaceId || realtimeHealthyRef.current) {
        attemptsRef.current = 0;
        setIsRecovering(false);
        return;
      }

      if (isBrowserOnline()) {
        try {
          await runDeltaSyncRef.current({ force: true });
          attemptsRef.current = 0;
        } catch (error) {
          attemptsRef.current += 1;
          console.warn('[INBOX_RECOVERY] Delta sync failed during connection recovery:', error);
        }
      } else {
        attemptsRef.current += 1;
      }

      if (cancelled) return;
      if (realtimeHealthyRef.current) {
        attemptsRef.current = 0;
        setIsRecovering(false);
        return;
      }

      timeoutId = setTimeout(runRecoveryLoop, getRecoveryInterval(attemptsRef.current));
    };

    timeoutId = setTimeout(runRecoveryLoop, INITIAL_RECOVERY_DELAY_MS);

    return () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [isRecovering, realtimeHealthyRef, workspaceId]);

  useEffect(() => {
    if (typeof window === 'undefined' || !workspaceId) return;

    const scheduleWhenNeeded = (reason: string) => {
      if (!realtimeHealthyRef.current) {
        scheduleRecoverySync(reason);
      }
    };

    const onOnline = () => scheduleWhenNeeded('browser-online');
    const onFocus = () => scheduleWhenNeeded('window-focus');
    const onVisibility = () => {
      scheduleWhenNeeded(document.visibilityState === 'visible' ? 'tab-visible' : 'tab-hidden');
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [realtimeHealthyRef, scheduleRecoverySync, workspaceId]);

  return { scheduleRecoverySync, clearRecoverySync };
}
