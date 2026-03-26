'use client';

import React from 'react';
import {
    ArrowRight,
    Bot,
    CheckCircle2,
    LayoutDashboard,
    Route,
    TimerReset
} from 'lucide-react';
import { SectionWrapper, FadeIn } from '../ui/SectionWrapper';

const features = [
    {
        title: 'Toda a conversa em volta do atendimento',
        description: 'Historico, dados do cliente, tags e proxima acao aparecem no mesmo contexto do chat.',
        icon: LayoutDashboard,
    },
    {
        title: 'Fila com prioridade real',
        description: 'Distribua contatos por canal, responsavel, atraso e momento do funil sem improviso.',
        icon: TimerReset,
    },
    {
        title: 'IA para acelerar, nao para esconder o processo',
        description: 'Sugestao de resposta, resumo e automacao entram como apoio para o operador trabalhar melhor.',
        icon: Bot,
    },
];

const workflowSteps = [
    {
        title: '1. Entrada unificada',
        description: 'WhatsApp, Instagram, Facebook e Mercado Livre chegam no mesmo inbox.',
    },
    {
        title: '2. Regras e prioridade',
        description: 'Tags, fila, SLA e responsavel deixam claro o que precisa ser atendido primeiro.',
    },
    {
        title: '3. Conversa com contexto',
        description: 'O time responde vendo historico, CRM e sugestao de acao sem sair da tela.',
    },
];

export function Features() {
    return (
        <SectionWrapper id="features" className="py-24">
            <div className="space-y-10">
                <div className="max-w-3xl">
                    <FadeIn>
                        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">
                            O que muda na pratica
                        </p>
                    </FadeIn>
                    <FadeIn delay={0.1}>
                        <h2 className="mt-4 text-4xl font-semibold tracking-tight text-slate-950 md:text-5xl">
                            Uma home mais limpa tambem precisa explicar melhor o produto.
                        </h2>
                    </FadeIn>
                    <FadeIn delay={0.2}>
                        <p className="mt-5 text-lg leading-8 text-slate-600">
                            A proposta agora fica mais objetiva: menos brilho decorativo, mais foco no que seu time ganha ao operar em um inbox unico.
                        </p>
                    </FadeIn>
                </div>

                <div className="grid gap-5 lg:grid-cols-3">
                    {features.map((feature, index) => (
                        <FadeIn key={feature.title} delay={0.1 + index * 0.05}>
                            <div className="h-full rounded-[30px] border border-black/10 bg-white p-6 shadow-[0_18px_50px_-36px_rgba(15,23,42,0.5)]">
                                <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
                                    <feature.icon className="h-5 w-5" />
                                </div>
                                <h3 className="mt-5 text-xl font-semibold text-slate-950">{feature.title}</h3>
                                <p className="mt-3 text-sm leading-7 text-slate-600">{feature.description}</p>
                            </div>
                        </FadeIn>
                    ))}
                </div>

                <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                    <FadeIn delay={0.15}>
                        <div className="rounded-[32px] border border-black/10 bg-white p-6 md:p-8">
                            <div className="flex items-center justify-between gap-4">
                                <div>
                                    <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">
                                        Fluxo operacional
                                    </p>
                                    <h3 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
                                        Da primeira mensagem ate o fechamento, sem trocar de tela.
                                    </h3>
                                </div>
                                <div className="hidden h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white md:flex">
                                    <Route className="h-5 w-5" />
                                </div>
                            </div>

                            <div className="mt-8 grid gap-4">
                                {workflowSteps.map((step, index) => (
                                    <div key={step.title} className="rounded-3xl border border-black/10 bg-[#faf9f4] p-5">
                                        <div className="flex items-start gap-4">
                                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white text-slate-900 shadow-sm">
                                                <span className="text-sm font-semibold">{index + 1}</span>
                                            </div>
                                            <div>
                                                <p className="font-semibold text-slate-950">{step.title}</p>
                                                <p className="mt-2 text-sm leading-6 text-slate-600">{step.description}</p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </FadeIn>

                    <FadeIn delay={0.2}>
                        <div className="flex h-full flex-col justify-between rounded-[32px] border border-slate-950 bg-slate-950 p-6 text-white md:p-8">
                            <div>
                                <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-400">
                                    Resultado esperado
                                </p>
                                <h3 className="mt-4 text-2xl font-semibold tracking-tight">
                                    Menos ruido visual, mais entendimento imediato do valor da Dialogy.
                                </h3>
                                <p className="mt-4 text-sm leading-7 text-slate-300">
                                    A landing passa a vender clareza operacional: o visitante entende mais rapido o produto, a entrega e a proxima acao.
                                </p>
                            </div>

                            <div className="mt-8 space-y-4">
                                {[
                                    'Mensagem mais direta para gestor e operador.',
                                    'Cards e secoes com contraste leve, sem cansar a leitura.',
                                    'CTA mais visivel e proximo do argumento comercial.',
                                ].map((item) => (
                                    <div key={item} className="flex items-start gap-3 rounded-3xl bg-white/5 px-4 py-4">
                                        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-brand-green" />
                                        <p className="text-sm leading-6 text-slate-200">{item}</p>
                                    </div>
                                ))}
                            </div>

                            <a
                                href="#pricing"
                                className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-white transition-colors hover:text-brand-green"
                            >
                                Ir para os planos
                                <ArrowRight className="h-4 w-4" />
                            </a>
                        </div>
                    </FadeIn>
                </div>
            </div>
        </SectionWrapper>
    );
}
