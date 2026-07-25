'use client';

import * as React from 'react';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { Check, Globe, Sparkles, Star } from 'lucide-react';
import { FaWhatsapp, FaInstagram, FaFacebookMessenger, FaTelegram } from 'react-icons/fa6';
import { ScrollUnfold, Parallax } from './effects';
import { cn } from '@/lib/utils';

const ORBIT = [
    {
        Icon: FaWhatsapp,
        tile: 'bg-[#25D366]',
        position: '-left-8 top-24',
        speed: 0.1,
        delay: 0.5,
    },
    {
        Icon: FaInstagram,
        tile: 'bg-gradient-to-br from-[#F58529] via-[#DD2A7B] to-[#8134AF]',
        position: '-left-14 top-1/2',
        speed: 0.16,
        delay: 0.62,
    },
    {
        Icon: FaFacebookMessenger,
        tile: 'bg-gradient-to-br from-[#00B2FF] to-[#006AFF]',
        position: '-right-10 top-28',
        speed: 0.14,
        delay: 0.74,
    },
    {
        Icon: FaTelegram,
        tile: 'bg-gradient-to-br from-[#37AEE2] to-[#1E96C8]',
        position: '-right-14 bottom-40',
        speed: 0.09,
        delay: 0.86,
    },
    {
        Icon: Globe,
        tile: 'bg-gradient-to-br from-violet-500 to-indigo-600',
        position: '-left-12 bottom-24',
        speed: 0.12,
        delay: 0.98,
    },
];

export function HeroVisual() {
    return (
        <div className="relative mx-auto max-w-5xl">
            {/* Layered glow behind the product shot */}
            <div aria-hidden="true" className="pointer-events-none absolute -inset-x-10 -bottom-10 -top-6">
                <div className="absolute inset-0 rounded-[52px] bg-gradient-to-r from-brand-green/35 via-violet-300/40 to-blue-300/35 opacity-70 blur-[70px]" />
                <div className="absolute inset-x-16 bottom-0 h-24 rounded-full bg-slate-900/10 blur-3xl" />
            </div>

            <ScrollUnfold className="relative">
                <div className="overflow-hidden rounded-[20px] border border-slate-200/90 bg-white shadow-[0_60px_140px_-50px_rgba(15,23,42,0.55)] sm:rounded-[26px]">
                    {/* Browser chrome */}
                    <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/90 px-4 py-3">
                        <div className="flex items-center gap-1.5">
                            <span className="h-3 w-3 rounded-full bg-rose-400" />
                            <span className="h-3 w-3 rounded-full bg-amber-400" />
                            <span className="h-3 w-3 rounded-full bg-emerald-400" />
                        </div>
                        <div className="mx-auto hidden rounded-lg bg-white px-4 py-1.5 text-xs font-semibold text-slate-400 ring-1 ring-slate-200 sm:block">
                            app.dialogy.com.br/inbox
                        </div>
                        <div className="ml-auto flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[0.68rem] font-black uppercase tracking-wide text-emerald-600 ring-1 ring-emerald-100">
                            <span className="relative flex h-1.5 w-1.5">
                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400" />
                                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            </span>
                            Ao vivo
                        </div>
                    </div>

                    <Image
                        src="/dialogy-inbox-landing.png"
                        alt="Inbox unificado da Dialogy com conversas de WhatsApp, Instagram e chat do site em uma única tela"
                        width={1440}
                        height={900}
                        priority
                        sizes="(max-width: 1024px) 100vw, 1024px"
                        className="w-full"
                    />
                </div>
            </ScrollUnfold>

            {/* Floating channel bubbles */}
            {ORBIT.map((item, index) => (
                <Parallax
                    key={index}
                    speed={item.speed}
                    className={cn('absolute z-20 hidden xl:block', item.position)}
                >
                    <motion.span
                        initial={{ opacity: 0, scale: 0.6 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.45, delay: item.delay, type: 'spring', stiffness: 180 }}
                        className={cn(
                            'flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-[0_18px_40px_-14px_rgba(15,23,42,0.5)] ring-4 ring-white/70',
                            item.tile,
                        )}
                    >
                        <item.Icon className="h-7 w-7" />
                    </motion.span>
                </Parallax>
            ))}

            {/* AI hand-off card floating over the product shot */}
            <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.55, delay: 0.8 }}
                className="absolute -bottom-6 left-2 z-20 hidden w-[19rem] rounded-2xl border border-slate-100 bg-white/95 p-4 shadow-[0_28px_70px_-24px_rgba(15,23,42,0.45)] backdrop-blur lg:block xl:-left-10"
            >
                <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-green text-slate-900">
                        <Sparkles className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                        <p className="text-[0.8rem] font-extrabold leading-tight text-slate-900">
                            Lead qualificado pela IA
                        </p>
                        <p className="text-[0.68rem] font-semibold text-slate-400">há 3 segundos · Instagram</p>
                    </div>
                </div>
                <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2.5 text-[0.76rem] leading-relaxed text-slate-600">
                    Segmento <strong className="font-bold text-slate-900">Saúde</strong>, 6 atendentes, quer
                    começar esta semana.
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[0.64rem] font-bold text-emerald-700 ring-1 ring-emerald-100">
                        <Star className="h-2.5 w-2.5" /> Score 92
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-1.5 py-0.5 text-[0.64rem] font-bold text-blue-700 ring-1 ring-blue-100">
                        <Check className="h-2.5 w-2.5" strokeWidth={3} /> Fila Comercial
                    </span>
                </div>
            </motion.div>

            {/* Response-time chip on the opposite corner */}
            <motion.div
                initial={{ opacity: 0, y: -14, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.5, delay: 0.95 }}
                className="absolute -top-5 right-4 z-20 hidden items-center gap-2.5 rounded-2xl border border-slate-100 bg-white/95 px-4 py-2.5 shadow-[0_22px_55px_-22px_rgba(15,23,42,0.45)] backdrop-blur lg:flex xl:-right-8"
            >
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-brand-green">
                    <Sparkles className="h-4 w-4" />
                </span>
                <span>
                    <span className="block text-[0.66rem] font-black uppercase tracking-wide text-slate-400">
                        Primeira resposta
                    </span>
                    <span className="block text-sm font-extrabold text-slate-900">em 4 segundos</span>
                </span>
            </motion.div>
        </div>
    );
}
