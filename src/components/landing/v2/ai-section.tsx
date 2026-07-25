'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import {
    ArrowRight,
    AudioLines,
    BookOpen,
    BrainCircuit,
    FileText,
    Globe,
    Handshake,
    ListChecks,
    ShieldCheck,
    Sparkles,
    Wand2,
} from 'lucide-react';
import { CtaMint } from './brand';
import { SpotlightCard } from './effects';

const CAPABILITIES = [
    {
        icon: BookOpen,
        title: 'Treinada com o seu conteúdo',
        copy: 'Suba catálogo, tabela de preços, políticas e FAQ. A IA responde com a informação da sua empresa — não com achismo.',
    },
    {
        icon: Wand2,
        title: 'Autopilot que conduz a conversa',
        copy: 'Ela cumprimenta, tira dúvida, coleta os dados que você definiu e só então decide o que fazer com o cliente.',
    },
    {
        icon: Handshake,
        title: 'Sabe a hora de chamar o humano',
        copy: 'Cliente irritado, pedido fora do script ou lead quente: a conversa passa para a pessoa certa com o resumo pronto.',
    },
    {
        icon: AudioLines,
        title: 'Entende áudio e imagem',
        copy: 'Transcreve o áudio que o cliente mandou e lê o comprovante enviado, tudo dentro da mesma conversa.',
    },
    {
        icon: ListChecks,
        title: 'Resume e lembra do histórico',
        copy: 'Case Memory guarda o contexto do cliente entre atendimentos. Ninguém pergunta duas vezes a mesma coisa.',
    },
    {
        icon: ShieldCheck,
        title: 'Com freio de mão',
        copy: 'Você define o que ela pode dizer, o tom de voz e os limites. Sem prometer desconto que não existe.',
    },
];

const SOURCES = [
    { icon: FileText, label: 'catalogo-2026.pdf', tone: 'text-rose-300' },
    { icon: Globe, label: 'site institucional', tone: 'text-blue-300' },
    { icon: ListChecks, label: 'tabela de preços', tone: 'text-amber-300' },
    { icon: BookOpen, label: 'FAQ do suporte', tone: 'text-violet-300' },
];

export function AiSection() {
    return (
        <section id="ia" className="bg-white px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
            <div className="relative mx-auto max-w-7xl overflow-hidden rounded-[32px] bg-slate-950 px-6 py-16 sm:rounded-[40px] sm:px-10 sm:py-20 lg:px-14">
                {/* Glow field */}
                <div aria-hidden="true" className="pointer-events-none absolute inset-0">
                    <div className="absolute -left-20 top-0 h-80 w-80 rounded-full bg-brand-green/25 blur-[110px]" />
                    <div className="absolute -right-16 bottom-0 h-96 w-96 rounded-full bg-violet-500/25 blur-[120px]" />
                    <div
                        className="absolute inset-0 opacity-[0.35]"
                        style={{
                            backgroundImage: 'radial-gradient(#ffffff22 1px, transparent 1px)',
                            backgroundSize: '26px 26px',
                        }}
                    />
                </div>

                <div className="relative grid gap-14 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
                    <div>
                        <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-xs font-bold uppercase tracking-[0.14em] text-brand-green backdrop-blur">
                            <BrainCircuit className="h-3.5 w-3.5" />
                            Inteligência artificial
                        </span>

                        <h2 className="mt-6 text-balance text-3xl font-extrabold leading-[1.06] tracking-tight text-white sm:text-4xl xl:text-5xl">
                            Uma IA que conhece a sua empresa —{' '}
                            <span className="text-brand-green">não a internet inteira.</span>
                        </h2>

                        <p className="mt-5 max-w-xl text-pretty text-base leading-relaxed text-white/60 sm:text-lg">
                            A maioria dos chatbots responde bonito e erra o preço. A IA da Dialogy trabalha em cima
                            do conteúdo que você subiu, segue as regras que você escreveu e devolve o cliente para
                            o time humano no momento certo.
                        </p>

                        <div className="mt-10 grid gap-3 sm:grid-cols-2">
                            {CAPABILITIES.map((item, index) => (
                                <motion.div
                                    key={item.title}
                                    initial={{ opacity: 0, y: 14 }}
                                    whileInView={{ opacity: 1, y: 0 }}
                                    viewport={{ once: true, margin: '-40px' }}
                                    transition={{ duration: 0.4, delay: index * 0.05 }}
                                >
                                    <SpotlightCard className="h-full rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition-colors duration-300 hover:border-white/20">
                                        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-brand-green ring-1 ring-white/10">
                                            <item.icon className="h-5 w-5" />
                                        </span>
                                        <h3 className="mt-3.5 text-base font-extrabold text-white">{item.title}</h3>
                                        <p className="mt-1.5 text-[0.9rem] leading-relaxed text-white/50">
                                            {item.copy}
                                        </p>
                                    </SpotlightCard>
                                </motion.div>
                            ))}
                        </div>

                        <div className="mt-11 flex flex-col gap-4 sm:flex-row sm:items-center">
                            <CtaMint href="/register" size="lg" className="w-full sm:w-auto">
                                Testar a IA grátis
                                <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
                            </CtaMint>
                            <p className="text-sm font-medium text-white/40">
                                Escolha o motor: OpenAI, Gemini ou DeepSeek.
                            </p>
                        </div>
                    </div>

                    <AiPanel />
                </div>
            </div>
        </section>
    );
}

