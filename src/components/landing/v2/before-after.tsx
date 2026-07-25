'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Check, Scale, X } from 'lucide-react';
import { SectionHeading, Mark, CtaPrimary } from './brand';

const BEFORE = [
    'Mensagem que chega às 22h só é vista no dia seguinte',
    'Três pessoas revezando o mesmo celular da empresa',
    'Direct do Instagram que ninguém lembrou de abrir',
    '“Quem tá falando com esse cliente aqui?”',
    'Follow-up numa planilha que ninguém atualiza',
    'Nenhuma ideia de quanto o atendimento realmente vende',
];

const AFTER = [
    'Resposta em segundos, 24 horas por dia, todo dia',
    'Cada atendente com seu login, seu histórico e sua meta',
    'Todo canal caindo na mesma fila, com contexto do cliente',
    'Dono da conversa definido automaticamente pela fila',
    'Lembrete e reativação disparados sozinhos, na hora certa',
    'Relatório por canal, por atendente e por etapa do funil',
];

export function BeforeAfter() {
    return (
        <section className="relative overflow-hidden bg-white py-20 sm:py-28">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                <SectionHeading
                    accent="rose"
                    eyebrow={
                        <>
                            <Scale className="h-3.5 w-3.5" />
                            O antes e o depois
                        </>
                    }
                    title={
                        <>
                            Seu atendimento hoje custa caro —{' '}
                            <Mark tone="rose">só que na conta errada.</Mark>
                        </>
                    }
                    description="Cada mensagem sem resposta é um cliente que foi falar com o concorrente. A diferença raramente é preço: é quem respondeu primeiro."
                />

                <div className="mt-14 grid items-stretch gap-5 lg:grid-cols-[1fr_auto_1fr]">
                    <motion.div
                        initial={{ opacity: 0, x: -20 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true, margin: '-60px' }}
                        transition={{ duration: 0.5 }}
                        className="rounded-[28px] border border-rose-100 bg-rose-50/50 p-7 sm:p-8"
                    >
                        <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-black uppercase tracking-[0.14em] text-rose-500 ring-1 ring-rose-100">
                            Sem a Dialogy
                        </span>
                        <ul className="mt-6 space-y-3.5">
                            {BEFORE.map((item) => (
                                <li key={item} className="flex items-start gap-3">
                                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-500">
                                        <X className="h-3 w-3" strokeWidth={3.5} />
                                    </span>
                                    <span className="text-[0.94rem] leading-relaxed text-slate-600">{item}</span>
                                </li>
                            ))}
                        </ul>
                    </motion.div>

                    <div className="flex items-center justify-center self-center py-2 lg:py-0">
                        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-lg">
                            <ArrowRight className="h-6 w-6 rotate-90 lg:rotate-0" />
                        </span>
                    </div>

                    <motion.div
                        initial={{ opacity: 0, x: 20 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true, margin: '-60px' }}
                        transition={{ duration: 0.5 }}
                        className="relative overflow-hidden rounded-[28px] border border-emerald-100 bg-gradient-to-br from-emerald-50/80 to-brand-green/10 p-7 sm:p-8"
                    >
                        <div
                            aria-hidden="true"
                            className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-brand-green/25 blur-3xl"
                        />
                        <span className="relative inline-flex items-center gap-2 rounded-full bg-brand-green px-3 py-1.5 text-xs font-black uppercase tracking-[0.14em] text-slate-900">
                            Com a Dialogy
                        </span>
                        <ul className="relative mt-6 space-y-3.5">
                            {AFTER.map((item) => (
                                <li key={item} className="flex items-start gap-3">
                                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                                        <Check className="h-3 w-3" strokeWidth={3.5} />
                                    </span>
                                    <span className="text-[0.94rem] font-medium leading-relaxed text-slate-700">
                                        {item}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </motion.div>
                </div>

                <div className="mt-10 flex justify-center">
                    <CtaPrimary href="/register" size="lg">
                        Quero parar de perder cliente
                        <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
                    </CtaPrimary>
                </div>
            </div>
        </section>
    );
}
