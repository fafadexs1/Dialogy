'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChannelType } from '../types';
import { WhatsAppIcon, InstagramIcon, FacebookIcon, MercadoLivreIcon } from './ui/Icons';
import {
    MessageSquare, Zap, Activity, Globe, ShieldCheck,
    Cpu, Wifi, ChevronRight, BarChart2
} from 'lucide-react';

// Data Configuration
const channels = [
    {
        id: ChannelType.WHATSAPP,
        label: 'WhatsApp',
        icon: WhatsAppIcon,
        color: '#25D366',
        accent: 'from-green-500/20 to-green-900/5',
        glow: 'shadow-[0_0_50px_-10px_rgba(37,211,102,0.3)]',
        headline: 'O poder do WhatsApp Business API.',
        sub: 'Múltiplos atendentes em um único número. Automação de filas e chatbots ilimitados.',
        stats: { users: '2.4B', latency: '12ms', msgPerSec: '4.2k' }
    },
    {
        id: ChannelType.INSTAGRAM,
        label: 'Instagram',
        icon: InstagramIcon,
        color: '#E1306C',
        accent: 'from-pink-500/20 to-purple-900/5',
        glow: 'shadow-[0_0_50px_-10px_rgba(225,48,108,0.3)]',
        headline: 'Converta Directs em Vendas.',
        sub: 'Responda mentions, stories e directs em uma única tela. Recupere vendas perdidas automaticamente.',
        stats: { users: '1.8B', latency: '18ms', msgPerSec: '2.8k' }
    },
    {
        id: ChannelType.FACEBOOK,
        label: 'Facebook',
        icon: FacebookIcon,
        color: '#1877F2',
        accent: 'from-blue-500/20 to-blue-900/5',
        glow: 'shadow-[0_0_50px_-10px_rgba(24,119,242,0.3)]',
        headline: 'Messenger Unificado.',
        sub: 'Centralize todo o histórico de conversas do Facebook e integre com seus anúncios.',
        stats: { users: '2.9B', latency: '15ms', msgPerSec: '1.5k' }
    },
    {
        id: ChannelType.MERCADO_LIVRE,
        label: 'Mercado Livre',
        icon: MercadoLivreIcon,
        color: '#FFE600',
        accent: 'from-yellow-400/20 to-yellow-900/5',
        glow: 'shadow-[0_0_50px_-10px_rgba(255,230,0,0.3)]',
        headline: 'Domine o Marketplace.',
        sub: 'Responda perguntas de pré-venda em segundos e gerencie o pós-venda sem sair da tela.',
        stats: { users: '140M', latency: '22ms', msgPerSec: '890' }
    },
];

