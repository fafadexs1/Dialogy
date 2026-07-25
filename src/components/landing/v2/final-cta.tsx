'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Check, Globe, MessageCircle } from 'lucide-react';
import { FaWhatsapp, FaInstagram, FaFacebookMessenger, FaTelegram } from 'react-icons/fa6';
import { CtaPrimary } from './brand';

const PROMISES = ['7 dias grátis', 'Usuários ilimitados', 'Sem fidelidade', 'Suporte em português'];

const CHANNEL_ICONS = [
    { Icon: FaWhatsapp, tile: 'bg-[#25D366]' },
    { Icon: FaInstagram, tile: 'bg-gradient-to-br from-[#F58529] via-[#DD2A7B] to-[#8134AF]' },
    { Icon: FaFacebookMessenger, tile: 'bg-gradient-to-br from-[#00B2FF] to-[#006AFF]' },
    { Icon: FaTelegram, tile: 'bg-gradient-to-br from-[#37AEE2] to-[#1E96C8]' },
    { Icon: Globe, tile: 'bg-gradient-to-br from-violet-500 to-indigo-600' },
];

export function FinalCta() {
    return (
        <section className="bg-white px-4 pb-20 pt-8 sm:px-6 sm:pb-28 lg:px-8">
            <motion.div
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-80px' }}
                transition={{ duration: 0.55 }}
                className="relative mx-auto max-w-6xl overflow-hidden rounded-[36px] bg-gradient-to-br from-brand-green via-emerald-300 to-teal-200 px-6 py-16 text-center sm:rounded-[44px] sm:px-12 sm:py-20"
            >
                <div aria-hidden="true" className="pointer-events-none absolute inset-0">
                    <div className="absolute -left-20 -top-20 h-72 w-72 rounded-full bg-white/40 blur-3xl" />
                    <div className="absolute -bottom-24 right-0 h-80 w-80 rounded-full bg-violet-400/30 blur-3xl" />
                    <div
                        className="absolute inset-0 opacity-30"
                        style={{
                            backgroundImage: 'radial-gradient(#0f172a26 1px, transparent 1px)',
                            backgroundSize: '24px 24px',
                        }}
                    />
                </div>

                <div className="relative">
                    <div className="mb-8 flex items-center justify-center -space-x-3">
                        {CHANNEL_ICONS.map(({ Icon, tile }, index) => (
                            <span
                                key={index}
                                className={`flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-lg ring-4 ring-white/40 ${tile}`}
                            >
                                <Icon className="h-6 w-6" />
                            </span>
                        ))}
                    </div>

                    <h2 className="text-balance text-3xl font-black leading-[1.05] tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
                        Seu próximo cliente já está
                        <br className="hidden sm:block" /> mandando mensagem.
                    </h2>
                    <p className="mx-auto mt-5 max-w-xl text-pretty text-base font-medium leading-relaxed text-slate-800/80 sm:text-lg">
                        Conecte seus canais hoje e deixe a Dialogy responder por você — em todos eles, a qualquer
                        hora, sem deixar ninguém no vácuo.
                    </p>

                    <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
                        <CtaPrimary href="/register" size="lg" className="w-full sm:w-auto">
                            Criar minha conta grátis
                            <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
                        </CtaPrimary>
                        <a
                            href="https://wa.me/551151994714"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-full border border-slate-900/15 bg-white/70 px-7 text-base font-bold text-slate-900 backdrop-blur transition-all hover:-translate-y-0.5 hover:bg-white sm:w-auto sm:text-lg"
                        >
                            <MessageCircle className="h-5 w-5" />
                            Falar com um especialista
                        </a>
                    </div>

                    <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2.5">
                        {PROMISES.map((promise) => (
                            <li
                                key={promise}
                                className="flex items-center gap-1.5 text-sm font-bold text-slate-800/70"
                            >
                                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-slate-900">
                                    <Check className="h-2.5 w-2.5 text-brand-green" strokeWidth={4} />
                                </span>
                                {promise}
                            </li>
                        ))}
                    </ul>
                </div>
            </motion.div>
        </section>
    );
}
