'use client';

import * as React from 'react';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { ArrowRight, Blocks, Code2, Webhook } from 'lucide-react';
import { SectionHeading, Mark, CtaSecondary } from './brand';
import { Marquee } from './effects';

type Logo = { name: string; src?: string; initials?: string; tone?: string };

const ROW_ONE: Logo[] = [
    { name: 'WhatsApp', src: '/icons/whatsapp.svg' },
    { name: 'Instagram', src: '/icons/instagram.svg' },
    { name: 'Messenger', src: '/icons/messenger.svg' },
    { name: 'Telegram', src: '/icons/telegram.svg' },
    { name: 'Chat do site', src: '/icons/webchat.svg' },
    { name: 'Mercado Livre', src: '/icons/mercadolivre.png' },
    { name: 'Delivery Hub', src: '/icons/delivery-hub.svg' },
];

const ROW_TWO: Logo[] = [
    { name: 'OpenAI', initials: 'AI', tone: 'bg-slate-900' },
    { name: 'Gemini', src: '/icons/gemini.svg' },
    { name: 'DeepSeek', initials: 'DS', tone: 'bg-blue-600' },
    { name: 'Google Ads', src: '/icons/google-ads.svg' },
    { name: 'NexusFlow', src: '/icons/nexusflow.svg' },
    { name: 'SGP', initials: 'SGP', tone: 'bg-indigo-600' },
    { name: 'Stripe', initials: 'S', tone: 'bg-violet-600' },
    { name: 'Webhooks', initials: '{ }', tone: 'bg-emerald-600' },
];

function LogoPill({ logo }: { logo: Logo }) {
    return (
        <div className="flex shrink-0 items-center gap-3 rounded-2xl border border-slate-200/80 bg-white px-5 py-3.5 shadow-[0_10px_24px_-18px_rgba(15,23,42,0.4)]">
            {logo.src ? (
                <Image
                    src={logo.src}
                    alt={logo.name}
                    width={28}
                    height={28}
                    className="h-7 w-7 object-contain"
                />
            ) : (
                <span
                    className={`flex h-7 w-7 items-center justify-center rounded-lg text-[0.62rem] font-black text-white ${logo.tone ?? 'bg-slate-900'}`}
                >
                    {logo.initials}
                </span>
            )}
            <span className="whitespace-nowrap text-[0.88rem] font-bold text-slate-700">{logo.name}</span>
        </div>
    );
}

export function Integrations() {
    return (
        <section id="integracoes" className="relative overflow-hidden bg-white py-20 sm:py-28">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                <SectionHeading
                    accent="blue"
                    eyebrow={
                        <>
                            <Blocks className="h-3.5 w-3.5" />
                            Conecta com o que você já usa
                        </>
                    }
                    title={
                        <>
                            Sua operação inteira falando{' '}
                            <Mark tone="blue">a mesma língua.</Mark>
                        </>
                    }
                    description="Canais, motores de IA, anúncios, cobrança e o seu sistema interno. O que não tiver integração nativa você pluga via API pública e webhooks."
                />
            </div>

            <div className="mt-14 space-y-4">
                <Marquee>
                    {ROW_ONE.map((logo) => (
                        <LogoPill key={logo.name} logo={logo} />
                    ))}
                </Marquee>
                <Marquee reverse>
                    {ROW_TWO.map((logo) => (
                        <LogoPill key={logo.name} logo={logo} />
                    ))}
                </Marquee>
            </div>

            <div className="mx-auto mt-14 max-w-7xl px-4 sm:px-6 lg:px-8">
                <div className="grid gap-4 sm:grid-cols-3">
                    {[
                        {
                            icon: Code2,
                            title: 'API pública',
                            copy: 'Crie contatos, envie mensagens e leia conversas direto do seu sistema.',
                            tone: 'bg-blue-50 text-blue-600 ring-blue-100',
                        },
                        {
                            icon: Webhook,
                            title: 'Webhooks em tempo real',
                            copy: 'Cada evento do atendimento vira um gatilho no seu ERP ou CRM.',
                            tone: 'bg-violet-50 text-violet-600 ring-violet-100',
                        },
                        {
                            icon: Blocks,
                            title: 'NexusFlow low-code',
                            copy: 'Ligue sistemas e monte automações arrastando blocos, sem programar.',
                            tone: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
                        },
                    ].map((item, index) => (
                        <motion.div
                            key={item.title}
                            initial={{ opacity: 0, y: 16 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true, margin: '-50px' }}
                            transition={{ duration: 0.4, delay: index * 0.08 }}
                            className="rounded-3xl border border-slate-200/80 bg-white p-6"
                        >
                            <span
                                className={`flex h-11 w-11 items-center justify-center rounded-2xl ring-1 ${item.tone}`}
                            >
                                <item.icon className="h-5 w-5" />
                            </span>
                            <h3 className="mt-4 text-base font-extrabold text-slate-900">{item.title}</h3>
                            <p className="mt-1.5 text-[0.9rem] leading-relaxed text-slate-600">{item.copy}</p>
                        </motion.div>
                    ))}
                </div>

                <div className="mt-8 flex justify-center">
                    <CtaSecondary href="/developer" size="lg">
                        Ver o Developer Center
                        <ArrowRight className="h-5 w-5" />
                    </CtaSecondary>
                </div>
            </div>
        </section>
    );
}