export function Omnichannel() {
    const [active, setActive] = useState(0);
    const activeData = channels[active];

    return (
        <section id="omnichannel" className="py-32 bg-black relative overflow-hidden min-h-[900px] flex items-center">

            {/* Dynamic Ambient Background */}
            <AnimatePresence mode="wait">
                <motion.div
                    key={active}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 1 }}
                    className="absolute inset-0 z-0"
                >
                    <div className={`absolute top-0 right-0 w-[800px] h-[800px] bg-gradient-radial ${activeData.accent} blur-[120px] opacity-40 rounded-full translate-x-1/3 -translate-y-1/4`} />
                    <div className={`absolute bottom-0 left-0 w-[600px] h-[600px] bg-gradient-radial ${activeData.accent} blur-[100px] opacity-20 rounded-full -translate-x-1/3 translate-y-1/4`} />
                </motion.div>
            </AnimatePresence>

            {/* Grid Pattern Overlay */}
            <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-[0.03] z-[1]"></div>
            <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:40px_40px] opacity-20 z-[1]"></div>

            <div className="max-w-7xl mx-auto px-4 md:px-8 relative z-10 w-full">

                {/* Header Content */}
                <div className="flex flex-col md:flex-row items-end justify-between mb-16 gap-8">
                    <div className="max-w-2xl">
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            className="flex items-center gap-2 mb-4"
                        >
                            <div className="px-3 py-1 rounded-full border border-white/10 bg-white/5 backdrop-blur-md flex items-center gap-2">
                                <Globe size={14} className="text-gray-400" />
                                <span className="text-xs font-mono text-gray-300 uppercase tracking-widest">Global Connect v2.0</span>
                            </div>
                        </motion.div>

                        <h2 className="text-5xl md:text-7xl font-bold text-white tracking-tight leading-[0.95] mb-6">
                            Todos os canais. <br />
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-white via-gray-400 to-gray-600">
                                Uma única verdade.
                            </span>
                        </h2>
                        <p className="text-lg text-gray-400 max-w-lg leading-relaxed">
                            Elimine as abas do navegador. Centralize WhatsApp, Instagram, Facebook e Mercado Livre em uma interface de elite desenhada para velocidade.
                        </p>
                    </div>

                    {/* Selector Tabs */}
                    <div className="flex flex-wrap gap-3">
                        {channels.map((channel, idx) => (
                            <button
                                key={channel.id}
                                onClick={() => setActive(idx)}
                                className={`relative group px-6 py-4 rounded-xl border transition-all duration-300 flex flex-col items-center gap-2 min-w-[100px] ${active === idx
                                    ? 'bg-white/10 border-white/20 shadow-[0_0_30px_-5px_rgba(255,255,255,0.1)]'
                                    : 'bg-black/40 border-white/5 hover:bg-white/5 hover:border-white/10'
                                    }`}
                            >
                                <div
                                    className={`transition-all duration-500 ${active === idx ? 'scale-110' : 'grayscale group-hover:grayscale-0'}`}
                                    style={{ color: active === idx ? channel.color : '#6b7280' }}
                                >
                                    <channel.icon className="w-8 h-8" />
                                </div>
                                <span className={`text-xs font-medium tracking-wide ${active === idx ? 'text-white' : 'text-gray-500'}`}>
                                    {channel.label}
                                </span>

                                {/* Active Indicator Line */}
                                {active === idx && (
                                    <motion.div
                                        layoutId="activeTab"
                                        className="absolute bottom-0 left-0 w-full h-[2px]"
                                        style={{ backgroundColor: channel.color }}
                                    />
                                )}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Main Interface Showcase */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">

                    {/* Left Column: Dynamic Info */}
                    <div className="lg:col-span-5 order-2 lg:order-1 space-y-8">
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={active}
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 20 }}
                                transition={{ duration: 0.4 }}
                            >
                                <div className="inline-flex items-center gap-2 text-xs font-bold font-mono mb-4" style={{ color: activeData.color }}>
                                    <Activity size={14} /> SYSTEM STATUS: ONLINE
                                </div>
                                <h3 className="text-3xl md:text-4xl font-bold text-white mb-4">
                                    {activeData.headline}
                                </h3>
                                <p className="text-gray-400 text-lg leading-relaxed mb-8 border-l-2 border-white/10 pl-6">
                                    {activeData.sub}
                                </p>

                                {/* Live Stats Grid */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="p-4 bg-white/[0.03] border border-white/5 rounded-xl">
                                        <div className="flex items-center gap-2 text-gray-500 text-xs uppercase font-bold mb-2">
                                            <Cpu size={14} /> Latência Média
                                        </div>
                                        <div className="text-2xl font-mono text-white flex items-baseline gap-1">
                                            {activeData.stats.latency} <span className="text-xs text-green-500">▼ 2%</span>
                                        </div>
                                    </div>
                                    <div className="p-4 bg-white/[0.03] border border-white/5 rounded-xl">
                                        <div className="flex items-center gap-2 text-gray-500 text-xs uppercase font-bold mb-2">
                                            <BarChart2 size={14} /> Throughput
                                        </div>
                                        <div className="text-2xl font-mono text-white flex items-baseline gap-1">
                                            {activeData.stats.msgPerSec} <span className="text-xs text-gray-600">/seg</span>
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        </AnimatePresence>

                        <button className="group flex items-center gap-3 text-white font-semibold mt-8 hover:text-dialogy-teal transition-colors">
                            Ver documentação da API <ChevronRight size={18} className="group-hover:translate-x-1 transition-transform" />
                        </button>
                    </div>

                    {/* Right Column: 3D Interface Mockup */}
                    <div className="lg:col-span-7 order-1 lg:order-2 perspective-1000 relative">
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={active}
                                initial={{ opacity: 0, rotateY: 10, z: -50 }}
                                animate={{ opacity: 1, rotateY: -5, z: 0 }}
                                exit={{ opacity: 0, rotateY: -10, z: -50 }}
                                transition={{ type: "spring", stiffness: 100, damping: 20 }}
                                className={`relative rounded-2xl overflow-hidden bg-[#0B0B10] border border-white/10 ${activeData.glow} shadow-2xl`}
                            >
                                {/* App Header */}
                                <div className="h-14 bg-black/40 border-b border-white/5 flex items-center justify-between px-6 backdrop-blur-xl">
                                    <div className="flex items-center gap-3">
                                        <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/50"></div>
                                        <div className="w-3 h-3 rounded-full bg-yellow-500/20 border border-yellow-500/50"></div>
                                        <div className="w-3 h-3 rounded-full bg-green-500/20 border border-green-500/50"></div>
                                    </div>
                                    <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-mono text-gray-400">
                                        <ShieldCheck size={12} /> Encrypted
                                    </div>
                                </div>

                                {/* App Body */}
                                <div className="flex h-[450px]">
                                    {/* Sidebar */}
                                    <div className="w-20 border-r border-white/5 bg-black/20 flex flex-col items-center py-6 gap-6">
                                        <div className="p-2 rounded-lg bg-white/5 text-white"><MessageSquare size={20} /></div>
                                        <div className="p-2 rounded-lg text-gray-600"><Zap size={20} /></div>
                                        <div className="mt-auto p-2 rounded-lg text-gray-600"><Wifi size={20} /></div>
                                    </div>

                                    {/* Chat List */}
                                    <div className="w-64 border-r border-white/5 bg-black/10 hidden sm:block">
                                        {[1, 2, 3, 4].map((i) => (
                                            <div key={i} className="p-4 border-b border-white/5 flex gap-3 items-center opacity-60 hover:opacity-100 transition-opacity">
                                                <div className="w-10 h-10 rounded-full bg-white/5"></div>
                                                <div className="space-y-2 flex-1">
                                                    <div className="h-2 w-16 bg-white/10 rounded"></div>
                                                    <div className="h-2 w-24 bg-white/5 rounded"></div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Active Chat Area */}
                                    <div className="flex-1 bg-[#050507] p-6 relative flex flex-col">
                                        {/* Background Logo Watermark */}
                                        <div className="absolute inset-0 flex items-center justify-center opacity-[0.02] pointer-events-none">
                                            <activeData.icon className="w-48 h-48" />
                                        </div>

                                        <div className="flex-1 space-y-6">
                                            {/* Messages */}
                                            <div className="flex justify-start">
                                                <div className="bg-[#1F1F23] p-4 rounded-2xl rounded-tl-none border border-white/10 max-w-[80%]">
                                                    <p className="text-gray-300 text-sm">
                                                        {active === 3 ? "Olá, vocês emitem nota fiscal para PJ?" : "Gostaria de saber os planos disponíveis."}
                                                    </p>
                                                    <div className="flex items-center gap-2 mt-2">
                                                        <activeData.icon className="w-3 h-3 text-gray-500" />
                                                        <span className="text-[10px] text-gray-600 font-mono">14:02</span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex justify-end">
                                                <div className="relative overflow-hidden p-4 rounded-2xl rounded-tr-none max-w-[80%]" style={{ backgroundColor: `${activeData.color}15`, borderColor: `${activeData.color}30`, borderWidth: '1px' }}>
                                                    <p className="text-white text-sm relative z-10">
                                                        {active === 3 ? "Sim! Emitimos NF para todos os produtos automaticamente." : "Claro! Temos planos a partir de R$ 97. Vou te enviar o PDF."}
                                                    </p>
                                                    <div className="text-[10px] mt-2 text-right opacity-70 font-mono flex justify-end gap-1 items-center">
                                                        via Dialogy AI <Zap size={10} />
                                                    </div>
                                                    {/* Scanline Effect */}
                                                    <motion.div
                                                        initial={{ top: '-100%' }}
                                                        animate={{ top: '200%' }}
                                                        transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                                                        className="absolute left-0 w-full h-10 bg-gradient-to-b from-transparent via-white/10 to-transparent pointer-events-none"
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Input Mock */}
                                        <div className="mt-4 p-3 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between">
                                            <div className="text-xs text-gray-500 font-mono">Digite sua mensagem...</div>
                                            <div className="w-6 h-6 rounded bg-white/10 flex items-center justify-center">
                                                <div className="w-3 h-3 border-t-2 border-r-2 border-white/30 rotate-45"></div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        </AnimatePresence>

                        {/* Floating Elements (Decorations) */}
                        <motion.div
                            animate={{ y: [0, -10, 0] }}
                            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                            className="absolute -right-8 -top-8 p-4 bg-black/80 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl z-20 hidden md:block"
                        >
                            <div className="flex items-center gap-3">
                                <div className="relative">
                                    <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                                    <div className="absolute inset-0 bg-green-500 rounded-full animate-ping opacity-20"></div>
                                </div>
                                <div className="text-xs font-bold text-white">API CONNECTED</div>
                            </div>
                        </motion.div>
                    </div>

                </div>
            </div>
        </section>
    );
}
