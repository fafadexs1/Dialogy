"use client";

import {
    Bot,
    Mail,
    MessageCircle,
    MessageSquare,
    Phone,
    Send,
    Sparkles,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useIsMobile } from '@/hooks/use-mobile';

import { FacebookIcon, InstagramIcon, MercadoLivreIcon, WhatsAppIcon } from './ui/Icons';

const channelCards = [
    { className: 'bg-emerald-500 text-white shadow-[0_16px_34px_-20px_rgba(16,185,129,0.7)]', icon: <WhatsAppIcon className="h-6 w-6" />, label: 'WhatsApp' },
    { className: 'bg-white text-pink-500 shadow-[0_16px_34px_-20px_rgba(236,72,153,0.35)]', icon: <InstagramIcon className="h-5 w-5" />, label: 'Instagram' },
    { className: 'bg-blue-600 text-white shadow-[0_16px_34px_-20px_rgba(37,99,235,0.7)]', icon: <FacebookIcon className="h-5 w-5" />, label: 'Facebook' },
    { className: 'bg-amber-400 text-slate-900 shadow-[0_16px_34px_-20px_rgba(251,191,36,0.65)]', icon: <MercadoLivreIcon className="h-5 w-5" />, label: 'Mercado Livre' },
    { className: 'bg-white text-slate-700 shadow-[0_16px_34px_-20px_rgba(15,23,42,0.18)]', icon: <Mail className="h-5 w-5" />, label: 'E-mail' },
    { className: 'bg-white text-sky-500 shadow-[0_16px_34px_-20px_rgba(14,165,233,0.35)]', icon: <MessageSquare className="h-5 w-5" />, label: 'Chat' },
    { className: 'bg-white text-cyan-500 shadow-[0_16px_34px_-20px_rgba(6,182,212,0.35)]', icon: <Send className="h-5 w-5" />, label: 'Envios' },
    { className: 'bg-indigo-500 text-white shadow-[0_16px_28px_-18px_rgba(99,102,241,0.6)]', icon: <Phone className="h-4.5 w-4.5" />, label: 'Voz' },
    { className: 'bg-brand-green text-slate-950 shadow-[0_16px_28px_-18px_rgba(25,245,178,0.6)]', icon: <Sparkles className="h-4.5 w-4.5" />, label: 'IA' },
    { className: 'bg-violet-600 text-white shadow-[0_16px_28px_-18px_rgba(124,58,237,0.6)]', icon: <Bot className="h-4.5 w-4.5" />, label: 'Bot' },
    { className: 'bg-white text-slate-700 shadow-[0_16px_34px_-20px_rgba(15,23,42,0.18)]', icon: <MessageCircle className="h-5 w-5" />, label: 'Inbox' },
];

