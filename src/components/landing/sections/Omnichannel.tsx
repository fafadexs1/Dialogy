'use client';

import React, { useState } from 'react';
import {
    ArrowRight,
    Bot,
    CheckCircle2,
    Clock3,
    LayoutDashboard,
    ShieldCheck,
    Sparkles,
} from 'lucide-react';
import { FadeIn, SectionWrapper } from '../ui/SectionWrapper';
import { ChannelType } from '../types';
import { FacebookIcon, InstagramIcon, MercadoLivreIcon, WhatsAppIcon } from './ui/Icons';

const channels = [
    {
        id: ChannelType.WHATSAPP,
        label: 'WhatsApp',
        icon: WhatsAppIcon,
        cardClass: 'bg-emerald-50 text-emerald-700',
        headline: 'Atenda varios agentes no mesmo numero.',
        sub: 'Organize fila, prioridade e historico do WhatsApp em uma operacao previsivel.',
        bullets: ['Distribuicao por equipe', 'Contexto no CRM', 'Automacao de primeira resposta'],
        example: 'Cliente pediu proposta e a IA ja sugeriu o proximo passo.',
    },
    {
        id: ChannelType.INSTAGRAM,
        label: 'Instagram',
        icon: InstagramIcon,
        cardClass: 'bg-pink-50 text-pink-600',
        headline: 'Transforme directs em processo comercial.',
        sub: 'Veja mention, story e direct no mesmo lugar e avance o contato sem perder o timing.',
        bullets: ['Leads do direct no inbox', 'Atalho para follow-up', 'Visao do historico por contato'],
        example: 'Quem chegou pelo anuncio nao some no meio das mensagens.',
    },
    {
        id: ChannelType.FACEBOOK,
        label: 'Facebook',
        icon: FacebookIcon,
        cardClass: 'bg-sky-50 text-sky-700',
        headline: 'Mantenha historico e atendimento no Messenger.',
        sub: 'Seu time trabalha com o contexto completo da conversa e sem deixar o cliente esperando.',
        bullets: ['Historico por cliente', 'SLA acompanhado', 'Transferencia entre atendentes'],
        example: 'O atendimento continua com contexto mesmo quando troca de operador.',
    },
    {
        id: ChannelType.MERCADO_LIVRE,
        label: 'Mercado Livre',
        icon: MercadoLivreIcon,
        cardClass: 'bg-amber-50 text-amber-700',
        headline: 'Fale com comprador e pos-venda no mesmo fluxo.',
        sub: 'Perguntas de pre-venda e follow-up deixam de ficar espalhados em telas separadas.',
        bullets: ['Fila para marketplace', 'Registro de tratativas', 'Melhor handoff para suporte'],
        example: 'A conversa ja entra no fluxo certo e com dono definido.',
    },
];

const omniMetrics = [
    { value: '1 inbox', label: 'para todos os canais' },
    { value: '+4 canais', label: 'no mesmo fluxo' },
    { value: 'IA assistida', label: 'sem trocar de tela' },
];

