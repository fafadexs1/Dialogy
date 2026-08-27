'use client';

import { useEffect, useState } from 'react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

export function PwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !('MSStream' in window);

    setIsStandalone(standalone);
    setIsIos(ios);

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setIsStandalone(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  if (isStandalone || dismissed) {
    return null;
  }

  if (deferredPrompt) {
    return (
      <aside className="fixed bottom-4 right-4 z-[100] flex max-w-sm items-center gap-3 rounded-xl border border-primary/20 bg-background/95 p-4 shadow-2xl backdrop-blur">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Instale o Dialogy</p>
          <p className="mt-1 text-xs text-muted-foreground">Acesse o atendimento como um aplicativo.</p>
        </div>
        <button
          type="button"
          className="shrink-0 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition hover:opacity-90"
          onClick={async () => {
            const prompt = deferredPrompt;
            setDeferredPrompt(null);
            await prompt.prompt();
            await prompt.userChoice;
          }}
        >
          Instalar
        </button>
        <button
          type="button"
          aria-label="Fechar aviso de instalação"
          className="shrink-0 text-muted-foreground transition hover:text-foreground"
          onClick={() => setDismissed(true)}
        >
          ×
        </button>
      </aside>
    );
  }

  if (isIos) {
    return (
      <aside className="fixed bottom-4 left-4 right-4 z-[100] rounded-xl border border-primary/20 bg-background/95 p-4 text-sm shadow-2xl backdrop-blur md:left-auto md:max-w-sm">
        <button
          type="button"
          aria-label="Fechar instruções de instalação"
          className="float-right text-muted-foreground transition hover:text-foreground"
          onClick={() => setDismissed(true)}
        >
          ×
        </button>
        <p className="font-semibold">Instale o Dialogy</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Toque em Compartilhar e depois em “Adicionar à Tela de Início”.
        </p>
      </aside>
    );
  }

  return null;
}
