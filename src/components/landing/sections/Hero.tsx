'use client';

import React from 'react';
import {
    ArrowRight,
    Bot,
    CheckCircle2,
    Clock3,
    MessageCircle,
    ShieldCheck,
    Sparkles,
    SplitSquareVertical,
    Users
} from 'lucide-react';
import { SectionWrapper, FadeIn } from '../ui/SectionWrapper';
import { FacebookIcon, InstagramIcon, MercadoLivreIcon, WhatsAppIcon } from './ui/Icons';

const quickWins = [
    'Inbox unico para vendas, suporte e follow-up.',
    'Fila, responsavel e contexto visiveis em uma tela.',
    'IA para sugerir respostas sem tirar o controle do time.',
];

const channels = [
    { label: 'WhatsApp', icon: WhatsAppIcon },
    { label: 'Instagram', icon: InstagramIcon },
    { label: 'Facebook', icon: FacebookIcon },
    { label: 'Mercado Livre', icon: MercadoLivreIcon },
];

const inboxItems = [
    {
        name: 'Ana Silva',
        channel: 'WhatsApp',
        message: 'Quero entender os planos para meu time comercial.',
        status: 'Lead quente',
    },
    {
        name: 'Studio Marea',
        channel: 'Instagram',
        message: 'Voces integram direct com chatbot?',
        status: 'Novo contato',
    },
    {
        name: 'Loja Brava',
        channel: 'Mercado Livre',
        message: 'Preciso acompanhar SLA da equipe de suporte.',
        status: 'Prioridade alta',
    },
];

