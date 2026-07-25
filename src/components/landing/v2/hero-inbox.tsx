'use client';

import * as React from 'react';
import { Bot, Check, CheckCheck, Globe, Paperclip, Search, Send, Sparkles, Star } from 'lucide-react';
import { FaWhatsapp, FaInstagram, FaTelegram } from 'react-icons/fa6';
import { cn } from '@/lib/utils';

type ConversationChannel = 'instagram' | 'whatsapp' | 'site' | 'telegram';

const CHANNEL_STYLES: Record<
    ConversationChannel,
    { label: string; tile: string; Icon: React.ComponentType<{ className?: string }> }
> = {
    instagram: {
        label: 'Instagram',
        tile: 'bg-gradient-to-br from-[#F58529] via-[#DD2A7B] to-[#8134AF]',
        Icon: FaInstagram,
    },
    whatsapp: { label: 'WhatsApp', tile: 'bg-[#25D366]', Icon: FaWhatsapp },
    site: { label: 'Chat do site', tile: 'bg-gradient-to-br from-violet-500 to-indigo-600', Icon: Globe },
    telegram: { label: 'Telegram', tile: 'bg-gradient-to-br from-[#37AEE2] to-[#1E96C8]', Icon: FaTelegram },
};

const CONVERSATIONS: Array<{
    name: string;
    preview: string;
    time: string;
    channel: ConversationChannel;
    unread?: number;
    active?: boolean;
    initials: string;
    avatar: string;
}> = [
    {
        name: 'Marina Alves',
        preview: 'Somos 6 pessoas na recepção…',
        time: 'agora',
        channel: 'instagram',
        active: true,
        initials: 'MA',
        avatar: 'bg-rose-100 text-rose-600',
    },
    {
        name: 'Loja do Bairro',
        preview: 'Quero um orçamento para 3 lojas',
        time: '2 min',
        channel: 'whatsapp',
        unread: 2,
        initials: 'LB',
        avatar: 'bg-emerald-100 text-emerald-600',
    },
    {
        name: 'Rafael Costa',
        preview: 'Meu pedido #8842 já saiu?',
        time: '8 min',
        channel: 'site',
        initials: 'RC',
        avatar: 'bg-violet-100 text-violet-600',
    },
    {
        name: 'Clínica Vitalis',
        preview: 'Consigo remarcar para quinta?',
        time: '14 min',
        channel: 'telegram',
        unread: 1,
        initials: 'CV',
        avatar: 'bg-blue-100 text-blue-600',
    },
];

