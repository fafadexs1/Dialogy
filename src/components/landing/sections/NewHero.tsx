"use client";

import { ArrowRight, BarChart3, ChevronRight, MessageCircle, Play, Users } from 'lucide-react';
import { motion } from 'framer-motion';

const fadeUpVariants = {
    hidden: { opacity: 0, y: 30 },
    visible: (i: number) => ({
        opacity: 1,
        y: 0,
        transition: {
            delay: i * 0.15,
            duration: 0.8,
            ease: [0.16, 1, 0.3, 1],
        },
    }),
};

export const NewHero = () => {
    return (
        <section className="relative overflow-hidden bg-white pb-16 pt-24 text-zinc-900 md:pb-24 md:pt-36 lg:pb-32 lg:pt-48">
            <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
                <motion.div 
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 2, ease: "easeOut" }}
                    className="absolute left-[50%] top-[-20%] h-[400px] w-[800px] -translate-x-1/2 rounded-full bg-blue-100/40 blur-[100px] lg:h-[600px] lg:w-[1000px] lg:blur-[140px]" 
                />
                <div
                    className="absolute inset-0 opacity-[0.015]"
                    style={{
                        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
                        backgroundSize: '150px 150px',
                    }}
                />
            </div>

            <div className="relative z-10 mx-auto flex w-full max-w-[1280px] flex-col items-center px-4 text-center sm:px-6">
                <motion.div 
                    custom={0} initial="hidden" animate="visible" variants={fadeUpVariants}
                    className="mb-8 inline-flex items-center gap-2.5 rounded-full border border-zinc-200/80 bg-white/80 px-4 py-2 text-zinc-800 shadow-sm backdrop-blur-md md:mb-10 hover:border-zinc-300 transition-colors cursor-default"
                >
                    <span className="relative flex h-2.5 w-2.5 items-center justify-center">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-green opacity-75" />
                        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand-green" />
                    </span>
                    <span className="text-sm font-semibold tracking-tight">Evolução do Customer Engagement</span>
                </motion.div>

                <motion.h1 
                    custom={1} initial="hidden" animate="visible" variants={fadeUpVariants}
                    className="mb-8 max-w-5xl text-5xl font-extrabold leading-[1.05] tracking-tighter text-zinc-900 sm:text-6xl md:mb-8 md:text-7xl lg:text-[88px]"
                >
                    Orquestre suporte e <br className="hidden md:block" />
                    vendas em <span className="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">alta escala</span>.
                </motion.h1>

                <motion.p 
                    custom={2} initial="hidden" animate="visible" variants={fadeUpVariants}
                    className="mb-12 max-w-3xl text-lg font-medium leading-relaxed text-zinc-500 sm:text-xl md:mb-16 md:text-2xl"
                >
                    Centralize WhatsApp, Instagram e Messenger. Qualifique milhares de leads com IA de forma invisível, deixando sua equipe focar apenas no fechamento.
                </motion.p>

                <motion.div 
                    custom={3} initial="hidden" animate="visible" variants={fadeUpVariants}
                    className="mb-16 flex w-full flex-col items-center justify-center gap-4 sm:w-auto sm:flex-row md:mb-24 lg:gap-6"
                >
                    <a
                        href="/register"
                        className="group relative inline-flex w-full items-center justify-center overflow-hidden rounded-full bg-zinc-900 px-8 py-4 text-base font-semibold text-white shadow-[0_8px_30px_rgb(0,0,0,0.12)] transition-all duration-300 hover:-translate-y-1 hover:bg-zinc-800 hover:shadow-[0_12px_40px_rgb(0,0,0,0.2)] active:translate-y-0 sm:w-auto sm:text-lg"
                    >
                        <span className="relative z-10 flex items-center gap-2">
                            Começar agora gratuitamente
                            <ArrowRight className="h-5 w-5 transition-transform duration-300 group-hover:translate-x-1" />
                        </span>
                    </a>

                    <a
                        href="#demo"
                        className="group inline-flex w-full items-center justify-center rounded-full border-2 border-zinc-200 bg-transparent px-8 py-4 text-base font-semibold text-zinc-800 transition-all duration-300 hover:-translate-y-1 hover:border-zinc-300 hover:bg-zinc-50 sm:w-auto sm:text-lg"
                    >
                        <Play className="mr-2 h-4 w-4 fill-zinc-800 transition-transform duration-300 group-hover:scale-110" />
                        Ver Demonstração
                    </a>
                </motion.div>

                <motion.div 
                    custom={4} initial="hidden" animate="visible" variants={fadeUpVariants}
                    className="group relative mx-auto w-full max-w-5xl perspective-1000"
                >
                    <div className="absolute -inset-4 z-0 hidden rounded-[3rem] bg-gradient-to-b from-blue-500/10 to-transparent opacity-0 blur-3xl transition-opacity duration-1000 group-hover:opacity-100 md:block" />

                    <div className="relative z-10 flex flex-col overflow-hidden rounded-[24px] border border-zinc-200/60 bg-white/70 shadow-[0_40px_100px_-20px_rgba(15,23,42,0.15)] ring-1 ring-zinc-900/5 backdrop-blur-2xl transition-transform duration-700 ease-out hover:scale-[1.01] sm:rounded-[32px]">
                        <div className="flex items-center justify-between border-b border-zinc-200/60 bg-white/50 px-4 py-3 sm:px-5 sm:py-4">
                            <div className="flex gap-2">
                                <div className="h-3 w-3 rounded-full bg-rose-400/80" />
                                <div className="h-3 w-3 rounded-full bg-amber-400/80" />
                                <div className="h-3 w-3 rounded-full bg-emerald-400/80" />
                            </div>
                            <div className="hidden rounded-lg bg-zinc-100/50 px-3 py-1.5 text-xs font-medium text-zinc-500 shadow-inner sm:flex">
                                dialogy.app/workspace/inbox
                            </div>
                            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-500 sm:w-16 sm:justify-end">
                                <span className="rounded-full bg-emerald-100/50 px-2.5 py-1 text-emerald-700">Online</span>
                            </div>
                        </div>

                        <div className="flex h-[320px] bg-zinc-50/30 text-left sm:h-[400px] md:h-[540px]">
                            {/* Sidebar Mockup */}
                            <div className="hidden w-16 flex-col gap-2 border-r border-zinc-200/60 bg-white/40 p-4 md:flex md:w-[260px]">
                                <div className="mb-2 hidden px-2 text-xs font-bold uppercase tracking-wider text-zinc-400 md:flex">Views</div>
                                <div className="flex items-center gap-3 rounded-xl bg-blue-600/5 p-2 font-semibold text-blue-700">
                                    <MessageCircle className="h-5 w-5" />
                                    <span className="hidden md:block">Todas as mensagens</span>
                                </div>
                                <div className="flex items-center gap-3 rounded-xl p-2 font-medium text-zinc-500 hover:bg-zinc-100/50 transition-colors">
                                    <MessageCircle className="h-5 w-5 text-emerald-500" />
                                    <span className="hidden md:block">WhatsApp</span>
                                </div>
                                <div className="flex items-center gap-3 rounded-xl p-2 font-medium text-zinc-500 hover:bg-zinc-100/50 transition-colors">
                                    <MessageCircle className="h-5 w-5 text-rose-500" />
                                    <span className="hidden md:block">Instagram</span>
                                </div>
                                <div className="mb-2 mt-8 hidden px-2 text-xs font-bold uppercase tracking-wider text-zinc-400 md:flex">Workspace</div>
                                <div className="flex items-center gap-3 rounded-xl p-2 font-medium text-zinc-500 hover:bg-zinc-100/50 transition-colors">
                                    <Users className="h-5 w-5" />
                                    <span className="hidden md:block">Contatos</span>
                                </div>
                                <div className="flex items-center gap-3 rounded-xl p-2 font-medium text-zinc-500 hover:bg-zinc-100/50 transition-colors">
                                    <BarChart3 className="h-5 w-5" />
                                    <span className="hidden md:block">Análises</span>
                                </div>
                            </div>

                            {/* Chat List Mockup */}
                            <div className="hidden w-28 flex-col border-r border-zinc-200/60 bg-white/60 sm:flex md:w-[320px]">
                                <div className="border-b border-zinc-200/60 p-4">
                                    <div className="h-9 w-full rounded-lg bg-zinc-100/80 ring-1 ring-inset ring-zinc-200/50" />
                                </div>
                                <div className="flex flex-1 flex-col gap-1.5 p-2">
                                    <div className="flex cursor-pointer gap-3 rounded-2xl border border-blue-200/50 bg-blue-50/50 p-3 shadow-sm">
                                        <div className="h-10 w-10 shrink-0 rounded-full bg-gradient-to-br from-blue-200 to-indigo-200" />
                                        <div className="hidden flex-1 md:block">
                                            <div className="mb-1 flex items-center justify-between">
                                                <span className="text-sm font-bold text-zinc-900">João Silva</span>
                                                <span className="text-[10px] font-medium text-blue-600">10:30</span>
                                            </div>
                                            <p className="truncate text-xs text-zinc-600 font-medium">Estou interessado no plano anual...</p>
                                        </div>
                                    </div>
                                    <div className="flex cursor-pointer gap-3 rounded-2xl p-3 hover:bg-zinc-100/50 transition-colors">
                                        <div className="h-10 w-10 shrink-0 rounded-full bg-zinc-200" />
                                        <div className="hidden flex-1 md:block">
                                            <div className="mb-1 flex items-center justify-between">
                                                <span className="text-sm font-semibold text-zinc-700">Maria Oliveira</span>
                                                <span className="text-[10px] text-zinc-400">Ontem</span>
                                            </div>
                                            <p className="truncate text-xs text-zinc-500">Pode me mandar o PDF?</p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Conversation Pane Mockup */}
                            <div className="relative flex w-full flex-1 flex-col overflow-hidden bg-white/80">
                                <div className="flex h-16 items-center justify-between border-b border-zinc-200/60 bg-white/50 px-4 backdrop-blur-md sm:px-6 md:h-20">
                                    <div>
                                        <span className="font-bold text-zinc-900 text-lg">João Silva</span>
                                        <p className="text-xs font-medium text-emerald-600 mt-0.5">Online agora</p>
                                    </div>
                                </div>

                                <div className="flex flex-1 flex-col gap-4 p-4 sm:gap-6 sm:p-6 md:p-8">
                                    <div className="max-w-[85%] self-start rounded-2xl rounded-tl-sm border border-zinc-200/80 bg-white p-4 text-sm text-zinc-700 shadow-sm md:max-w-[70%]">
                                        Olá, vi o anúncio no Instagram e queria saber se a plataforma atende minha loja com 5 atendentes simultâneos.
                                    </div>

                                    <div className="my-2 hidden items-center gap-1.5 self-center rounded-full border border-blue-100/50 bg-blue-50/30 px-4 py-1.5 text-xs font-semibold text-blue-600 backdrop-blur-sm sm:flex">
                                        <span className="relative flex h-2 w-2">
                                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
                                            <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-600" />
                                        </span>
                                        Roteado pela IA Copilot
                                    </div>

                                    <div className="max-w-[85%] self-end rounded-2xl rounded-tr-sm bg-blue-600 p-4 text-sm text-white shadow-md md:max-w-[70%]">
                                        Bom dia, João! Atende perfeitamente. O sistema orquestra todos os atendentes na mesma tela sem travamentos. Vocês já usam algum ERP atual?
                                    </div>
                                </div>

                                <div className="border-t border-zinc-200/60 bg-white/50 p-4 sm:p-6">
                                    <div className="flex h-12 w-full items-center rounded-xl border border-zinc-300 bg-white px-4 shadow-sm transition-colors hover:border-zinc-400">
                                        <span className="text-sm font-medium text-zinc-400 mt-[1px]">Responda ao João...</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </motion.div>
            </div>
        </section>
    );
};
