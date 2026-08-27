'use client';

import { useEffect } from 'react';

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      return;
    }

    const isProduction = process.env.NODE_ENV === 'production';
    const isDevelopmentPwaEnabled = ['1', 'true', 'yes', 'on'].includes(
      String(process.env.NEXT_PUBLIC_PWA_DEV || '').trim().toLowerCase(),
    );

    if (!isProduction && !isDevelopmentPwaEnabled) {
      void navigator.serviceWorker.getRegistrations().then((registrations) => {
        return Promise.all(
          registrations
            .filter((registration) => registration.scope.startsWith(window.location.origin))
            .map((registration) => registration.unregister()),
        );
      }).catch(() => undefined);
      return;
    }

    void navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registration) => registration.update())
      .catch(() => undefined);
  }, []);

  return null;
}
