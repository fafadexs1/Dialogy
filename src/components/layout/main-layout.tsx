'use client';

import React from 'react';

interface MainLayoutProps {
  children: React.ReactNode;
}

/**
 * Este componente agora é um invólucro simples para o conteúdo da página.
 * A lógica da sidebar e da estrutura principal foi movida para MainAppLayout
 * para garantir que a sidebar seja persistente durante as transições de página.
 */
export function MainLayout({ children }: MainLayoutProps) {
  return <div className="h-full w-full">{children}</div>;
}
