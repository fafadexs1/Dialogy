'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import { Rocket, PlugZap, GraduationCap, LineChart } from 'lucide-react';
import { SectionHeading, Mark } from './brand';
import { cn } from '@/lib/utils';

const STEPS = [
    {
        icon: PlugZap,
        time: '5 minutos',
        title: 'Conecte seus canais',
        copy: 'Leia o QR Code do WhatsApp (ou ative a API Oficial), autorize o Instagram e o Messenger e cole o widget no seu site. Sem instalar nada no computador da equipe.',
        ring: 'ring-blue-200',
        chip: 'bg-blue-50 text-blue-700',
        bar: 'bg-blue-500',
    },
    {
        icon: GraduationCap,
        time: 'No mesmo dia',
        title: 'Ensine a IA e monte o fluxo',
        copy: 'Suba catálogo, preços e regras de atendimento. Desenhe o caminho da conversa arrastando blocos: menu, horário, coleta de dados, transferência.',
        ring: 'ring-violet-200',
        chip: 'bg-violet-50 text-violet-700',
        bar: 'bg-violet-500',
    },
    {
        icon: LineChart,
        time: 'Todo dia, sozinho',
        title: 'Deixe rodar e acompanhe',
        copy: 'A IA atende 24h, o time humano entra quando o assunto pede e você acompanha volume, SLA e desempenho de cada canal no relatório.',
        ring: 'ring-emerald-200',
        chip: 'bg-emerald-50 text-emerald-700',
        bar: 'bg-emerald-500',
    },
];

export function HowItWorks() {
    return (
        <section className="relative overflow-hidden border-y border-slate-100 bg-slate-50/60 py-20 sm:py-28">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                <SectionHeading
                    accent="amber"
                    eyebrow={
                        <>
                            <Rocket className="h-3.5 w-3.5" />
                            Como começa
                        </>
                    }
                    title={
                        <>
                            Do zero ao primeiro atendimento automático{' '}
                            <Mark tone="amber">hoje mesmo.</Mark>
                        </>
                    }
                    description="Nada de projeto de três meses. Você configura, testa e já coloca no ar — e ajusta com a operação rodando."
                />

                <div className="relative mt-14 grid gap-5 lg:grid-cols-3">
                    {STEPS.map((step, index) => (
                        <motion.div
                            key={step.title}
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true, margin: '-60px' }}
                            transition={{ duration: 0.45, delay: index * 0.1 }}
                            className={cn(
                                'relative flex flex-col rounded-[28px] bg-white p-7 ring-1 transition-shadow duration-300 hover:shadow-[0_28px_60px_-32px_rgba(15,23,42,0.3)]',
                                step.ring,
                            )}
                        >
                            <span className={cn('absolute left-7 right-7 top-0 h-1 rounded-b-full', step.bar)} />
                            <div className="flex items-center justify-between">
                                <span className="text-5xl font-black leading-none text-slate-100">
                                    0{index + 1}
                                </span>
                                <span
                                    className={cn(
                                        'rounded-full px-2.5 py-1 text-[0.68rem] font-black uppercase tracking-wide',
                                        step.chip,
                                    )}
                                >
                                    {step.time}
                                </span>
                            </div>
                            <span
                                className={cn(
                                    'mt-5 flex h-12 w-12 items-center justify-center rounded-2xl text-white',
                                    step.bar,
                                )}
                            >
                                <step.icon className="h-6 w-6" />
                            </span>
                            <h3 className="mt-4 text-xl font-extrabold tracking-tight text-slate-900">
                                {step.title}
                            </h3>
                            <p className="mt-2.5 text-[0.94rem] leading-relaxed text-slate-600">{step.copy}</p>
                        </motion.div>
                    ))}
                </div>
            </div>
        </section>
    );
}