function AiPanel() {
    return (
        <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.55 }}
            className="relative"
        >
            <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5 backdrop-blur-xl sm:p-6">
                <div className="flex items-center gap-2.5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-green text-slate-900">
                        <Sparkles className="h-4 w-4" />
                    </span>
                    <div>
                        <p className="text-sm font-extrabold text-white">Base de conhecimento</p>
                        <p className="text-[0.72rem] text-white/40">4 fontes sincronizadas · atualizado agora</p>
                    </div>
                </div>

                <div className="mt-5 space-y-2">
                    {SOURCES.map((source, index) => (
                        <motion.div
                            key={source.label}
                            initial={{ opacity: 0, x: -12 }}
                            whileInView={{ opacity: 1, x: 0 }}
                            viewport={{ once: true }}
                            transition={{ duration: 0.35, delay: 0.15 + index * 0.08 }}
                            className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/5 px-3.5 py-2.5"
                        >
                            <source.icon className={`h-4 w-4 shrink-0 ${source.tone}`} />
                            <span className="flex-1 truncate font-code text-[0.76rem] text-white/70">
                                {source.label}
                            </span>
                            <span className="rounded-md bg-brand-green/15 px-1.5 py-0.5 text-[0.62rem] font-black uppercase text-brand-green">
                                indexado
                            </span>
                        </motion.div>
                    ))}
                </div>

                <div className="my-5 flex items-center gap-3">
                    <div className="h-px flex-1 bg-white/10" />
                    <span className="text-[0.66rem] font-black uppercase tracking-[0.18em] text-white/30">
                        resultado
                    </span>
                    <div className="h-px flex-1 bg-white/10" />
                </div>

                <div className="space-y-3">
                    <div className="flex">
                        <div className="max-w-[88%] rounded-2xl rounded-tl-md bg-white/10 px-3.5 py-2.5 text-[0.82rem] leading-relaxed text-white/80">
                            Vocês têm o modelo 500ml em caixa fechada? Sai por quanto pra 20 unidades?
                        </div>
                    </div>
                    <div className="flex justify-end">
                        <div className="max-w-[88%] rounded-2xl rounded-tr-md bg-brand-green px-3.5 py-2.5 text-[0.82rem] font-medium leading-relaxed text-slate-900">
                            Temos sim! A caixa fechada de 500ml tem 12 unidades. Para 20 unidades eu monto 1 caixa
                            + 8 avulsas, e nessa faixa o preço já entra no atacado. Quer que eu reserve?
                        </div>
                    </div>
                    <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                        <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-brand-green" />
                        <span className="text-[0.7rem] font-semibold text-white/50">
                            Resposta baseada em <span className="text-white/80">tabela de preços</span> e{' '}
                            <span className="text-white/80">catalogo-2026.pdf</span>
                        </span>
                    </div>
                </div>
            </div>
        </motion.div>
    );
}
