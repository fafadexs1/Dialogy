'use client';

import React, { useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { NeonButton } from '../ui/NeonButton';
import { SectionWrapper, FadeIn } from '../ui/SectionWrapper';
import { Spotlight } from '../ui/Spotlight';
import {
    ArrowRight,
    MessageSquare,
    Users,
    BarChart2,
    Check,
    X,
    Sparkles,
    Send,
    Filter,
    Plus,
    MoreVertical,
    Paperclip,
    Smile,
    Mic,
    Hash,
    Instagram,
    User,
    ArrowLeftRight,
    Edit3,
    Search,
    MessageCircle,
    Layers,
    CheckCircle2
} from 'lucide-react';
import { FaWhatsapp, FaInstagram } from 'react-icons/fa6';
import Image from 'next/image';
import { cn } from '@/lib/utils';

// --- Components for High-Fidelity Mockup ---

function MockAvatar({ src, fallback, className, status, channel }: { src?: string, fallback: string, className?: string, status?: 'online' | 'offline', channel?: 'whatsapp' | 'instagram' | 'telegram' }) {
    return (
        <div className={cn("relative flex-shrink-0", className)}>
            <div className="h-full w-full rounded-full bg-[#1A1A24] flex items-center justify-center overflow-hidden ring-1 ring-white/10 shadow-inner">
                {src ? (
                    <Image src={src} alt="" width={44} height={44} className="w-full h-full object-cover" />
                ) : (
                    <span className="text-[10px] font-bold text-zinc-400 tracking-tighter uppercase">{fallback}</span>
                )}
            </div>
            {status === 'online' && (
                <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-[#030305]"></span>
            )}
            {channel === 'whatsapp' && (
                <div className="absolute -bottom-0.5 -left-0.5 h-4 w-4 rounded-full bg-[#25D366] flex items-center justify-center ring-2 ring-[#030305] shadow-lg">
                    <FaWhatsapp className="text-white text-[8px]" />
                </div>
            )}
            {channel === 'instagram' && (
                <div className="absolute -bottom-0.5 -left-0.5 h-4 w-4 rounded-full bg-gradient-to-tr from-[#FFD600] via-[#FF0069] to-[#7638FF] flex items-center justify-center ring-2 ring-[#030305] shadow-lg">
                    <FaInstagram className="text-white text-[8px]" />
                </div>
            )}
            {channel === 'telegram' && (
                <div className="absolute -bottom-0.5 -left-0.5 h-4 w-4 rounded-full bg-[#0088CC] flex items-center justify-center ring-2 ring-[#030305] shadow-lg">
                    <Send className="text-white text-[7px] -translate-x-[0.5px] rotate-[15deg]" />
                </div>
            )}
        </div>
    );
}

function MockSidebar() {
    return (
        <div className="w-[68px] h-full border-r border-white/5 bg-[#030305] flex flex-col items-center py-6 gap-8 shrink-0">
            <div className="h-10 w-10 rounded-xl bg-[#131521] flex items-center justify-center mb-2 ring-1 ring-white/10 shadow-lg">
                <Image src="/logo.png" alt="Dialogy" width={22} height={22} className="object-contain" />
            </div>

            <div className="h-px w-6 bg-white/5" />

            <div className="flex flex-col gap-6">
                <div className="h-9 w-9 rounded-xl bg-blue-500 flex items-center justify-center text-white shadow-[0_0_12px_rgba(59,130,246,0.4)]">
                    <MessageSquare className="h-4.5 w-4.5" />
                </div>
                {[Users, Send, BarChart2, Layers].map((Icon, i) => (
                    <div key={i} className="h-9 w-9 rounded-xl flex items-center justify-center text-zinc-600 hover:text-white transition-colors cursor-pointer">
                        <Icon className="h-4.5 w-4.5" />
                    </div>
                ))}
            </div>

            <div className="mt-auto h-8 w-8 rounded-full bg-zinc-800 flex items-center justify-center border border-white/10">
                <span className="text-[9px] font-bold text-zinc-400">JD</span>
            </div>
        </div>
    );
}

function MockChatList() {
    return (
        <div className="hidden md:flex w-[310px] h-full flex-col border-r border-white/5 bg-[#030305]">
            <div className="p-5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-white tracking-tight leading-none pt-0.5">Inbox</h2>
                    <span className="flex items-center justify-center h-4.5 min-w-[18px] px-1 rounded-full bg-blue-500 text-[10px] font-bold text-white">12</span>
                </div>
                <div className="flex gap-3">
                    <Filter className="h-4 w-4 text-zinc-600 hover:text-white transition-colors cursor-pointer" />
                    <Plus className="h-4 w-4 text-zinc-600 hover:text-white transition-colors cursor-pointer" />
                </div>
            </div>

            <div className="px-5 mb-4">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-700" />
                    <input
                        type="text"
                        placeholder="Buscar conversa..."
                        readOnly
                        className="w-full bg-[#0D0D12] border border-white/5 rounded-xl py-2 pl-9 pr-4 text-[11px] text-zinc-500 focus:outline-none placeholder:text-zinc-800"
                    />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar">
                <div className="bg-[#111118] border-l-2 border-blue-500 p-4 relative cursor-pointer m-2 rounded-xl">
                    <div className="flex gap-3">
                        <MockAvatar fallback="AS" channel="whatsapp" className="h-10 w-10" />
                        <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-start mb-0.5">
                                <h4 className="text-[12px] font-bold text-white truncate">Ana Silva</h4>
                                <span className="text-[9px] text-zinc-600 font-medium">10:42</span>
                            </div>
                            <p className="text-[10px] text-zinc-400 truncate mb-2 leading-tight">Gostaria de saber mais sobre os planos...</p>
                            <div className="flex gap-1.5 flex-wrap">
                                <span className="text-[8px] font-bold text-blue-400 bg-blue-500/10 border border-blue-500/20 px-1.5 py-0.5 rounded-md">Em atendimento</span>
                                <span className="text-[8px] font-bold text-purple-400 bg-purple-500/10 border border-purple-500/20 px-1.5 py-0.5 rounded-md">Lead Quente</span>
                            </div>
                        </div>
                    </div>
                </div>

                {[
                    { name: 'Ricardo Mendes', text: 'Vou verificar com minha equipe e re...', time: '09:15', tag: 'Fila', channel: 'instagram' as const, tagColor: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', letters: 'RM' },
                    { name: 'João Lima', text: 'Obrigado pelo suporte!', time: 'Ontem', tag: 'Novo', channel: 'telegram' as const, tagColor: 'text-white/40 bg-white/5 border-white/10', letters: 'JL' }
                ].map((chat, i) => (
                    <div key={i} className="p-4 hover:bg-white/[0.02] transition-colors cursor-pointer group mx-2 rounded-xl">
                        <div className="flex gap-3">
                            <MockAvatar fallback={chat.letters} channel={chat.channel} className="h-10 w-10" />
                            <div className="flex-1 min-w-0">
                                <div className="flex justify-between items-start mb-0.5">
                                    <h4 className="text-[12px] font-bold text-zinc-400 group-hover:text-white transition-colors truncate">{chat.name}</h4>
                                    <span className="text-[9px] text-zinc-600 font-medium">{chat.time}</span>
                                </div>
                                <p className="text-[10px] text-zinc-500 truncate mb-2 leading-tight">{chat.text}</p>
                                <div className="flex gap-1.5">
                                    <span className={cn("text-[8px] font-bold px-1.5 py-0.5 rounded-md border", chat.tagColor)}>{chat.tag}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function MockChatArea() {
    return (
        <div className="flex-1 h-full flex flex-col bg-[#050507] relative overflow-hidden">
            <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[radial-gradient(#ffffff_1px,transparent_1px)] bg-[size:25px_25px]" />

            <div className="h-16 border-b border-white/5 bg-[#08080A] px-6 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                    <MockAvatar fallback="AS" className="h-9 w-9" status="online" />
                    <div>
                        <h3 className="font-bold text-white text-[13px] leading-tight">Ana Silva</h3>
                        <p className="text-[10px] text-zinc-500 font-medium">Online agora</p>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 bg-[#1A1A24] border border-white/5 px-2.5 py-1 rounded-full">
                        <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">STATUS</span>
                        <div className="w-px h-2.5 bg-white/10" />
                        <span className="text-[10px] font-bold text-blue-400">Em atendimento</span>
                    </div>
                    <MoreVertical className="h-4 w-4 text-zinc-600 hover:text-white cursor-pointer" />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
                <div className="flex justify-center">
                    <span className="text-[9px] font-bold text-zinc-600 bg-white/5 px-2.5 py-1 rounded-full tracking-tighter uppercase">Hoje</span>
                </div>

                <div className="flex gap-3 max-w-[85%]">
                    <MockAvatar fallback="AS" className="h-8 w-8" />
                    <div className="space-y-1">
                        <div className="bg-[#1A1A22] text-white p-3.5 rounded-2xl rounded-bl-none text-[12px] leading-relaxed shadow-sm border border-white/5">
                            Olá! Vi o anúncio no Instagram e gostaria de saber mais sobre os planos Enterprise.
                        </div>
                        <span className="text-[9px] text-zinc-600 font-medium ml-1">10:41</span>
                    </div>
                </div>

                <div className="flex flex-row-reverse gap-3 max-w-[85%] ml-auto">
                    <div className="h-8 w-8 rounded-full bg-blue-500 flex items-center justify-center text-[9px] font-bold text-white shrink-0 mt-auto shadow-lg shadow-blue-500/20">EU</div>
                    <div className="space-y-1">
                        <div className="bg-blue-600 text-white p-3.5 rounded-2xl rounded-br-none text-[12px] leading-relaxed shadow-xl">
                            Olá Ana! Claro, será um prazer ajudar com isso. Nossos planos Enterprise incluem suporte 24/7 e APIs ilimitadas.
                        </div>
                        <div className="flex justify-end items-center gap-1 mt-1">
                            <span className="text-[9px] text-zinc-600 font-medium">10:42</span>
                            <CheckCircle2 className="h-3 w-3 text-blue-400" />
                        </div>
                    </div>
                </div>

                <FadeIn delay={1} className="relative z-20 mx-auto max-w-[420px]">
                    <div className="relative group p-0.5 rounded-2xl bg-gradient-to-tr from-blue-500/20 via-purple-500/20 to-pink-500/20">
                        <div className="bg-[#0F0F16] border border-white/10 rounded-2xl p-4 shadow-2xl backdrop-blur-3xl">
                            <div className="flex items-center justify-between gap-4">
                                <div className="flex items-center gap-3">
                                    <div className="h-9 w-9 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-600/20">
                                        <Sparkles className="h-4.5 w-4.5 text-white" />
                                    </div>
                                    <div>
                                        <p className="text-[9px] font-bold text-blue-400 uppercase tracking-widest mb-0.5">SUGESTÃO DA IA</p>
                                        <p className="text-[12px] text-white font-medium">Gostaria de agendar uma demo?</p>
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <button className="h-8 w-8 rounded-lg bg-emerald-500 flex items-center justify-center text-white shadow-lg shadow-emerald-500/20 hover:scale-105 transition-transform"><Check className="h-4 w-4" /></button>
                                    <button className="h-8 w-8 rounded-lg bg-red-500 flex items-center justify-center text-white shadow-lg shadow-red-500/20 hover:scale-105 transition-transform"><X className="h-4 w-4" /></button>
                                </div>
                            </div>
                        </div>
                    </div>
                </FadeIn>
            </div>

            <div className="p-4 border-t border-white/5 bg-[#08080A]">
                <div className="relative">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2">
                        <Paperclip className="h-4 w-4 text-zinc-500 hover:text-white cursor-pointer" />
                    </div>
                    <input
                        type="text"
                        placeholder="Digite sua mensagem..."
                        className="w-full bg-[#111118] border border-white/5 rounded-xl py-3 pl-10 pr-20 text-[12px] text-white placeholder:text-zinc-700 focus:outline-none"
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2.5">
                        <Smile className="h-4 w-4 text-zinc-700 hover:text-white cursor-pointer" />
                        <Mic className="h-4 w-4 text-zinc-700 hover:text-white cursor-pointer" />
                    </div>
                </div>
            </div>
        </div>
    );
}

function MockCRM() {
    return (
        <div className="hidden lg:flex w-[280px] h-full flex-col border-l border-white/5 bg-[#050507] p-0 overflow-y-auto custom-scrollbar">
            <div className="flex items-center justify-between px-4 py-4 border-b border-white/5">
                <h3 className="text-sm font-bold text-white tracking-tight">Detalhes</h3>
                <button className="flex items-center gap-1 text-blue-500 text-[11px] font-bold hover:text-blue-400 transition-colors">
                    <Edit3 className="h-3.5 w-3.5" />
                    Editar
                </button>
            </div>

            <div className="flex flex-col items-center pt-8 pb-6 px-4">
                <div className="h-24 w-24 rounded-full border border-white/10 p-1 mb-4 shadow-2xl">
                    <div className="h-full w-full rounded-full bg-zinc-900 border border-white/5 flex items-center justify-center overflow-hidden">
                        <User className="h-10 w-10 text-zinc-700" />
                    </div>
                </div>
                <h3 className="text-lg font-bold text-white tracking-tight">Ana Silva</h3>
            </div>

            <div className="px-5 space-y-8 pb-10">
                <div>
                    <h4 className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest mb-4">INFORMAÇÕES DE CONTATO</h4>
                    <div className="space-y-5">
                        <div className="flex gap-3">
                            <div className="h-8 w-8 rounded-lg bg-blue-500/5 border border-white/5 flex items-center justify-center text-blue-500 shrink-0 shadow-sm"><Hash className="h-4 w-4" /></div>
                            <div>
                                <p className="text-[9px] text-zinc-500 font-bold uppercase mb-0.5">PROTOCOLO</p>
                                <p className="text-[10px] text-white font-medium leading-tight">PRT-A8278A2DD17F45ECAFF4FFF5F0167AAD</p>
                            </div>
                        </div>
                        <div className="flex gap-3 items-center">
                            <div className="h-8 w-8 rounded-lg bg-purple-500/5 border border-white/5 flex items-center justify-center text-purple-400 shrink-0 shadow-sm"><Instagram className="h-4 w-4" /></div>
                            <p className="text-[11px] text-white font-medium">@dialogyoficial <span className="text-zinc-600 text-[9px] ml-1">(Instagram)</span></p>
                        </div>
                        <div className="flex gap-3 items-center">
                            <div className="h-8 w-8 rounded-lg bg-blue-500/5 border border-white/5 flex items-center justify-center text-blue-400 shrink-0 shadow-sm"><User className="h-4 w-4" /></div>
                            <p className="text-[11px] text-white font-medium">ID externo: <span className="text-zinc-400 ml-1">1549389223036280</span></p>
                        </div>
                    </div>
                </div>

                <div className="w-full h-px bg-white/5 shadow-sm" />

                <div>
                    <h4 className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest mb-3">INFORMAÇÕES ADICIONAIS</h4>
                    <p className="text-[10px] text-zinc-600 italic">Nenhuma informação adicional preenchida.</p>
                </div>

                <div className="w-full h-px bg-white/5 shadow-sm" />

                <div>
                    <h4 className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest mb-4">ATENDENTE RESPONSÁVEL</h4>
                    <div className="bg-[#111118]/80 border border-white/5 rounded-xl p-5 flex flex-col items-center">
                        <p className="text-[11px] text-zinc-500 mb-4 font-medium text-center">Nenhum atendente atribuído.</p>
                        <button className="flex items-center gap-2 bg-white/5 border border-white/5 px-4 py-2 rounded-lg text-[11px] font-bold text-white hover:bg-white/10 transition-colors shadow-lg">
                            <ArrowLeftRight className="h-3.5 w-3.5" />
                            Transferir
                        </button>
                    </div>
                </div>

                <div className="w-full h-px bg-white/5 shadow-sm" />

                <div>
                    <h4 className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest mb-4">CRM & TAREFAS</h4>
                    <div className="bg-[#111118]/80 border border-white/5 rounded-xl p-3.5 flex items-center justify-between group cursor-pointer hover:border-blue-500/30 transition-colors">
                        <div className="flex items-center gap-3">
                            <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-500 group-hover:scale-110 transition-transform"><BarChart2 className="h-4 w-4" /></div>
                            <span className="text-[12px] font-bold text-white">Estatísticas</span>
                        </div>
                        <button className="bg-white/5 text-white text-[9px] font-bold px-3 py-1.5 rounded-md hover:bg-white/10 transition-colors">Ver</button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export function Hero() {
    const targetRef = useRef<HTMLDivElement>(null);
    const { scrollYProgress } = useScroll({
        target: targetRef,
        offset: ["start start", "end start"]
    });

    return (
        <SectionWrapper id="hero" className="pt-32 pb-20 md:pt-48 md:pb-32 overflow-visible" fullWidth>
            {/* Spotlight - HIDDEN on mobile for performance */}
            <div className="hidden md:block">
                <Spotlight className="-top-40 left-0 md:left-60 md:-top-20" fill="#19F5B2" />
            </div>

            {/* Mobile-friendly lightweight background glow */}
            <div className="absolute inset-0 pointer-events-none md:hidden">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[300px] h-[300px] bg-gradient-radial from-brand-green/20 to-transparent rounded-full opacity-60" />
                <div className="absolute top-20 right-0 w-[200px] h-[200px] bg-gradient-radial from-brand-blue/15 to-transparent rounded-full opacity-50" />
            </div>

            {/* Desktop: Full background effects */}
            <div className="absolute inset-0 pointer-events-none hidden md:block">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-brand-green/10 blur-[120px] rounded-full opacity-40 mix-blend-screen animate-pulse" />
                <div className="absolute top-1/4 left-1/4 w-[400px] h-[400px] bg-brand-blue/10 blur-[100px] rounded-full opacity-30 animate-float" />
                <div className="absolute inset-0 bg-[url('/grid.svg')] bg-center [mask-image:linear-gradient(180deg,white,rgba(255,255,255,0))]" style={{ opacity: 0.05 }} />
            </div>

            <div className="container-width relative z-10 flex flex-col items-center text-center" ref={targetRef}>

                {/* Badge */}
                <FadeIn delay={0.1}>
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 backdrop-blur-md mb-8 hover:border-brand-green/30 transition-colors cursor-default">
                        <span className="flex h-2 w-2 rounded-full bg-brand-green animate-pulse" />
                        <span className="text-xs font-medium text-gray-300">Nova geração de atendimento v2.0</span>
                    </div>
                </FadeIn>

                {/* Headline */}
                <FadeIn delay={0.2} className="max-w-4xl mx-auto">
                    <h1 className="text-5xl md:text-7xl lg:text-8xl font-bold tracking-tight text-white mb-6 leading-[1.1]">
                        Atenda <span className="text-transparent bg-clip-text bg-gradient-to-br from-brand-green to-brand-blue">tudo</span> num <br className="hidden md:block" /> só lugar.
                    </h1>
                </FadeIn>

                {/* Subhead */}
                <FadeIn delay={0.3} className="max-w-2xl mx-auto mb-10">
                    <p className="text-lg md:text-xl text-gray-400 font-light leading-relaxed">
                        A Dialogy centraliza WhatsApp, Instagram e Facebook com
                        <span className="text-white font-medium"> IA, automação e CRM </span>
                        para você responder mais rápido, vender mais e nunca perder um lead.
                    </p>
                </FadeIn>

                {/* CTA Buttons */}
                <FadeIn delay={0.4} className="flex flex-col sm:flex-row items-center gap-4 mb-24">
                    <a href="#pricing" className="w-full sm:w-auto">
                        <NeonButton rightIcon={<ArrowRight size={16} />} className="w-full min-w-[180px]">
                            Começar Agora
                        </NeonButton>
                    </a>
                    <a href="https://wa.me/551151994714" target="_blank" rel="noopener noreferrer" className="w-full sm:w-auto">
                        <NeonButton variant="secondary" leftIcon={<MessageCircle size={16} />} className="w-full min-w-[180px]">
                            Falar no WhatsApp
                        </NeonButton>
                    </a>
                </FadeIn>

                {/* High Fidelity 3D Dashboard Mockup - HIDDEN on mobile for performance */}
                <div className="relative mx-auto mt-16 max-w-6xl w-full hidden md:block">
                    <motion.div
                        style={{ opacity: 1 }}
                        className="relative z-10 overflow-hidden rounded-2xl border border-white/10 bg-[#0B0B10]/50 shadow-2xl backdrop-blur-2xl w-full"
                    >
                        {/* Fake Browser Header */}
                        <div className="flex h-10 items-center gap-2 border-b border-white/5 bg-[#0B0B10]/80 px-4">
                            <div className="flex gap-1.5">
                                <div className="h-2.5 w-2.5 rounded-full bg-red-500/20" />
                                <div className="h-2.5 w-2.5 rounded-full bg-yellow-500/20" />
                                <div className="h-2.5 w-2.5 rounded-full bg-green-500/20" />
                            </div>
                            <div className="ml-4 flex h-6 w-1/3 items-center rounded-md bg-white/5 px-3 text-[10px] text-zinc-600">
                                dialogy.ai/inbox
                            </div>
                        </div>

                        {/* App Dashboard Mockup - High Fidelity */}
                        <div className="flex h-[600px] w-full overflow-hidden">
                            {/* 1. Sidebar */}
                            <MockSidebar />

                            {/* 2. Chat List */}
                            <MockChatList />

                            {/* 3. Main Chat Area */}
                            <MockChatArea />

                            {/* 4. CRM/Profile Sidebar (Desktop Only) */}
                            <MockCRM />
                        </div>
                    </motion.div>

                    {/* Decorative Elements (Glows behind the app) */}
                    <div className="absolute -inset-4 -z-10 rounded-[2rem] bg-gradient-to-tr from-blue-600/20 to-purple-600/20 blur-3xl" />
                    <div className="absolute top-1/2 left-1/2 -z-10 h-[500px] w-[800px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500/10 blur-[100px]" />
                </div>

                {/* Clients/Trust Text */}
                <div className="mt-20">
                    <p className="text-sm text-gray-500 font-mono tracking-wider uppercase mb-6">Confiado por times modernos</p>
                </div>
            </div>
        </SectionWrapper>
    );
}
