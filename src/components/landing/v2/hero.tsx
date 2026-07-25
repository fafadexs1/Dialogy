'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Check, Globe, Sparkles, Zap } from 'lucide-react';
import { FaWhatsapp, FaInstagram, FaFacebookMessenger, FaTelegram } from 'react-icons/fa6';
import { CtaPrimary, CtaSecondary, Mark } from './brand';
import { HeroVisual } from './hero-visual';
import { HeroInbox } from './hero-inbox';
import { RotatingWord } from './effects';

const TRUST = ['7 dias grátis', 'Usuários ilimitados', 'Sem fidelidade', 'Suporte em português'];

const ROTATING_CHANNELS = [
    { label: 'no WhatsApp', Icon: FaWhatsapp, className: 'bg-[#25D366]' },
    {
        label: 'no Instagram',
        Icon: FaInstagram,
        className: 'bg-gradient-to-br from-[#F58529] via-[#DD2A7B] to-[#8134AF]',
    },
    { label: 'no Messenger', Icon: FaFacebookMessenger, className: 'bg-gradient-to-br from-[#00B2FF] to-[#006AFF]' },
    { label: 'no Telegram', Icon: FaTelegram, className: 'bg-gradient-to-br from-[#37AEE2] to-[#1E96C8]' },
    { label: 'no seu site', Icon: Globe, className: 'bg-gradient-to-br from-violet-500 to-indigo-600' },
];

const HIGHLIGHTS = [
    { Icon: FaWhatsapp, tile: 'bg-[#25D366]', label: 'WhatsApp', value: 'QR Code ou API' },
    {
        Icon: FaInstagram,
        tile: 'bg-gradient-to-br from-[#F58529] via-[#DD2A7B] to-[#8134AF]',
        label: 'Redes sociais',
        value: 'Direct e Messenger',
    },
    {
        Icon: Globe,
        tile: 'bg-gradient-to-br from-violet-500 to-indigo-600',
        label: 'Site do cliente',
        value: 'Widget em 1 linha',
    },
    { Icon: Zap, tile: 'bg-slate-900', label: 'IA e automações', value: 'Rodando 24/7' },
];

const fadeUp = {
    initial: { opacity: 0, y: 18 },
    animate: { opacity: 1, y: 0 },
};

