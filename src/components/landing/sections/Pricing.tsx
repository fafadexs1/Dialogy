'use client';

import React, { useState } from 'react';
import { SectionWrapper, FadeIn } from '../ui/SectionWrapper';
import { GlassCard } from '../ui/GlassCard';
import { NeonButton } from '../ui/NeonButton';
import { Check } from 'lucide-react';

export function Pricing() {
    const plans = [
        {
            name: 'Basic',
            price: 'R$ 367',
            description: 'Para operações iniciais.',
            features: [
                { name: 'WhatsApp API Oficial', included: true },
                { name: '20.000 créditos inclusos', included: true },
                { name: 'Integrações básicas', included: true },
                { name: 'Chatbot de fluxograma', included: true },
                { name: 'Suporte autoatendimento', included: true }
            ],
            cta: 'Começar Agora',
            variant: 'secondary' as const
        },
        {
            name: 'Advanced',
            price: 'R$ 764',
            description: 'Para quem precisa de escala.',
            features: [
                { name: 'WhatsApp API Oficial', included: true },
                { name: '50.000 créditos inclusos', included: true },
                { name: 'Integrações avançadas', included: true },
                { name: 'Chatbot com IA', included: true },
                { name: 'Suporte via WhatsApp', included: true }
            ],
            cta: 'Começar Agora',
            popular: true,
            variant: 'primary' as const,
            glow: 'green' as const
        },
        {
            name: 'Enterprise',
            price: 'R$ 1.549',
            description: 'Para grandes corporações.',
            features: [
                { name: 'WhatsApp API Oficial', included: true },
                { name: '100.000 créditos inclusos', included: true },
                { name: 'Integrações personalizadas', included: true },
                { name: 'Suporte 24x7 dedicado', included: true },
                { name: 'Acesso antecipado a recursos', included: true }
            ],
            cta: 'Falar com Vendas',
            variant: 'outline' as const,
            glow: 'blue' as const
        }
    ];

    return (
        <SectionWrapper id="pricing" className="py-32">
            <div className="text-center mb-16 space-y-4">
                <FadeIn>
                    <h2 className="text-4xl md:text-5xl font-bold text-white">Planos simples para <span className="text-brand-green">escalar</span></h2>
                    <p className="text-gray-400 mt-4">Escolha o plano ideal para o seu momento.</p>
                </FadeIn>
            </div>

            <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
                {plans.map((plan, i) => (
                    <FadeIn key={plan.name} delay={i * 0.1} className="h-full">
                        <GlassCard
                            className={`h-full p-8 flex flex-col relative ${plan.popular ? 'border-brand-green/50 bg-brand-green/5' : 'bg-[#0B0B10]/40'}`}
                            hoverEffect={plan.popular}
                            intensity={plan.popular ? 'high' : 'low'}
                        >
                            {plan.popular && (
                                <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1 bg-brand-green text-black font-bold text-xs uppercase tracking-wider rounded-full shadow-lg shadow-brand-green/20">
                                    Mais Popular
                                </div>
                            )}

                            <div className="mb-8">
                                <h3 className="text-xl font-medium text-white mb-2">{plan.name}</h3>
                                <div className="flex items-baseline gap-1">
                                    <span className="text-4xl font-bold text-white">{plan.price}</span>
                                    <span className="text-gray-500 text-sm">/mês</span>
                                </div>
                                <p className="text-sm text-gray-400 mt-2">{plan.description}</p>
                            </div>

                            <ul className="space-y-4 mb-8 flex-1">
                                {plan.features.map((feat, index) => (
                                    <li key={index} className={`flex items-start gap-3 text-sm ${feat.included ? 'text-gray-300' : 'text-gray-600'}`}>
                                        <Check className="w-5 h-5 text-brand-green shrink-0" />
                                        {feat.name}
                                    </li>
                                ))}
                            </ul>

                            <a href="https://wa.me/5511999999999" target="_blank" rel="noopener noreferrer" className="w-full">
                                <NeonButton
                                    variant={plan.variant}
                                    glowColor={plan.glow || 'green'}
                                    className="w-full"
                                >
                                    {plan.cta}
                                </NeonButton>
                            </a>
                        </GlassCard>
                    </FadeIn>
                ))}
            </div>

            <div className="text-center mt-12 text-sm text-gray-500">
                * Custos de canais (Meta API) podem variar conforme volume.
            </div>
        </SectionWrapper>
    );
}
