"use client";

import * as React from 'react';
import { FloatingIconsHero } from '@/components/floating-icons-hero-section';
import demoIcons from '../../../../public/floating-icons.json';

export const NewHero = () => {
  return (
    <FloatingIconsHero
      title={
        <div className="flex flex-col items-center">
            <div className="mb-8 inline-flex items-center gap-2.5 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-white/80 shadow-sm transition-colors cursor-default md:mb-10 md:hover:border-white/20 mx-auto text-base font-normal">
                <span className="relative flex h-2.5 w-2.5 items-center justify-center">
                    <span className="absolute hidden h-full w-full animate-ping rounded-full bg-brand-green opacity-75 md:inline-flex" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand-green" />
                </span>
                <span className="text-sm font-semibold tracking-tight">Evolução do Customer Engagement</span>
            </div>
            <span>Orquestre suporte e <br className="hidden md:block" />
            vendas em <span className="bg-gradient-to-r from-brand-green to-emerald-400 bg-clip-text text-transparent">alta escala</span>.</span>
        </div>
      }
      subtitle="Centralize WhatsApp, Instagram e Messenger. Qualifique milhares de leads com IA de forma invisível, deixando sua equipe focar apenas no fechamento."
      ctaText="Começar agora gratuitamente"
      ctaHref="/register"
      icons={demoIcons}
    />
  );
}
