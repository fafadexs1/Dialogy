'use client';

import React from 'react';
import { Loader2, User, Building, Shield, PlusCircle, MessageSquareQuote, CreditCard } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { SettingsProvider, useSettings } from './settings-context';
import { useI18n } from '@/i18n/i18n-provider';

const settingsNavItems = [
  { href: '/settings/profile', labelKey: 'Perfil', icon: User },
  { href: '/settings/workspace', labelKey: 'Workspace', icon: Building },
  { href: '/settings/billing', labelKey: 'Cobranca & Faturas', icon: CreditCard },
  { href: '/settings/shortcuts', labelKey: 'Atalhos', icon: MessageSquareQuote },
  { href: '/settings/security', labelKey: 'Seguranca', icon: Shield },
];

function SettingsLayoutContent({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const { user, loading } = useSettings();

  if (loading || !user) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-1 flex-col">
      <header className="flex flex-shrink-0 items-center justify-between border-b bg-background p-4 sm:p-6">
        <div>
          <h1 className="text-2xl font-bold">{t('Configuracoes')}</h1>
          <p className="text-muted-foreground">{t('Gerencie suas preferencias de perfil, workspace e conta.')}</p>
        </div>
        <Button asChild>
          <Link href="/settings/workspace/new">
            <PlusCircle className="mr-2 h-4 w-4" />
            {t('Criar novo workspace')}
          </Link>
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 bg-muted/40">
        <aside className="flex w-full max-w-xs flex-col border-r bg-background p-4">
          <nav className="flex flex-col gap-2">
            {settingsNavItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  pathname.startsWith(item.href)
                    ? 'bg-primary/10 text-primary'
                    : 'text-foreground hover:bg-accent'
                )}
              >
                <item.icon className="h-5 w-5" />
                <span>{t(item.labelKey)}</span>
              </Link>
            ))}
          </nav>
        </aside>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}

export function SettingsLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SettingsProvider>
      <SettingsLayoutContent>{children}</SettingsLayoutContent>
    </SettingsProvider>
  );
}
