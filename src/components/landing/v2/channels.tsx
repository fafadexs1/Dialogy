'use client';

import * as React from 'react';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { ArrowRight, Code2, MessageCircle, Radio } from 'lucide-react';
import { SectionHeading, Mark, CtaSecondary } from './brand';
import { CHANNELS } from './channels-data';
import { cn } from '@/lib/utils';

export function Channels() {
    return (
        <section id="canais" className="relative border-y border-slate-100 bg-slate-50/60 py-20 sm:py-28">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                <SectionHeading
                    accent="blue"
                    eyebrow={
                        <>
                            <Radio className="h-3.5 w-3.5" />
                            Onde seus clientes já estão
                        </>
                    }
                    title={
                        <>
                            Um inbox. Todos os canais.{' '}
                            <Mark tone="blue">Zero abas abertas.</Mark>
                        </>
                    }
                    description="Sua equipe para de pular entre celular, Direct e e-mail. Tudo chega em uma fila só, com histórico completo do cliente — não importa por onde ele começou a conversa."
                />

                <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {CHANNELS.map((channel, index) => (
                        <motion.article
                            key={channel.id}
                            initial={{ opacity: 0, y: 16 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true, margin: '-60px' }}
                            transition={{ duration: 0.4, delay: Math.min(index, 5) * 0.05 }}
                            className={cn(
                                'group relative flex flex-col rounded-3xl border border-slate-200/80 bg-white p-6 transition-all duration-300',
                                'hover:-translate-y-1 hover:border-slate-300 hover:shadow-[0_24px_50px_-28px_rgba(15,23,42,0.35)]',
                                channel.tint,
                            )}
                        >
                            <div className="flex items-center gap-3">
                                <span
                                    className={cn(
                                        'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white shadow-sm transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6',
                                        channel.color,
                                    )}
                                >
                                    <channel.Icon className="h-6 w-6" />
                                </span>
                                <div>
                                    <h3 className="text-base font-extrabold text-slate-900">{channel.name}</h3>
                                    {channel.badge ? (
                                        <span className="mt-0.5 inline-block rounded-md bg-slate-900 px-1.5 py-0.5 text-[0.62rem] font-black uppercase tracking-wide text-white">
                                            {channel.badge}
                                        </span>
                                    ) : null}
                                </div>
                            </div>
                            <p className="mt-4 text-[0.92rem] leading-relaxed text-slate-600">{channel.tagline}</p>
                        </motion.article>
                    ))}

                    {/* Trailing card: everything else via API */}
                    <motion.div
                        initial={{ opacity: 0, y: 16 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true, margin: '-60px' }}
                        transition={{ duration: 0.4, delay: 0.3 }}
                        className="flex flex-col justify-between gap-5 rounded-3xl border-2 border-dashed border-slate-300 bg-white/50 p-6 lg:col-span-2 lg:flex-row lg:items-center"
                    >
                        <div>
                            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white">
                                <Code2 className="h-6 w-6" />
                            </span>
                            <h3 className="mt-3 text-base font-extrabold text-slate-900">O canal que você quiser</h3>
                            <p className="mt-2 text-[0.92rem] leading-relaxed text-slate-600">
                                API pública, webhooks e Developer Portal para plugar ERP, e-commerce ou qualquer
                                sistema interno na conversa.
                            </p>
                        </div>
                        <CtaSecondary href="/developer" className="shrink-0 self-start lg:self-center">
                            Ver documentação
                            <ArrowRight className="h-4 w-4" />
                        </CtaSecondary>
                    </motion.div>
                </div>

                {/* Routing diagram — dark band for contrast */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: '-80px' }}
                    transition={{ duration: 0.5 }}
                    className="relative mt-6 overflow-hidden rounded-[28px] bg-slate-950 p-6 sm:p-8"
                >
                    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
                        <div className="absolute left-1/2 top-0 h-64 w-[36rem] -translate-x-1/2 rounded-full bg-brand-green/20 blur-[100px]" />
                    </div>
                    <div className="relative">
                        <h3 className="text-center text-xl font-extrabold tracking-tight text-white sm:text-2xl">
                            Chega de qualquer lugar, cai em uma fila só,{' '}
                            <span className="text-brand-green">e o roteamento distribui.</span>
                        </h3>
                        <div className="mt-6 overflow-x-auto pb-2">
                            {/* The source graphic carries a cropped caption at the very top,
                                so the frame trims it and keeps the diagram itself. */}
                            <div
                                className="relative min-w-[720px] overflow-hidden rounded-2xl"
                                style={{ aspectRatio: '1052 / 352' }}
                            >
                                <Image
                                    src="/landing-flow-visual.webp"
                                    alt="Diagrama do fluxo da Dialogy: mensagens de WhatsApp, Instagram, e-mail, chat e telefone chegam em um inbox único e são distribuídas automaticamente entre os atendentes"
                                    fill
                                    sizes="(max-width: 768px) 900px, 1100px"
                                    className="object-cover object-bottom"
                                />
                            </div>
                        </div>
                    </div>
                </motion.div>

                {/* Site widget spotlight */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: '-80px' }}
                    transition={{ duration: 0.5 }}
                    className="mt-6 overflow-hidden rounded-[28px] border border-slate-200/80 bg-white"
                >
                    <div className="grid items-center gap-8 p-7 sm:p-10 lg:grid-cols-2">
                        <div className="min-w-0">
                            <span className="inline-flex items-center gap-2 rounded-full bg-violet-50 px-3.5 py-1.5 text-xs font-bold uppercase tracking-[0.14em] text-violet-600 ring-1 ring-violet-100">
                                <MessageCircle className="h-3.5 w-3.5" />
                                Chat no site do cliente
                            </span>
                            <h3 className="mt-5 text-2xl font-extrabold leading-tight tracking-tight text-slate-900 sm:text-3xl">
                                Coloque um atendente (ou uma IA) no seu site em{' '}
                                <Mark tone="violet">1 linha de código.</Mark>
                            </h3>
                            <p className="mt-4 text-[0.98rem] leading-relaxed text-slate-600">
                                O visitante conversa sem sair da página, a IA responde na hora e, se ele sumir, a
                                conversa continua no WhatsApp. O lead entra no mesmo inbox e no mesmo CRM.
                            </p>
                            <ul className="mt-6 space-y-2.5">
                                {[
                                    'Cores, avatar e mensagem de boas-vindas do seu jeito',
                                    'Funciona em qualquer site: WordPress, Shopify, Next.js, landing page',
                                    'Captura nome, e-mail e telefone antes de chamar o time',
                                ].map((item) => (
                                    <li key={item} className="flex items-start gap-2.5 text-[0.92rem] text-slate-700">
                                        <span className="mt-[0.35rem] h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500" />
                                        {item}
                                    </li>
                                ))}
                            </ul>
                        </div>

                        <div className="relative min-w-0">
                            <div
                                aria-hidden="true"
                                className="absolute -inset-6 rounded-[32px] bg-gradient-to-br from-violet-200/50 via-blue-100/40 to-brand-green/20 blur-2xl"
                            />
                            <div className="relative overflow-hidden rounded-2xl bg-slate-900 p-5 shadow-xl">
                                <div className="mb-4 flex items-center gap-1.5">
                                    <span className="h-2.5 w-2.5 rounded-full bg-rose-400/80" />
                                    <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
                                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
                                    <span className="ml-2 font-code text-[0.68rem] text-slate-500">index.html</span>
                                </div>
                                <pre className="overflow-x-auto font-code text-[0.72rem] leading-relaxed text-slate-300 sm:text-[0.78rem]">
                                    <code>
                                        <span className="text-slate-500">{'<!-- cole antes do </body> -->'}</span>
                                        {'\n'}
                                        <span className="text-violet-400">{'<script'}</span>{' '}
                                        <span className="text-blue-300">async</span>{'\n  '}
                                        <span className="text-blue-300">src</span>=
                                        <span className="text-brand-green">
                                            &quot;https://dialogy.klyraai.com.br/widget.js&quot;
                                        </span>
                                        {'\n  '}
                                        <span className="text-blue-300">data-widget-id</span>=
                                        <span className="text-brand-green">&quot;seu-workspace&quot;</span>
                                        <span className="text-violet-400">{'>'}</span>
                                        <span className="text-violet-400">{'</script>'}</span>
                                    </code>
                                </pre>
                                <div className="mt-4 flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2.5">
                                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-green text-slate-900">
                                        <MessageCircle className="h-3.5 w-3.5" />
                                    </span>
                                    <span className="text-[0.76rem] font-semibold text-white/80">
                                        Pronto. Seu site já atende 24 horas por dia.
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </motion.div>
            </div>
        </section>
    );
}
