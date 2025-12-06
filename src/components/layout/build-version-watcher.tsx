'use client';

import React, { useCallback, useEffect, useRef } from 'react';

const CHANNEL_NAME = 'dialogy-build-sync';
const STORAGE_KEY = 'dialogy-build-id';
const CHECK_INTERVAL_MS = 30000;

function getCurrentBuildId(): string {
  if (typeof window === 'undefined') return 'dev';
  const buildId = (window as any).__NEXT_DATA__?.buildId;
  return typeof buildId === 'string' ? buildId : 'dev';
}

export function BuildVersionWatcher() {
  const currentBuildIdRef = useRef<string>(getCurrentBuildId());
  const reloadTriggeredRef = useRef(false);
  const channelRef = useRef<BroadcastChannel | null>(null);

  const triggerReload = useCallback((reason: string, serverBuildId?: string) => {
    if (reloadTriggeredRef.current) return;
    reloadTriggeredRef.current = true;
    try {
      if (serverBuildId) {
        localStorage.setItem(STORAGE_KEY, serverBuildId);
      }
    } catch {
      /* ignore storage failures */
    }
    if (channelRef.current) {
      channelRef.current.postMessage({ type: 'BUILD_RELOAD', buildId: serverBuildId, reason });
    }
    window.location.reload();
  }, []);

  const checkBuild = useCallback(async () => {
    if (reloadTriggeredRef.current) return;
    try {
      const res = await fetch('/api/build-id', {
        method: 'GET',
        cache: 'no-store',
        headers: { 'x-dialogy-build-check': '1' },
      });

      const serverBuildId = res.headers.get('x-build-id') || (await res.clone().json()).buildId;
      if (!serverBuildId) return;

      if (serverBuildId !== currentBuildIdRef.current) {
        triggerReload('build-mismatch', serverBuildId);
        return;
      }

      currentBuildIdRef.current = serverBuildId;
      localStorage.setItem(STORAGE_KEY, serverBuildId);
    } catch (err) {
      console.debug('[BUILD_WATCHER] Failed to check build id', err);
    }
  }, [triggerReload]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    channelRef.current = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current.onmessage = (event) => {
      const { data } = event;
      if (data?.type === 'BUILD_RELOAD' && data.buildId !== currentBuildIdRef.current) {
        triggerReload('peer-signal', data.buildId);
      }
      if (data?.type === 'BUILD_UPDATE' && data.buildId && data.buildId !== currentBuildIdRef.current) {
        triggerReload('peer-update', data.buildId);
      }
    };

    return () => {
      channelRef.current?.close();
      channelRef.current = null;
    };
  }, [triggerReload]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && stored !== currentBuildIdRef.current) {
        triggerReload('stored-mismatch', stored);
        return;
      }
    } catch {
      /* ignore storage failures */
    }

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
  }, [checkBuild, triggerReload]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      if (reloadTriggeredRef.current) return response;

      const url = typeof args[0] === 'string' ? args[0] : ('url' in args[0] ? (args[0] as Request).url : args[0].toString());
      const headerBuildId = response.headers.get('x-build-id');
      if (headerBuildId && headerBuildId !== currentBuildIdRef.current) {
        triggerReload('header-mismatch', headerBuildId);
        return response;
      }

      const isServerActionCall = typeof url === 'string' && url.includes('/_next/server-actions');
      if (isServerActionCall && (response.status === 404 || response.status === 410 || response.status === 500)) {
        triggerReload('server-action-invalid');
      }

      return response;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, [triggerReload]);

  return null;
}
