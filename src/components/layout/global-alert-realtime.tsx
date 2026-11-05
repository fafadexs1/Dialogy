'use client';

import { useEffect, useState } from 'react';
import { getGlobalAlertAction } from '@/actions/system-alerts';
import { GlobalAlertBanner } from '@/components/layout/global-alert-banner';
import { useAuth } from '@/providers/auth-provider';
import { createClient } from '@/lib/supabase/client';
import {
  GLOBAL_ALERT_BROWSER_CHANNEL,
  GLOBAL_ALERT_BROWSER_STORAGE_KEY,
  GLOBAL_ALERT_REALTIME_CHANNEL_OPTIONS,
  GLOBAL_ALERT_REALTIME_EVENT,
  GLOBAL_ALERT_REALTIME_TOPIC,
  GlobalAlertSchema,
  type GlobalAlertConfig,
} from '@/lib/system-alerts';

export function GlobalAlertRealtime({ initialAlert }: { initialAlert: GlobalAlertConfig }) {
  const [alert, setAlert] = useState(initialAlert);
  const { session, isLoading } = useAuth();
  const accessToken = session?.access_token ?? null;

  useEffect(() => {
    setAlert(initialAlert);
  }, [initialAlert]);

  useEffect(() => {
    const applyAlert = (candidate: unknown) => {
      const parsed = GlobalAlertSchema.safeParse((candidate as { alert?: unknown })?.alert);
      if (parsed.success) {
        setAlert(parsed.data);
      }
    };

    let channel: BroadcastChannel | null = null;

    if ('BroadcastChannel' in window) {
      channel = new BroadcastChannel(GLOBAL_ALERT_BROWSER_CHANNEL);
      channel.onmessage = (event) => applyAlert(event.data);
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== GLOBAL_ALERT_BROWSER_STORAGE_KEY || !event.newValue) return;
      try {
        applyAlert(JSON.parse(event.newValue));
      } catch (error) {
        console.warn('[GLOBAL_ALERT] Failed to parse browser alert update:', error);
      }
    };

    window.addEventListener('storage', handleStorage);

    return () => {
      channel?.close();
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  useEffect(() => {
    if (isLoading || !accessToken) return;

    const supabase = createClient();
    let mounted = true;

    supabase.realtime.setAuth(accessToken);

    void getGlobalAlertAction()
      .then((latestAlert) => {
        if (mounted) {
          setAlert(latestAlert);
        }
      })
      .catch((error) => {
        console.error('[GLOBAL_ALERT] Failed to refresh alert config:', error);
      });

    const channel = supabase
      .channel(GLOBAL_ALERT_REALTIME_TOPIC, GLOBAL_ALERT_REALTIME_CHANNEL_OPTIONS)
      .on('broadcast', { event: GLOBAL_ALERT_REALTIME_EVENT }, (payload) => {
        const parsed = GlobalAlertSchema.safeParse((payload.payload as { alert?: unknown })?.alert);
        if (parsed.success) {
          setAlert(parsed.data);
        }
      })
      .subscribe((status, error) => {
        if (error) {
          console.error('[GLOBAL_ALERT] Realtime subscription error:', error);
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          void getGlobalAlertAction().then((latestAlert) => {
            if (mounted) {
              setAlert(latestAlert);
            }
          });
        }
      });

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [accessToken, isLoading]);

  return <GlobalAlertBanner alert={alert} />;
}