export function Omnichannel() {
    const [active, setActive] = useState(0);
    const activeData = channels[active];

    return (
        <SectionWrapper id="omnichannel" className="py-24 md:py-28">
            <div className="relative overflow-hidden rounded-[40px] border border-black/10 bg-[linear-gradient(145deg,#ffffff_0%,#f6f2e8_100%)] p-6 shadow-[0_38px_110px_-70px_rgba(15,23,42,0.38)] md:p-10">
                <div className="pointer-events-none absolute -left-20 top-10 h-72 w-72 rounded-full bg-emerald-200/35 blur-[90px]" />
                <div className="pointer-events-none absolute bottom-0 right-0 h-80 w-80 rounded-full bg-sky-200/25 blur-[120px]" />
                <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(15,23,42,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.03)_1px,transparent_1px)] bg-[size:34px_34px] opacity-20" />

                <div className="relative z-10 grid gap-10 lg:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)] lg:items-start">
                    <div>
                        <FadeIn>
                            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">
                                Omnichannel sem bagunca
                            </p>
                        </FadeIn>
                        <FadeIn delay={0.08}>
                            <h2 className="mt-4 text-4xl font-semibold tracking-tight text-slate-950 md:text-5xl">
                                Todos os canais entram no mesmo fluxo. Seu time responde com contexto.
                            </h2>
                        </FadeIn>
                        <FadeIn delay={0.16}>
                            <p className="mt-5 max-w-xl text-lg leading-8 text-slate-600">
                                WhatsApp, Instagram, Facebook e Mercado Livre deixam de parecer operacoes separadas.
                                Na Dialogy, tudo chega organizado no mesmo inbox.
                            </p>
                        </FadeIn>

                        <FadeIn delay={0.22}>
                            <div className="mt-7 grid gap-3 sm:grid-cols-3">
                                {omniMetrics.map((metric) => (
                                    <div
                                        key={metric.value}
                                        className="rounded-2xl border border-black/10 bg-white/80 px-4 py-3 shadow-[0_18px_38px_-30px_rgba(15,23,42,0.2)] backdrop-blur"
                                    >
                                        <p className="text-sm font-semibold text-slate-950">{metric.value}</p>
                                        <p className="mt-1 text-sm leading-6 text-slate-500">{metric.label}</p>
                                    </div>
                                ))}
                            </div>
                        </FadeIn>

                        <div className="mt-8 grid gap-3 sm:grid-cols-2">
                            {channels.map((channel, idx) => (
                                <button
                                    key={channel.id}
                                    onClick={() => setActive(idx)}
                                    className={`rounded-[28px] border px-4 py-4 text-left transition-all ${
                                        active === idx
                                            ? 'border-slate-950 bg-slate-950 text-white shadow-[0_22px_44px_-30px_rgba(15,23,42,0.62)]'
                                            : 'border-black/10 bg-white/80 text-slate-700 hover:-translate-y-0.5 hover:border-black/15 hover:bg-white'
                                    }`}
                                >
                                    <div className="flex items-start justify-between gap-4">
                                        <div className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl ${active === idx ? 'bg-white/10 text-white' : channel.cardClass}`}>
                                            <channel.icon className="h-5 w-5" />
                                        </div>
                                        {active === idx ? (
                                            <span className="rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/80">
                                                Ativo
                                            </span>
                                        ) : null}
                                    </div>
                                    <p className="mt-4 font-semibold">{channel.label}</p>
                                    <p className={`mt-1 text-sm leading-6 ${active === idx ? 'text-slate-300' : 'text-slate-500'}`}>
                                        {channel.headline}
                                    </p>
                                </button>
                            ))}
                        </div>
                    </div>

                    <FadeIn delay={0.12}>
                        <div className="rounded-[34px] border border-black/10 bg-white/72 p-5 shadow-[0_28px_70px_-42px_rgba(15,23,42,0.3)] backdrop-blur-xl md:p-6">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <p className="text-sm font-semibold text-slate-950">{activeData.label}</p>
                                    <p className="mt-1 text-sm leading-6 text-slate-500">{activeData.sub}</p>
                                </div>
                                <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 shadow-sm">
                                    <ShieldCheck className="h-3.5 w-3.5 text-brand-green" />
                                    Operacao previsivel
                                </div>
                            </div>

                            <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
                                <div className="rounded-[28px] border border-black/10 bg-[#fbfaf6] p-5">
                                    <div className="flex items-center justify-between gap-3 border-b border-black/10 pb-4">
                                        <div className="flex items-center gap-3">
                                            <div className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl ${activeData.cardClass}`}>
                                                <activeData.icon className="h-5 w-5" />
                                            </div>
                                            <div>
                                                <p className="font-semibold text-slate-950">Inbox priorizado</p>
                                                <p className="text-sm text-slate-500">Fila, dono e contexto antes da resposta.</p>
                                            </div>
                                        </div>
                                        <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm">
                                            SLA em dia
                                        </span>
                                    </div>

                                    <div className="mt-5 space-y-4">
                                        <div className="rounded-[24px] border border-black/10 bg-white px-4 py-4 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.18)]">
                                            <div className="mb-2 flex items-center gap-2">
                                                <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${activeData.cardClass}`}>
                                                    <activeData.icon className="h-3.5 w-3.5" />
                                                </span>
                                                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{activeData.label}</p>
                                            </div>
                                            <p className="text-sm leading-6 text-slate-700">
                                                Cliente: "Quero entender qual plano encaixa melhor para minha equipe."
                                            </p>
                                        </div>

                                        <div className="ml-auto max-w-[88%] rounded-[24px] bg-slate-950 px-4 py-4 text-white shadow-[0_24px_44px_-30px_rgba(15,23,42,0.6)]">
                                            <p className="text-sm leading-6">
                                                Time: "Ja vi o historico e consigo te mostrar a melhor opcao sem te fazer repetir contexto."
                                            </p>
                                        </div>

                                        <div className="rounded-[24px] border border-emerald-200 bg-emerald-50 p-4">
                                            <div className="flex items-start gap-3">
                                                <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white text-emerald-700 shadow-sm">
                                                    <Bot className="h-4.5 w-4.5" />
                                                </div>
                                                <div>
                                                    <p className="text-sm font-semibold text-emerald-800">Sugestao da IA</p>
                                                    <p className="mt-1 text-sm leading-6 text-emerald-900/80">
                                                        {activeData.example}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <div className="rounded-[26px] border border-black/10 bg-[#fbfaf6] p-4">
                                        <div className="flex items-center gap-3">
                                            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-slate-900 shadow-sm">
                                                <LayoutDashboard className="h-5 w-5" />
                                            </div>
                                            <div>
                                                <p className="font-semibold text-slate-950">No mesmo painel</p>
                                                <p className="text-sm text-slate-500">Inbox, CRM e proxima acao no mesmo lugar.</p>
                                            </div>
                                        </div>
                                        <div className="mt-4 flex flex-wrap gap-2">
                                            <span className="rounded-full border border-black/10 bg-white px-3 py-1 text-xs font-semibold text-slate-600">Fila</span>
                                            <span className="rounded-full border border-black/10 bg-white px-3 py-1 text-xs font-semibold text-slate-600">CRM</span>
                                            <span className="rounded-full border border-black/10 bg-white px-3 py-1 text-xs font-semibold text-slate-600">Automacao</span>
                                        </div>
                                    </div>

                                    <div className="rounded-[26px] border border-black/10 bg-white p-4 shadow-[0_18px_38px_-30px_rgba(15,23,42,0.2)]">
                                        <p className="text-sm font-semibold text-slate-950">O que fica mais simples</p>
                                        <ul className="mt-4 space-y-3">
                                            {activeData.bullets.map((item) => (
                                                <li key={item} className="flex items-start gap-3 text-sm leading-6 text-slate-600">
                                                    <CheckCircle2 className="mt-0.5 h-4.5 w-4.5 shrink-0 text-brand-green" />
                                                    {item}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>

                                    <div className="rounded-[26px] border border-black/10 bg-white p-4 shadow-[0_18px_38px_-30px_rgba(15,23,42,0.18)]">
                                        <div className="flex items-center gap-3">
                                            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-900">
                                                <Clock3 className="h-5 w-5" />
                                            </div>
                                            <div>
                                                <p className="font-semibold text-slate-950">Menos atraso, mais ownership</p>
                                                <p className="text-sm text-slate-500">
                                                    O canal muda, mas o fluxo do time continua consistente.
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="rounded-[26px] bg-slate-950 p-4 text-white shadow-[0_26px_48px_-34px_rgba(15,23,42,0.62)]">
                                        <div className="flex items-center gap-2 text-sm font-semibold">
                                            <Sparkles className="h-4 w-4 text-brand-green" />
                                            Resultado pratico
                                        </div>
                                        <p className="mt-2 text-sm leading-6 text-slate-300">
                                            O cliente entra por um canal. Seu time responde como uma operacao so.
                                        </p>
                                    </div>

                                    <a
                                        href="#pricing"
                                        className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900 transition-colors hover:text-brand-green"
                                    >
                                        Ver como isso aparece nos planos
                                        <ArrowRight className="h-4 w-4" />
                                    </a>
                                </div>
                            </div>
                        </div>
                    </FadeIn>
                </div>
            </div>
        </SectionWrapper>
    );
}
