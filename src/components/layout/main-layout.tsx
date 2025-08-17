
'use client';

import React from 'react';
import type { User } from '@/lib/types';
import { Sidebar } from './sidebar';
import { PageTransition } from './page-transition';
import { usePathname } from 'next/navigation';

interface MainLayoutProps {
  user?: User;
  children: React.ReactNode;
}

export function MainLayout({ user, children }: MainLayoutProps) {
  const pathname = usePathname();
  // Se perder estado ao trocar apenas query/hash, comente a linha abaixo
  // ou use só o path “nu” sem query:
  const transitionKey = pathname.split('?')[0];

  return (
    // h-dvh melhora no mobile; grid define colunas estáveis
    <div className="grid h-dvh w-full grid-cols-[auto,1fr] bg-background">
      {/* Reserve um espaço fixo pro sidebar para evitar “pulos” */}
      <aside className="w-auto shrink-0 border-r">
        {user ? <Sidebar user={user} /> : null}
      </aside>

      {/* Coluna principal */}
      <main className="flex min-h-0 flex-col">
        {/* Se tiver header aqui, deixe-o fora da área rolável */}
        {/* Área rolável: min-h-0 no pai + overflow-auto aqui */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <PageTransition key={transitionKey}>{children}</PageTransition>
        </div>
      </main>
    </div>
  );
}