export function HeroInbox() {
    return (
        <div className="relative overflow-hidden rounded-[26px] border border-slate-200/80 bg-white shadow-[0_50px_130px_-45px_rgba(15,23,42,0.5)] sm:rounded-[30px]">
            {/* Window chrome */}
            <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/80 px-4 py-3">
                <div className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-full bg-rose-400" />
                    <span className="h-3 w-3 rounded-full bg-amber-400" />
                    <span className="h-3 w-3 rounded-full bg-emerald-400" />
                </div>
                <div className="mx-auto hidden items-center gap-2 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-400 ring-1 ring-slate-200 sm:flex">
                    <Search className="h-3.5 w-3.5" />
                    app.dialogy.com.br/inbox
                </div>
                <div className="ml-auto flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[0.68rem] font-bold uppercase tracking-wide text-emerald-600 ring-1 ring-emerald-100">
                    <span className="relative flex h-1.5 w-1.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    </span>
                    Ao vivo
                </div>
            </div>

            <div className="grid md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
                {/* Conversation list */}
                <div className="hidden border-r border-slate-100 bg-slate-50/40 p-3 md:block">
                    <div className="mb-3 flex items-center justify-between px-1.5">
                        <span className="text-sm font-extrabold text-slate-900">Conversas</span>
                        <span className="rounded-full bg-brand-green px-2 py-0.5 text-[0.68rem] font-black text-slate-900">
                            4 novas
                        </span>
                    </div>
                    <div className="mb-3 flex gap-1.5 px-1.5">
                        {['Todas', 'Minhas', 'IA'].map((filter, index) => (
                            <span
                                key={filter}
                                className={cn(
                                    'rounded-full px-2.5 py-1 text-[0.7rem] font-bold',
                                    index === 0
                                        ? 'bg-slate-900 text-white'
                                        : 'bg-white text-slate-500 ring-1 ring-slate-200',
                                )}
                            >
                                {filter}
                            </span>
                        ))}
                    </div>

                    <ul className="space-y-1">
                        {CONVERSATIONS.map((conversation) => {
                            const channel = CHANNEL_STYLES[conversation.channel];
                            return (
                                <li
                                    key={conversation.name}
                                    className={cn(
                                        'flex items-center gap-3 rounded-2xl p-2.5 transition-colors',
                                        conversation.active
                                            ? 'bg-white shadow-[0_10px_25px_-18px_rgba(15,23,42,0.5)] ring-1 ring-slate-200'
                                            : 'hover:bg-white/70',
                                    )}
                                >
                                    <div className="relative shrink-0">
                                        <span
                                            className={cn(
                                                'flex h-10 w-10 items-center justify-center rounded-xl text-xs font-black',
                                                conversation.avatar,
                                            )}
                                        >
                                            {conversation.initials}
                                        </span>
                                        <span
                                            className={cn(
                                                'absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-lg text-white ring-2 ring-white',
                                                channel.tile,
                                            )}
                                        >
                                            <channel.Icon className="h-3 w-3" />
                                        </span>
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-baseline justify-between gap-2">
                                            <span className="truncate text-[0.82rem] font-bold text-slate-900">
                                                {conversation.name}
                                            </span>
                                            <span className="shrink-0 text-[0.68rem] font-semibold text-slate-400">
                                                {conversation.time}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="truncate text-[0.76rem] text-slate-500">
                                                {conversation.preview}
                                            </span>
                                            {conversation.unread ? (
                                                <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-rose-500 px-1 text-[0.62rem] font-black text-white">
                                                    {conversation.unread}
                                                </span>
                                            ) : null}
                                        </div>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                </div>

                {/* Active conversation */}
                <div className="flex flex-col">
                    <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3.5">
                        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-100 text-xs font-black text-rose-600">
                            MA
                        </span>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <span className="truncate text-sm font-extrabold text-slate-900">Marina Alves</span>
                                <span className="hidden items-center gap-1 rounded-md bg-gradient-to-br from-[#F58529] via-[#DD2A7B] to-[#8134AF] px-1.5 py-0.5 text-[0.62rem] font-black uppercase text-white sm:inline-flex">
                                    <FaInstagram className="h-2.5 w-2.5" />
                                    Direct
                                </span>
                            </div>
                            <span className="text-[0.72rem] font-medium text-slate-500">
                                Veio do anúncio · Clínicas · São Paulo
                            </span>
                        </div>
                        <div className="ml-auto flex items-center gap-1.5 rounded-full bg-violet-50 px-2.5 py-1.5 text-[0.68rem] font-black uppercase tracking-wide text-violet-600 ring-1 ring-violet-100">
                            <Bot className="h-3.5 w-3.5" />
                            IA ativa
                        </div>
                    </div>

                    <div className="flex-1 space-y-3 bg-[linear-gradient(180deg,#ffffff,#fbfdff)] px-4 py-5">
                        <Bubble side="in">Oi! Vi o anúncio de vocês. Atendem clínicas?</Bubble>

                        <Bubble side="ai">
                            <span className="mb-1.5 flex items-center gap-1 text-[0.62rem] font-black uppercase tracking-wide text-slate-900/60">
                                <Sparkles className="h-2.5 w-2.5" />
                                Respondido pela IA
                            </span>
                            Oi, Marina! Atendemos sim 💚 Me conta rapidinho: quantas pessoas respondem os
                            pacientes hoje?
                        </Bubble>

                        <Bubble side="in">Somos 6 pessoas na recepção, e a gente sempre perde mensagem.</Bubble>

                        {/* Handoff event */}
                        <div className="flex items-start gap-2.5 rounded-2xl border border-emerald-100 bg-emerald-50/70 px-3.5 py-3">
                            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-emerald-500 text-white">
                                <Check className="h-3.5 w-3.5" strokeWidth={3} />
                            </span>
                            <div className="text-[0.78rem] leading-relaxed text-emerald-900">
                                <strong className="font-extrabold">Lead qualificado pela IA</strong> — segmento
                                Saúde, 6 atendentes, alto interesse.
                                <span className="mt-1 flex flex-wrap items-center gap-1.5">
                                    <span className="inline-flex items-center gap-1 rounded-md bg-white px-1.5 py-0.5 text-[0.66rem] font-bold text-emerald-700 ring-1 ring-emerald-200">
                                        <Star className="h-2.5 w-2.5" /> Score 92
                                    </span>
                                    <span className="rounded-md bg-white px-1.5 py-0.5 text-[0.66rem] font-bold text-emerald-700 ring-1 ring-emerald-200">
                                        → Fila Comercial
                                    </span>
                                    <span className="rounded-md bg-white px-1.5 py-0.5 text-[0.66rem] font-bold text-emerald-700 ring-1 ring-emerald-200">
                                        CRM atualizado
                                    </span>
                                </span>
                            </div>
                        </div>

                        <Bubble side="agent">
                            Marina, sou a Júlia do comercial! Já vi tudo aqui 👋 Consigo te mostrar em 10 min?
                            <span className="mt-1 flex items-center justify-end gap-1 text-[0.62rem] text-white/60">
                                14:32 <CheckCheck className="h-3 w-3" />
                            </span>
                        </Bubble>

                        <div className="flex items-center gap-1.5 pl-1">
                            <span className="flex h-1.5 w-1.5 animate-typing-dot rounded-full bg-slate-400" />
                            <span className="flex h-1.5 w-1.5 animate-typing-dot rounded-full bg-slate-400 [animation-delay:0.15s]" />
                            <span className="flex h-1.5 w-1.5 animate-typing-dot rounded-full bg-slate-400 [animation-delay:0.3s]" />
                            <span className="ml-1 text-[0.68rem] font-semibold text-slate-400">
                                Marina está digitando…
                            </span>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-3">
                        <Paperclip className="h-4 w-4 shrink-0 text-slate-400" />
                        <div className="flex-1 truncate rounded-full bg-slate-100 px-3.5 py-2 text-[0.78rem] text-slate-400">
                            Digite / para usar um atalho rápido…
                        </div>
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white">
                            <Send className="h-4 w-4" />
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}

function Bubble({ side, children }: { side: 'in' | 'ai' | 'agent'; children: React.ReactNode }) {
    if (side === 'in') {
        return (
            <div className="flex">
                <div className="max-w-[85%] rounded-2xl rounded-tl-md bg-slate-100 px-3.5 py-2.5 text-[0.82rem] leading-relaxed text-slate-700">
                    {children}
                </div>
            </div>
        );
    }

    if (side === 'ai') {
        return (
            <div className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-brand-green px-3.5 py-2.5 text-[0.82rem] font-medium leading-relaxed text-slate-900">
                    {children}
                </div>
            </div>
        );
    }

    return (
        <div className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-slate-900 px-3.5 py-2.5 text-[0.82rem] leading-relaxed text-white">
                {children}
            </div>
        </div>
    );
}
