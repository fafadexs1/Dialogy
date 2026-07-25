'use client';

import * as React from 'react';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { Infinity as InfinityIcon } from 'lucide-react';
import { Counter } from './effects';

const STATS = [
    { value: 7, suffix: '', label: 'canais nativos em um inbox só' },
    { value: 100, suffix: ' mil', label: 'conversas por mês no maior plano' },
    { value: 24, suffix: '/7', label: 'IA respondendo, inclusive de madrugada' },
];

export function SocialProof() {
    return (
        <section className="border-b border-slate-100 bg-white py-12 sm:py-16">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                <motion.p
                    initial={{ opacity: 0 }}
                    whileInView={{ opacity: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.5 }}
                    className="text-center text-xs font-black uppercase tracking-[0.22em] text-slate-400"
                >
                    Operações de telecom, saúde, varejo e serviços já rodam na Dialogy
                </motion.p>

                <div className="mt-8 flex flex-wrap items-center justify-center gap-x-16 gap-y-8">
                    <motion.div
                        initial={{ opacity: 0, scale: 0.94 }}
                        whileInView={{ opacity: 1, scale: 1 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.4 }}
                        className="opacity-45 transition-opacity duration-300 hover:opacity-80"
                    >
                        <Image
                            src="/ntelecom.png"
                            alt="Velpro Telecom"
                            width={200}
                            height={93}
                            className="h-11 w-auto object-contain [filter:brightness(0)]"
                        />
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, scale: 0.94 }}
                        whileInView={{ opacity: 1, scale: 1 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.4, delay: 0.1 }}
                        className="flex items-center gap-3 opacity-55 transition-opacity duration-300 hover:opacity-90"
                    >
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-base font-black text-white">
                            K
                        </span>
                        <span className="text-2xl font-extrabold tracking-tight text-slate-800">KlyraAi</span>
                    </motion.div>
                </div>

                {/* Platform numbers */}
                <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {STATS.map((stat, index) => (
                        <motion.div
                            key={stat.label}
                            initial={{ opacity: 0, y: 16 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true, margin: '-40px' }}
                            transition={{ duration: 0.4, delay: index * 0.08 }}
                            className="rounded-3xl border border-slate-200/80 bg-slate-50/60 p-6 text-center"
                        >
                            <p className="text-4xl font-black tracking-tight text-slate-900 sm:text-5xl">
                                <Counter to={stat.value} suffix={stat.suffix} />
                            </p>
                            <p className="mx-auto mt-2 max-w-[13rem] text-[0.88rem] font-medium leading-snug text-slate-500">
                                {stat.label}
                            </p>
                        </motion.div>
                    ))}

                    <motion.div
                        initial={{ opacity: 0, y: 16 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true, margin: '-40px' }}
                        transition={{ duration: 0.4, delay: 0.24 }}
                        className="rounded-3xl border border-brand-green/30 bg-gradient-to-br from-brand-green/20 to-emerald-50 p-6 text-center"
                    >
                        <p className="flex items-center justify-center text-4xl font-black tracking-tight text-slate-900 sm:text-5xl">
                            <InfinityIcon className="h-11 w-11" strokeWidth={2.5} />
                        </p>
                        <p className="mx-auto mt-2 max-w-[13rem] text-[0.88rem] font-bold leading-snug text-slate-700">
                            usuários ilimitados em todos os planos
                        </p>
                    </motion.div>
                </div>
            </div>
        </section>
    );
}