export function Hero() {
    return (
        <section className="relative overflow-hidden bg-white pt-12 sm:pt-16 lg:pt-20">
            {/* Playful background: soft colour blobs + a fading dot grid */}
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
                <div className="absolute -left-24 -top-16 h-[26rem] w-[26rem] rounded-full bg-brand-green/25 blur-[110px] animate-blob" />
                <div className="absolute -right-24 top-10 h-[30rem] w-[30rem] rounded-full bg-violet-300/35 blur-[120px] animate-blob [animation-delay:-5s]" />
                <div className="absolute bottom-0 left-1/3 h-[22rem] w-[22rem] rounded-full bg-blue-300/30 blur-[110px] animate-blob [animation-delay:-9s]" />
                <div
                    className="absolute inset-0 opacity-[0.5] [mask-image:radial-gradient(ellipse_at_center,black_10%,transparent_70%)]"
                    style={{
                        backgroundImage: 'radial-gradient(#0f172a1a 1px, transparent 1px)',
                        backgroundSize: '22px 22px',
                    }}
                />
            </div>

            <div className="relative mx-auto max-w-7xl px-4 pb-24 sm:px-6 sm:pb-28 lg:px-8">
                <div className="mx-auto max-w-3xl text-center">
                    <motion.div
                        {...fadeUp}
                        transition={{ duration: 0.5 }}
                        className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 py-1.5 pl-1.5 pr-4 shadow-sm backdrop-blur"
                    >
                        <span className="inline-flex items-center gap-1 rounded-full bg-brand-green px-2.5 py-1 text-[0.7rem] font-black uppercase tracking-wide text-slate-900">
                            <Sparkles className="h-3 w-3" />
                            Novo
                        </span>
                        <span className="text-sm font-semibold text-slate-700">
                            IA que aprende com o conteúdo da sua empresa
                        </span>
                    </motion.div>

                    <motion.h1
                        {...fadeUp}
                        transition={{ duration: 0.5, delay: 0.06 }}
                        className="mt-7 text-balance text-[2.6rem] font-extrabold leading-[1.02] tracking-tight text-slate-900 sm:text-6xl lg:text-[4.25rem]"
                    >
                        Nenhum cliente esperando. <Mark>Nenhuma venda perdida.</Mark>
                    </motion.h1>

                    <motion.p
                        {...fadeUp}
                        transition={{ duration: 0.5, delay: 0.12 }}
                        className="mx-auto mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-slate-600 sm:text-xl"
                    >
                        A Dialogy reúne{' '}
                        <strong className="font-semibold text-slate-900">
                            WhatsApp, Instagram, Messenger, Telegram e o chat do seu site
                        </strong>{' '}
                        em um inbox só — com automações e IA que respondem na hora e entregam o lead pronto para o
                        seu time fechar.
                    </motion.p>

                    <motion.div
                        {...fadeUp}
                        transition={{ duration: 0.5, delay: 0.16 }}
                        className="mt-6 flex items-center justify-center gap-2 text-base text-slate-500 sm:text-lg"
                    >
                        <span className="font-medium">Atendendo agora</span>
                        <RotatingWord words={ROTATING_CHANNELS} />
                    </motion.div>

                    <motion.div
                        {...fadeUp}
                        transition={{ duration: 0.5, delay: 0.2 }}
                        className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
                    >
                        <CtaPrimary href="/register" size="lg" className="w-full sm:w-auto">
                            Começar grátis por 7 dias
                            <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
                        </CtaPrimary>
                        <CtaSecondary href="#planos" size="lg" className="w-full sm:w-auto">
                            Ver planos e preços
                        </CtaSecondary>
                    </motion.div>

                    <motion.ul
                        {...fadeUp}
                        transition={{ duration: 0.5, delay: 0.24 }}
                        className="mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-2.5"
                    >
                        {TRUST.map((item) => (
                            <li key={item} className="flex items-center gap-1.5 text-sm font-semibold text-slate-500">
                                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-brand-green">
                                    <Check className="h-2.5 w-2.5 text-slate-900" strokeWidth={4} />
                                </span>
                                {item}
                            </li>
                        ))}
                    </motion.ul>
                </div>

                {/* Product shot. The real screenshot is only legible from tablet up,
                    so phones get the responsive live mock of the same screen. */}
                <div className="relative mt-16 sm:mt-20">
                    <div className="md:hidden">
                        <HeroInbox />
                    </div>
                    <div className="hidden md:block">
                        <HeroVisual />
                    </div>
                </div>

                {/* Highlights strip */}
                <motion.ul
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.55 }}
                    className="relative z-20 mx-auto mt-12 grid max-w-4xl gap-2 rounded-[24px] border border-slate-100 bg-white/95 p-3 shadow-[0_24px_60px_-32px_rgba(15,23,42,0.45)] backdrop-blur sm:grid-cols-2 lg:grid-cols-4"
                >
                    {HIGHLIGHTS.map((item) => (
                        <li key={item.label} className="flex items-center gap-3 rounded-2xl px-3 py-2">
                            <span
                                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white ${item.tile}`}
                            >
                                <item.Icon className="h-5 w-5" />
                            </span>
                            <span className="min-w-0">
                                <span className="block text-[0.68rem] font-black uppercase tracking-wide text-slate-400">
                                    {item.label}
                                </span>
                                <span className="block text-[0.86rem] font-extrabold leading-tight text-slate-900">
                                    {item.value}
                                </span>
                            </span>
                        </li>
                    ))}
                </motion.ul>
            </div>
        </section>
    );
}
