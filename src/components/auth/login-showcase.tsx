'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, Globe, Mail, MessageCircle, MessageCircleMore } from 'lucide-react';
import { WhatsAppIcon, InstagramIcon, FacebookIcon } from '../landing/sections/ui/Icons';

export function LoginShowcase() {
    const orbits = [
        { icon: <WhatsAppIcon className="text-emerald-500" size={18} />, radius: 70, duration: 18, delay: 0 },
        { icon: <InstagramIcon className="text-pink-500" size={18} />, radius: 70, duration: 18, delay: 6 },
        { icon: <FacebookIcon className="text-blue-600" size={18} />, radius: 70, duration: 18, delay: 12 },
        { icon: <Mail className="text-blue-400" size={16} />, radius: 100, duration: 25, delay: 3 },
        { icon: <Globe className="text-indigo-400" size={16} />, radius: 100, duration: 25, delay: 11 },
        { icon: <MessageCircle className="text-[#20E401]" size={16} />, radius: 100, duration: 25, delay: 19 },
    ];

    return (
        <div className="relative hidden h-full flex-col items-center justify-between overflow-hidden bg-[linear-gradient(180deg,#fbfaf6_0%,#f4efe4_100%)] p-10 lg:flex">
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(15,23,42,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.025)_1px,transparent_1px)] bg-[size:28px_28px] opacity-30" />
            <div className="pointer-events-none absolute left-1/2 top-[42%] h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#20E401]/8 blur-[120px]" />

            <div className="z-10 w-full text-left">
                <motion.div
                    initial={{ opacity: 0, y: 18 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 }}
                    className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/80 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600 shadow-[0_16px_36px_-28px_rgba(15,23,42,0.35)]"
                >
                    Workspace omnichannel
                </motion.div>
                <motion.h2
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="mb-3 mt-6 max-w-md text-3xl font-semibold tracking-tight text-slate-950"
                >
                    Atendimento centralizado para equipes que precisam de contexto.
                </motion.h2>
                <motion.p
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    className="max-w-md text-sm leading-7 text-slate-500"
                >
                    Retome conversas, acompanhe prioridades e mantenha o time alinhado em uma unica operacao.
                </motion.p>
            </div>

            <div className="relative flex h-[260px] w-[260px] items-center justify-center">
                <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="relative z-20 flex h-24 w-24 items-center justify-center rounded-full border border-black/10 bg-white shadow-[0_28px_70px_-38px_rgba(15,23,42,0.38)]"
                >
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#08110d]">
                        <MessageCircleMore className="h-7 w-7 text-[#20E401]" />
                    </div>
                    <div className="absolute inset-0 rounded-full border border-[#20E401]/15" />
                </motion.div>

                <div className="absolute h-[150px] w-[150px] rounded-full border border-black/10" />
                <div className="absolute h-[220px] w-[220px] rounded-full border border-black/10" />

                {orbits.map((orbit, index) => (
                    <motion.div
                        key={index}
                        className="absolute"
                        animate={{ rotate: 360 }}
                        transition={{
                            duration: orbit.duration,
                            repeat: Infinity,
                            ease: 'linear',
                            delay: -orbit.delay,
                        }}
                        style={{
                            width: orbit.radius * 2,
                            height: orbit.radius * 2,
                        }}
                    >
                        <motion.div
                            className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-black/10 bg-white p-3 shadow-[0_18px_34px_-28px_rgba(15,23,42,0.28)]"
                            animate={{ rotate: -360 }}
                            transition={{
                                duration: orbit.duration,
                                repeat: Infinity,
                                ease: 'linear',
                                delay: -orbit.delay,
                            }}
                        >
                            <div className="animate-pulse">
                                {orbit.icon}
                            </div>
                        </motion.div>
                    </motion.div>
                ))}
            </div>

            <div className="z-10 w-full rounded-[28px] border border-black/10 bg-white/80 p-5 shadow-[0_18px_50px_-36px_rgba(15,23,42,0.3)]">
                <motion.div
                    initial={{ opacity: 0, y: 18 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.45 }}
                >
                    <p className="text-sm font-semibold text-slate-950">O que voce encontra ao entrar</p>
                    <div className="mt-4 space-y-3">
                        {[
                            'Fila organizada por prioridade e responsavel.',
                            'Historico e contexto visiveis no mesmo inbox.',
                            'Sugestoes de IA para acelerar sem perder controle.',
                        ].map((item) => (
                            <div key={item} className="flex items-start gap-3 text-sm leading-6 text-slate-600">
                                <CheckCircle2 className="mt-0.5 h-4.5 w-4.5 shrink-0 text-[#20E401]" />
                                {item}
                            </div>
                        ))}
                    </div>
                </motion.div>
            </div>
        </div>
    );
}
