'use client';

import React, { useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';

const CHANNEL_NAME = 'dialogy-build-sync';
const STORAGE_KEY = 'dialogy-build-id';
const CHECK_INTERVAL_MS = 30000;

function getInitialBuildId(): string | null {
  if (typeof window === 'undefined') return null;
  const buildId = (window as any).__NEXT_DATA__?.buildId;
  if (typeof buildId === 'string' && buildId && buildId !== 'dev') return buildId;
  try {
    const sessionVal = sessionStorage.getItem(STORAGE_KEY);
    if (sessionVal && sessionVal !== 'dev') return sessionVal;
  } catch {
    /* ignore */
  }
  return null;
}

export function BuildVersionWatcher() {
  const { toast } = useToast();
  const router = useRouter();
  const currentBuildIdRef = useRef<string | null>(getInitialBuildId());
  const updateNotifiedRef = useRef(false);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const softRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const queueSoftRefresh = useCallback(() => {
    if (softRefreshTimeoutRef.current) return;
    softRefreshTimeoutRef.current = setTimeout(() => {
      softRefreshTimeoutRef.current = null;
      router.refresh();
    }, 750);
  }, [router]);

  const notifyUpdateAvailable = useCallback((reason: string, serverBuildId?: string) => {
    if (updateNotifiedRef.current) return;
    updateNotifiedRef.current = true;
    try {
      if (serverBuildId) {
        sessionStorage.setItem(STORAGE_KEY, serverBuildId);
      }
    } catch {
      /* ignore storage failures */
    }
    if (channelRef.current) {
      channelRef.current.postMessage({ type: 'BUILD_UPDATE_AVAILABLE', buildId: serverBuildId, reason });
    }
    queueSoftRefresh();

    toast({
      title: 'Dialogy sincronizando',
      description: 'Detectamos uma atualizacao. A tela sera sincronizada em segundo plano, sem recarregar a pagina.',
    });
  }, [queueSoftRefresh, toast]);

  useEffect(() => {
    return () => {
      if (softRefreshTimeoutRef.current) {
        clearTimeout(softRefreshTimeoutRef.current);
      }
    };
  }, []);

  const checkBuild = useCallback(async () => {
    if (updateNotifiedRef.current) return;
    try {
      const res = await fetch('/api/build-id', {
        method: 'GET',
        cache: 'no-store',
        headers: { 'x-dialogy-build-check': '1' },
      });

      let serverBuildId = res.headers.get('x-build-id');
      if (!serverBuildId) {
        try {
          serverBuildId = (await res.clone().json())?.buildId;
        } catch {
          serverBuildId = null;
        }
      }
      if (!serverBuildId || serverBuildId === 'dev') return;

      if (!currentBuildIdRef.current) {
        // Establish baseline build ID for the current browser session without triggering a mismatch
        currentBuildIdRef.current = serverBuildId;
        try {
          sessionStorage.setItem(STORAGE_KEY, serverBuildId);
        } catch {
          /* ignore */
        }
        return;
      }

      if (serverBuildId !== currentBuildIdRef.current) {
        notifyUpdateAvailable('build-mismatch', serverBuildId);
        return;
      }
    } catch (err) {
      console.debug('[BUILD_WATCHER] Failed to check build id', err);
    }
  }, [notifyUpdateAvailable]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    channelRef.current = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current.onmessage = (event) => {
      const { data } = event;
      if (
        ['BUILD_RELOAD', 'BUILD_UPDATE', 'BUILD_UPDATE_AVAILABLE'].includes(data?.type)
        && data.buildId
        && currentBuildIdRef.current
        && data.buildId !== currentBuildIdRef.current
        && data.buildId !== 'dev'
      ) {
        notifyUpdateAvailable('peer-signal', data.buildId);
      }
    };

    return () => {
      channelRef.current?.close();
      channelRef.current = null;
    };
  }, [notifyUpdateAvailable]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    checkBuild();
    const interval = setInterval(checkBuild, CHECK_INTERVAL_MS);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void checkBuild();
      }
    };
    const onFocus = () => void checkBuild();

    window.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
    };
  }, [checkBuild]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      if (updateNotifiedRef.current) return response;

      const url = typeof args[0] === 'string' ? args[0] : ('url' in args[0] ? (args[0] as Request).url : args[0].toString());
      const headerBuildId = response.headers.get('x-build-id');
      if (headerBuildId && headerBuildId !== 'dev') {
        if (!currentBuildIdRef.current) {
          currentBuildIdRef.current = headerBuildId;
          try {
            sessionStorage.setItem(STORAGE_KEY, headerBuildId);
          } catch {}
        } else if (headerBuildId !== currentBuildIdRef.current) {
          notifyUpdateAvailable('header-mismatch', headerBuildId);
          return response;
        }
      }

      const isServerActionCall = typeof url === 'string' && url.includes('/_next/server-actions');
      if (isServerActionCall && response.status >= 500) {
        console.warn('[BUILD_WATCHER] Server action failed; skipping auto-reload', { url, status: response.status });
      }

      return response;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, [notifyUpdateAvailable]);

  return null;
}