export function Hero() {
    return (
        <SectionWrapper id="hero" className="overflow-visible pt-32 pb-20 md:pt-44 md:pb-24" fullWidth>
            <div className="container-width relative z-10">
                <div className="grid items-center gap-14 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
                    <div>
                        <FadeIn>
                            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-950/10 bg-white/80 px-4 py-2 text-sm font-medium text-slate-700 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.45)]">
                                <span className="h-2 w-2 rounded-full bg-brand-green" />
                                Inbox omnichannel com IA assistida
                            </div>
                        </FadeIn>

                        <FadeIn delay={0.1} className="mt-6 max-w-3xl">
                            <h1 className="text-5xl font-semibold tracking-tight text-slate-950 md:text-6xl lg:text-7xl">
                                Centralize atendimento, vendas e follow-up em uma tela so.
                            </h1>
                        </FadeIn>

                        <FadeIn delay={0.2} className="mt-6 max-w-2xl">
                            <p className="text-lg leading-8 text-slate-600 md:text-xl">
                                A Dialogy conecta WhatsApp, Instagram, Facebook e Mercado Livre com chatbot,
                                fila de atendimento e automacao para seu time responder melhor e vender sem perder contexto.
                            </p>
                        </FadeIn>

                        <FadeIn delay={0.3} className="mt-8 flex flex-col gap-3 sm:flex-row">
                            <a
                                href="#pricing"
                                className="inline-flex items-center justify-center gap-2 rounded-full bg-slate-950 px-6 py-3.5 text-sm font-semibold text-white transition-all hover:bg-slate-800"
                            >
                                Ver planos
                                <ArrowRight className="h-4 w-4" />
                            </a>
                            <a
                                href="https://wa.me/551151994714"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-6 py-3.5 text-sm font-semibold text-slate-900 transition-all hover:border-slate-300 hover:bg-slate-50"
                            >
                                <MessageCircle className="h-4 w-4" />
                                Falar no WhatsApp
                            </a>
                        </FadeIn>

                        <FadeIn delay={0.4} className="mt-8 grid gap-3 sm:grid-cols-3">
                            {quickWins.map((item) => (
                                <div key={item} className="rounded-3xl border border-black/10 bg-white/85 px-4 py-4 shadow-[0_16px_35px_-30px_rgba(15,23,42,0.45)]">
                                    <div className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
                                        <CheckCircle2 className="h-4 w-4" />
                                    </div>
                                    <p className="text-sm leading-6 text-slate-700">{item}</p>
                                </div>
                            ))}
                        </FadeIn>

                        <FadeIn delay={0.5} className="mt-8 flex flex-wrap items-center gap-3 text-sm text-slate-500">
                            <span className="font-medium text-slate-600">Canais em um so fluxo:</span>
                            {channels.map((channel) => (
                                <span
                                    key={channel.label}
                                    className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2 shadow-[0_10px_20px_-18px_rgba(15,23,42,0.5)]"
                                >
                                    <channel.icon className="h-4 w-4" />
                                    {channel.label}
                                </span>
                            ))}
                        </FadeIn>
                    </div>

                    <FadeIn delay={0.2} className="relative">
                        <div className="pointer-events-none absolute -right-8 top-10 h-44 w-44 rounded-full bg-emerald-200/50 blur-3xl" />
                        <div className="pointer-events-none absolute -left-6 bottom-10 h-40 w-40 rounded-full bg-sky-200/50 blur-3xl" />

                        <div className="relative rounded-[32px] border border-black/10 bg-white p-4 shadow-[0_35px_120px_-55px_rgba(15,23,42,0.55)]">
                            <div className="rounded-[28px] border border-black/10 bg-[#fcfcf8] p-5">
                                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-black/10 pb-4">
                                    <div>
                                        <p className="text-sm font-semibold text-slate-950">Inbox unificado</p>
                                        <p className="text-sm text-slate-500">Contexto, prioridade e acao na mesma tela.</p>
                                    </div>
                                    <div className="flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                                        <ShieldCheck className="h-3.5 w-3.5" />
                                        Operacao organizada
                                    </div>
                                </div>

                                <div className="mt-5 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                                    <div className="space-y-3">
                                        {inboxItems.map((item, index) => (
                                            <div
                                                key={item.name}
                                                className={`rounded-3xl border px-4 py-4 shadow-sm ${index === 0 ? 'border-emerald-200 bg-emerald-50/70' : 'border-black/10 bg-white'}`}
                                            >
                                                <div className="flex items-center justify-between gap-3">
                                                    <div>
                                                        <p className="font-semibold text-slate-950">{item.name}</p>
                                                        <p className="text-sm text-slate-500">{item.channel}</p>
                                                    </div>
                                                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                                                        {item.status}
                                                    </span>
                                                </div>
                                                <p className="mt-3 text-sm leading-6 text-slate-700">{item.message}</p>
                                            </div>
                                        ))}
                                    </div>

                                    <div className="space-y-4">
                                        <div className="rounded-3xl border border-black/10 bg-white p-4">
                                            <div className="flex items-center gap-3">
                                                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-950 text-white">
                                                    <SplitSquareVertical className="h-5 w-5" />
                                                </div>
                                                <div>
                                                    <p className="font-semibold text-slate-950">Fila clara</p>
                                                    <p className="text-sm text-slate-500">Quem atende, o que vence e o que virou oportunidade.</p>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="rounded-3xl border border-black/10 bg-white p-4">
                                            <div className="flex items-center gap-3">
                                                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
                                                    <Bot className="h-5 w-5" />
                                                </div>
                                                <div>
                                                    <p className="font-semibold text-slate-950">IA assistida</p>
                                                    <p className="text-sm text-slate-500">Resumo, sugestao de resposta e triagem com supervisao humana.</p>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="rounded-3xl border border-slate-950 bg-slate-950 p-5 text-white">
                                            <div className="flex items-start justify-between gap-4">
                                                <div>
                                                    <p className="text-sm font-semibold">Proxima acao sugerida</p>
                                                    <p className="mt-2 text-sm leading-6 text-slate-300">
                                                        Enviar os planos, marcar demo e manter o contexto sem sair do chat.
                                                    </p>
                                                </div>
                                                <Sparkles className="mt-1 h-5 w-5 text-brand-green" />
                                            </div>
                                            <div className="mt-4 flex items-center gap-6 text-xs text-slate-300">
                                                <span className="inline-flex items-center gap-2">
                                                    <Clock3 className="h-3.5 w-3.5 text-brand-green" />
                                                    SLA acompanhado
                                                </span>
                                                <span className="inline-flex items-center gap-2">
                                                    <Users className="h-3.5 w-3.5 text-brand-green" />
                                                    Time alinhado
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </FadeIn>
                </div>
            </div>
        </SectionWrapper>
    );
}
