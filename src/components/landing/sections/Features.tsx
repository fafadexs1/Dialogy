'use client';

import React from 'react';
import { SectionWrapper, FadeIn } from '../ui/SectionWrapper';
import { GlassCard } from '../ui/GlassCard';
import { LayoutDashboard, Users, Clock, ShieldCheck } from 'lucide-react';

export function Features() {
    const features = [
        {
            title: "Tudo numa tela só",
            description: "Adeus, abas infinitas. Gerencie conversas, dados do cliente e histórico de pedidos sem sair do chat.",
            icon: <LayoutDashboard className="w-6 h-6 text-brand-green" />,
            image: "/dashboard-mock.png" // Placeholder
        },
        {
            title: "Controle & SLA",
            description: "Defina tempos de resposta, escale chamados atrasados e monitore a performance da equipe em tempo real.",
            icon: <Clock className="w-6 h-6 text-brand-blue" />,
            image: "/sla-mock.png"
        }
    ];

    return (
        <SectionWrapper id="features">
            <div className="space-y-32">
                {features.map((feature, i) => (
                    <div key={i} className={`flex flex-col md:flex-row items-center gap-12 ${i % 2 === 1 ? 'md:flex-row-reverse' : ''}`}>

                        {/* Text Side */}
                        <div className="flex-1 space-y-6">
                            <FadeIn delay={0.1}>
                                <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center mb-6">
                                    {feature.icon}
                                </div>
                                <h3 className="text-3xl md:text-4xl font-bold text-white">{feature.title}</h3>
                                <p className="text-lg text-gray-400 leading-relaxed">
                                    {feature.description}
                                </p>
                            </FadeIn>

                            <FadeIn delay={0.2} className="pt-4">
                                <ul className="space-y-3 text-gray-300">
                                    {['Métricas detalhadas', 'Visualização Kanban', 'Filtros avançados'].map(item => (
                                        <li key={item} className="flex items-center gap-2">
                                            <div className="w-1.5 h-1.5 rounded-full bg-brand-green" />
                                            {item}
                                        </li>
                                    ))}
                                </ul>
                            </FadeIn>
                        </div>

                        {/* Visual Side */}
                        <div className="flex-1 w-full">
                            <FadeIn delay={0.3} direction={i % 2 === 0 ? 'left' : 'right'}>
                                <GlassCard className="aspect-video w-full flex items-center justify-center bg-[#050507] overflow-hidden relative group">
                                    <div className="absolute inset-0 bg-gradient-to-tr from-white/5 to-transparent opacity-50" />

                                    {/* Abstract UI representation since we don't have images yet */}
                                    <div className="relative w-3/4 h-3/4 bg-[#0A0A0E] rounded-lg border border-white/5 shadow-2xl p-4 flex flex-col gap-3 group-hover:scale-105 transition-transform duration-500">
                                        <div className="h-4 w-1/3 bg-white/10 rounded" />
                                        <div className="h-2 w-full bg-white/5 rounded" />
                                        <div className="h-2 w-2/3 bg-white/5 rounded" />

                                        <div className="mt-auto flex gap-2">
                                            <div className="h-8 w-8 rounded-full bg-white/10" />
                                            <div className="flex-1 space-y-1">
                                                <div className="h-2 w-1/2 bg-white/10 rounded" />
                                                <div className="h-2 w-1/4 bg-white/5 rounded" />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Decorative elements */}
                                    <div className="absolute -top-10 -right-10 w-40 h-40 bg-brand-green/20 blur-[50px] rounded-full" />
                                    <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-brand-blue/20 blur-[50px] rounded-full" />
                                </GlassCard>
                            </FadeIn>
                        </div>
                    </div>
                ))}
            </div>
        </SectionWrapper>
    );
}
