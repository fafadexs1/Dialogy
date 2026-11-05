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
      <div className="flex h-full min-h-0 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden overscroll-none">
      <header className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-background p-4 sm:p-6">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">{t('Configuracoes')}</h1>
          <p className="mt-1 hidden text-sm text-muted-foreground sm:block">{t('Gerencie suas preferencias de perfil, workspace e conta.')}</p>
        </div>
        <Button asChild variant="outline" className="w-10 shrink-0 px-0 sm:w-auto sm:px-4">
          <Link href="/settings/workspace/new" aria-label={t('Criar novo workspace')} title={t('Criar novo workspace')}>
            <PlusCircle className="h-4 w-4" />
            <span className="hidden sm:inline">{t('Criar novo workspace')}</span>
          </Link>
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden overscroll-none bg-muted/20 lg:flex-row">
        <aside className="w-full shrink-0 overflow-x-auto border-b bg-background p-2 lg:w-52 lg:overflow-y-auto lg:border-b-0 lg:border-r lg:p-3">
          <nav aria-label={t('Configuracoes')} className="flex gap-1 lg:flex-col">
            {settingsNavItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  pathname.startsWith(item.href)
                    ? 'bg-primary/10 text-primary'
                    : 'text-foreground hover:bg-accent'
                )}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                <span>{t(item.labelKey)}</span>
              </Link>
            ))}
          </nav>
        </aside>
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6 xl:p-8">{children}</main>
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
