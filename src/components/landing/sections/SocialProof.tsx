'use client';

import React from 'react';
import { CheckCircle2, MessageSquareQuote, ShieldCheck, Workflow } from 'lucide-react';
import { FadeIn } from '../ui/SectionWrapper';
import { FacebookIcon, InstagramIcon, MercadoLivreIcon, WhatsAppIcon } from './ui/Icons';

const channels = [
    { label: 'WhatsApp Business', icon: WhatsAppIcon, tint: 'bg-emerald-50 text-emerald-700' },
    { label: 'Instagram Direct', icon: InstagramIcon, tint: 'bg-pink-50 text-pink-600' },
    { label: 'Facebook Messenger', icon: FacebookIcon, tint: 'bg-sky-50 text-sky-700' },
    { label: 'Mercado Livre', icon: MercadoLivreIcon, tint: 'bg-amber-50 text-amber-700' },
];

const proofs = [
    {
        title: 'Fluxo mais simples',
        description: 'Seu time para de alternar abas e passa a responder com contexto.',
        icon: Workflow,
    },
    {
        title: 'Operacao com regra',
        description: 'Fila, responsavel, tag e prioridade deixam de ficar soltos.',
        icon: ShieldCheck,
    },
    {
        title: 'IA com criterio',
        description: 'Automacao e sugestao entram para acelerar, nao para confundir.',
        icon: MessageSquareQuote,
    },
];

export function SocialProof() {
    return (
        <section className="px-4 py-6 md:px-8">
            <div className="mx-auto max-w-7xl rounded-[36px] border border-black/10 bg-white px-6 py-10 shadow-[0_28px_80px_-50px_rgba(15,23,42,0.4)] md:px-10">
                <div className="grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-end">
                    <FadeIn>
                        <div>
                            <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                                <CheckCircle2 className="h-3.5 w-3.5 text-brand-green" />
                                Clareza primeiro
                            </div>
                            <h2 className="mt-5 text-3xl font-semibold tracking-tight text-slate-950 md:text-4xl">
                                Os canais que seu time ja usa, agora no mesmo fluxo.
                            </h2>
                            <p className="mt-4 max-w-xl text-base leading-7 text-slate-600 md:text-lg">
                                Em vez de parecer uma vitrine cheia de efeito, a Dialogy agora se apresenta como
                                uma operacao mais previsivel: entrada unica, prioridade visivel e time mais alinhado.
                            </p>
                        </div>
                    </FadeIn>

                    <FadeIn delay={0.1}>
                        <div className="grid gap-3 sm:grid-cols-2">
                            {channels.map((channel) => (
                                <div key={channel.label} className="rounded-3xl border border-black/10 bg-[#faf9f4] p-4">
                                    <div className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl ${channel.tint}`}>
                                        <channel.icon className="h-5 w-5" />
                                    </div>
                                    <p className="mt-4 font-semibold text-slate-950">{channel.label}</p>
                                    <p className="mt-1 text-sm leading-6 text-slate-500">Atendimento no mesmo painel, sem perder o contexto da conversa.</p>
                                </div>
                            ))}
                        </div>
                    </FadeIn>
                </div>

                <div className="mt-8 grid gap-4 md:grid-cols-3">
                    {proofs.map((proof, index) => (
                        <FadeIn key={proof.title} delay={0.15 + index * 0.05}>
                            <div className="h-full rounded-3xl border border-black/10 bg-[#faf9f4] p-5">
                                <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-slate-900 shadow-sm">
                                    <proof.icon className="h-5 w-5" />
                                </div>
                                <p className="mt-5 text-lg font-semibold text-slate-950">{proof.title}</p>
                                <p className="mt-2 text-sm leading-6 text-slate-600">{proof.description}</p>
                            </div>
                        </FadeIn>
                    ))}
                </div>
            </div>
        </section>
    );
}
