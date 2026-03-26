'use client';

import React from 'react';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { SectionWrapper, FadeIn } from '../ui/SectionWrapper';

const plans = [
    {
        name: 'Essencial',
        price: 'R$ 249',
        description: 'Para organizar o atendimento com equipe ilimitada e volume previsivel.',
        features: [
            'Usuarios ilimitados',
            '500 chats/mes',
            '2 canais conectados',
            'Teste gratis de 7 dias',
            'Inbox unificado',
            'Etiquetas e notas internas',
        ],
        cta: 'Comecar',
        href: '/register',
    },
    {
        name: 'Profissional',
        price: 'R$ 499',
        description: 'Para times que precisam de controle, fila e volume maior por mes.',
        features: [
            'Usuarios ilimitados',
            '2.000 chats/mes',
            '5 canais conectados',
            'Filas e equipes',
            'SLA e distribuicao',
            'Templates e relatorios',
        ],
        cta: 'Ver planos',
        href: '/pricing',
        popular: true,
    },
    {
        name: 'Operacao',
        price: 'R$ 999',
        description: 'Para escalar com automacoes, permissoes e mais volume de conversas.',
        features: [
            'Usuarios ilimitados',
            '7.500 chats/mes',
            '12 canais conectados',
            'Automacoes avancadas',
            'API e webhooks',
            'Onboarding assistido',
        ],
        cta: 'Falar com vendas',
        href: 'https://wa.me/551151994714',
        external: true,
    },
    {
        name: 'Enterprise',
        price: 'Sob consulta',
        description: 'Projeto comercial para operacoes maiores, multiunidade ou BPO.',
        features: [
            'Usuarios ilimitados',
            'Volume sob medida',
            'Implantacao assistida',
            'Suporte prioritario',
            'Regras comerciais proprias',
            'Integracoes customizadas',
        ],
        cta: 'Falar com vendas',
        href: 'https://wa.me/551151994714',
        external: true,
    },
];

export function Pricing() {
    return (
        <SectionWrapper id="pricing" className="py-24">
            <div className="mb-12 space-y-4 text-center">
                <FadeIn>
                    <h2 className="text-4xl font-semibold tracking-tight text-slate-950 md:text-5xl">
                        Precos claros para vender sem travar a decisao.
                    </h2>
                    <p className="mx-auto mt-4 max-w-2xl text-lg leading-8 text-slate-600">
                        A Dialogy entra com usuarios ilimitados, limite por chats e teste gratis de 7 dias para acelerar a decisao.
                    </p>
                </FadeIn>
            </div>

            <div className="mx-auto grid max-w-7xl gap-8 md:grid-cols-2 xl:grid-cols-4">
                {plans.map((plan, i) => (
                    <FadeIn key={plan.name} delay={i * 0.08} className="h-full">
                        <div className={`relative flex h-full flex-col rounded-[32px] border p-8 shadow-[0_22px_70px_-48px_rgba(15,23,42,0.55)] ${plan.popular ? 'border-emerald-300 bg-emerald-50/70' : 'border-black/10 bg-white'}`}>
                            {plan.popular && (
                                <div className="absolute -top-4 left-1/2 -translate-x-1/2 rounded-full bg-slate-950 px-4 py-1 text-xs font-bold uppercase tracking-wider text-white shadow-lg">
                                    Mais escolhido
                                </div>
                            )}

                            <div className="mb-8">
                                <h3 className="mb-2 text-xl font-semibold text-slate-950">{plan.name}</h3>
                                <div className="flex items-baseline gap-1">
                                    <span className="text-4xl font-semibold text-slate-950">{plan.price}</span>
                                    {plan.price !== 'Sob consulta' && <span className="text-sm text-slate-500">/mes</span>}
                                </div>
                                <p className="mt-2 text-sm leading-6 text-slate-600">{plan.description}</p>
                            </div>

                            <ul className="mb-8 flex-1 space-y-4">
                                {plan.features.map((feature) => (
                                    <li key={feature} className="flex items-start gap-3 text-sm text-slate-700">
                                        <Check className="h-5 w-5 shrink-0 text-brand-green" />
                                        {feature}
                                    </li>
                                ))}
                            </ul>

                            {plan.external ? (
                                <a
                                    href={plan.href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={`inline-flex w-full items-center justify-center rounded-full px-5 py-3 text-sm font-semibold transition-all ${plan.popular ? 'bg-slate-950 text-white hover:bg-slate-800' : 'border border-black/10 bg-white text-slate-950 hover:bg-slate-50'}`}
                                >
                                    {plan.cta}
                                </a>
                            ) : (
                                <Link
                                    href={plan.href}
                                    className={`inline-flex w-full items-center justify-center rounded-full px-5 py-3 text-sm font-semibold transition-all ${plan.popular ? 'bg-slate-950 text-white hover:bg-slate-800' : 'border border-black/10 bg-white text-slate-950 hover:bg-slate-50'}`}
                                >
                                    {plan.cta}
                                </Link>
                            )}
                        </div>
                    </FadeIn>
                ))}
            </div>

            <div className="mt-10 text-center text-sm text-slate-500">
                Pacote extra de 500 chats por R$ 99/mes, canal extra por R$ 39/mes e IA Copilot por R$ 149 por workspace. Custos oficiais de WhatsApp seguem separados.
            </div>
        </SectionWrapper>
    );
}
