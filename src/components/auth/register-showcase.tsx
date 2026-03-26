'use client';

import React from 'react';
import { motion } from 'framer-motion';
import {
    BarChart3,
    CheckCircle2,
    Rocket,
    Target,
    TrendingUp,
    Users,
    Zap,
} from 'lucide-react';

export function RegisterShowcase() {
    const orbits = [
        { icon: <TrendingUp className="text-[#20E401]" size={18} />, radius: 70, duration: 20, delay: 0 },
        { icon: <Zap className="text-amber-500" size={18} />, radius: 70, duration: 20, delay: 6.6 },
        { icon: <Target className="text-rose-500" size={18} />, radius: 70, duration: 20, delay: 13.3 },
        { icon: <Users className="text-sky-500" size={16} />, radius: 100, duration: 28, delay: 4 },
        { icon: <BarChart3 className="text-indigo-500" size={16} />, radius: 100, duration: 28, delay: 14 },
        { icon: <Rocket className="text-orange-500" size={16} />, radius: 100, duration: 28, delay: 24 },
    ];

    return (
        <div className="relative hidden h-full flex-col items-center justify-between overflow-hidden rounded-r-[2.5rem] border-l border-black/10 bg-[linear-gradient(180deg,#fbfaf6_0%,#f4efe4_100%)] p-10 lg:flex">
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(15,23,42,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.025)_1px,transparent_1px)] bg-[size:28px_28px] opacity-30" />
            <div className="pointer-events-none absolute left-1/2 top-[42%] h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#20E401]/8 blur-[120px]" />

            <div className="z-10 w-full text-left">
                <motion.div
                    initial={{ opacity: 0, y: 18 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 }}
                    className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/80 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600 shadow-[0_16px_36px_-28px_rgba(15,23,42,0.35)]"
                >
                    Crescimento organizado
                </motion.div>
                <motion.h2
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="mb-3 mt-6 max-w-md text-3xl font-semibold tracking-tight text-slate-950"
                >
                    Comece com uma base limpa para escalar atendimento e vendas.
                </motion.h2>
                <motion.p
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    className="max-w-md text-sm leading-7 text-slate-500"
                >
                    Configure sua operação, organize o time e entre já com o ambiente pronto para atender com contexto.
                </motion.p>
            </div>

            <div className="relative flex h-[260px] w-[260px] items-center justify-center">
                <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="relative z-20 flex h-24 w-24 items-center justify-center rounded-full border border-black/10 bg-white shadow-[0_28px_70px_-38px_rgba(15,23,42,0.38)]"
                >
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#08110d]">
                        <TrendingUp className="h-7 w-7 text-[#20E401]" />
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
                            {orbit.icon}
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
                    <p className="text-sm font-semibold text-slate-950">O que voce configura ao entrar</p>
                    <div className="mt-4 space-y-3">
                        {[
                            'Estrutura inicial do workspace e equipe.',
                            'Base pronta para atendimento, comercial e automacoes.',
                            'Mais clareza para crescer sem virar operacao improvisada.',
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