export const OmnichannelOrbit = () => {
    const isMobile = useIsMobile();
    const introMotionProps = {
        initial: { opacity: 0, y: 30 },
        whileInView: { opacity: 1, y: 0 },
        viewport: { once: true, margin: "-100px" },
        transition: { duration: 0.7, ease: "easeOut" },
    };
    const panelMotionProps = {
        initial: { opacity: 0, y: 40 },
        whileInView: { opacity: 1, y: 0 },
        viewport: { once: true, margin: "-100px" },
        transition: { duration: 0.8, delay: 0.2, ease: "easeOut" },
    };
    const channelMotionProps = (index: number) => ({
        initial: { opacity: 0, scale: 0.8 },
        whileInView: { opacity: 1, scale: 1 },
        viewport: { once: true },
        transition: { duration: 0.4, delay: 0.3 + index * 0.05 },
    });

    return (
        <section
            id="omnichannel"
            className="relative overflow-hidden border-b border-zinc-100 bg-[#F9FAFB] py-24 md:py-32"
        >
            <div className="pointer-events-none absolute inset-0">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(25,245,178,0.08),transparent_34%),linear-gradient(180deg,#f9fafb_0%,#f5f7fb_100%)]" />
                <div className="absolute left-[5%] top-10 hidden h-80 w-80 rounded-full bg-blue-100/40 blur-[120px] md:block" />
                <div className="absolute bottom-0 right-[5%] hidden h-96 w-96 rounded-full bg-sky-200/25 blur-[140px] md:block" />
            </div>

            <div className="relative z-10 mx-auto max-w-[1400px]">
                <motion.div 
                    {...introMotionProps}
                    className="mx-auto max-w-4xl px-4 text-center sm:px-6"
                >
                    <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-zinc-200/60 bg-white/95 px-4 py-2 text-xs font-bold uppercase tracking-[0.15em] text-zinc-600 shadow-sm md:bg-white/80 md:backdrop-blur-md">
                        Plataforma Omnichannel
                    </div>

                    <h2 className="mb-6 text-4xl font-extrabold leading-[1.1] tracking-tighter text-zinc-900 md:text-6xl lg:text-7xl">
                        Atenda clientes em <br className="hidden md:block" />
                        todos os <span className="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">canais.</span>
                    </h2>

                    <p className="mx-auto max-w-2xl text-lg font-medium leading-relaxed text-zinc-500 md:text-xl">
                        Conecte WhatsApp, Instagram, Facebook e ferramentas proprietárias em um único inbox ultra-rápido.
                    </p>
                </motion.div>

                <motion.div 
                    {...panelMotionProps}
                    className="relative mx-auto mt-16 max-w-6xl rounded-[32px] border border-black/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.99)_0%,rgba(250,250,252,0.99)_100%)] p-6 shadow-[0_24px_60px_-24px_rgba(15,23,42,0.14)] ring-1 ring-zinc-900/5 md:mt-24 md:rounded-[48px] md:p-12 md:shadow-[0_40px_100px_-20px_rgba(15,23,42,0.15)] md:backdrop-blur-3xl lg:p-16"
                >
                    <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(15,23,42,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.02)_1px,transparent_1px)] bg-[size:40px_40px] opacity-30" />
                    
                    <div className="relative z-10 grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
                        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                            {channelCards.map((item, index) => (
                                <motion.div
                                    key={item.label}
                                    {...channelMotionProps(index)}
                                    className="group flex cursor-default items-center gap-3 rounded-2xl border border-zinc-200/50 bg-white px-4 py-3 text-left shadow-[0_8px_30px_rgb(0,0,0,0.04)] transition-colors md:transition-all md:hover:bg-zinc-50 md:hover:shadow-[0_16px_30px_-10px_rgba(15,23,42,0.15)]"
                                >
                                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-black/5 md:transition-transform md:group-hover:scale-110 ${item.className}`}>
                                        {item.icon}
                                    </div>
                                    <span className="text-sm font-bold text-zinc-700">{item.label}</span>
                                </motion.div>
                            ))}
                        </div>

                        <div className="overflow-hidden rounded-[32px] border border-zinc-800 bg-zinc-950 p-8 text-left text-white shadow-[0_32px_80px_-20px_rgba(0,0,0,0.8)] md:p-10 lg:p-12">
                            <div className="mb-8 flex h-24 w-24 items-center justify-center rounded-3xl bg-zinc-900 ring-1 ring-inset ring-white/10 shadow-inner">
                                <span className="text-5xl font-black tracking-tighter text-white">
                                    D<span className="text-blue-500">.</span>
                                </span>
                            </div>
                            <div className="space-y-6">
                                <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-400">
                                    Um Inbox. Dados unificados.
                                </p>
                                <h3 className="text-3xl font-extrabold tracking-tight md:text-4xl lg:text-5xl">
                                    Adeus abas. Olá contexto.
                                </h3>
                                <p className="text-base font-medium leading-relaxed text-zinc-400 md:text-lg">
                                    A operação comercial enxerga histórico, prioridade e próxima ação sem recarregar widgets pesados.
                                </p>
                                <div className="flex flex-wrap gap-2 pt-4">
                                    {['Fila Única', 'Roteamento IA', 'Contexto Persistente'].map((badge) => (
                                        <span
                                            key={badge}
                                            className="rounded-full border border-zinc-800 bg-zinc-900 px-4 py-2 text-xs font-semibold text-zinc-300 shadow-sm"
                                        >
                                            {badge}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </motion.div>
            </div>
        </section>
    );
};
