'use client';

import { ArrowRight, Bot, CheckCircle2, Inbox, MessageSquare, Repeat, Target, Zap, Sparkles } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';

const steps = [
    {
        id: 'capture',
        icon: Inbox,
        title: 'Capture leads de todos os canais',
        description: 'Vincule WhatsApp, Instagram e Facebook Messenger em um inbox unificado. Nunca mais perca uma oportunidade por lentidão no atendimento.',
    },
    {
        id: 'focus',
        icon: Target,
        title: 'Foque a equipe nos leads quentes',
        description: 'A IA atua como assistente 24/7. Ela qualifica, tira dúvidas básicas e entrega para o vendedor apenas quem está pronto para fechar.',
    },
    {
        id: 'automate',
        icon: Bot,
        title: 'Impulsione vendas com automações',
        description: 'Dispare mensagens segmentadas com base no histórico das conversas. Envie lembretes, reativação e promoções customizadas.',
    },
    {
        id: 'repeat',
        icon: Repeat,
        title: 'Cliente de primeira à cliente fiel',
        description: 'Construa fluxos que transformam suporte em receita. O copiloto garante que nenhuma mensagem fique esquecida ou sem contexto.',
    },
];

export const AutomagicShowcase = () => {
    const isMobile = useIsMobile();

    return (
        <section id="journey" className="relative overflow-hidden bg-transparent py-24 md:py-32">
            <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8">
                <div className="mb-16 text-center max-w-3xl mx-auto">
                    <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-brand-green/20 bg-brand-green/5 px-4 py-1.5 text-xs font-semibold text-brand-green">
                        <Sparkles className="h-3.5 w-3.5 text-brand-green" />
                        Jornada de Vendas Conversacional
                    </div>
                    <h2 className="mb-6 text-4xl font-extrabold tracking-tight text-white md:text-5xl lg:text-6xl">
                        Do primeiro &quot;Oi&quot; <br />
                        ao cliente fiel.
                    </h2>
                    <p className="text-lg text-white/50 leading-relaxed md:text-xl">
                        Tudo em uma só plataforma. Conecte canais, aplique IA na triagem e dê superpoderes ao seu time comercial.
                    </p>
                </div>

                <div className="grid gap-16 lg:grid-cols-2 lg:items-center">
                    {/* Left path */}
                    <div className="relative pl-2 md:pl-0">
                        {/* Connecting vertical line */}
                        <div className="absolute left-[27px] top-6 bottom-6 w-[2px] bg-gradient-to-b from-brand-green/50 via-white/10 to-transparent"></div>

                        <div className="flex flex-col gap-10 relative z-10">
                            {steps.map((step, index) => {
                                const Icon = step.icon;
                                return (
                                    <div key={step.id} className="group relative flex items-start gap-6">
                                        <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-zinc-900 border border-white/10 shadow-sm transition-all duration-300 md:group-hover:scale-110 md:group-hover:border-brand-green md:group-hover:shadow-brand-green/10">
                                            <Icon className="h-6 w-6 text-white/50 transition-colors duration-300 md:group-hover:text-brand-green" />
                                        </div>
                                        <div className="pt-1.5">
                                            <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-brand-green">
                                                Etapa {index + 1}
                                            </div>
                                            <h3 className="mb-2 text-xl font-bold text-white">{step.title}</h3>
                                            <p className="text-base leading-relaxed text-white/50">{step.description}</p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Right side Showcase UI */}
                    <div className="relative">
                        {!isMobile ? (
                            <div className="absolute -inset-1 rounded-[34px] bg-gradient-to-br from-brand-green/20 to-emerald-400/10 opacity-70 blur-2xl"></div>
                        ) : null}
                        <div className="relative rounded-[32px] border border-slate-800 bg-[#0A0F17] p-6 md:p-8 shadow-2xl overflow-hidden ring-1 ring-white/10">
                            {/* Decorative background effects */}
                            <div className="absolute -right-32 -top-32 hidden h-64 w-64 rounded-full bg-brand-green/20 blur-[100px] md:block"></div>
                            
                            <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800/80 pb-6 gap-4">
                                <div>
                                    <p className="text-xs font-bold uppercase tracking-widest text-emerald-400 mb-1.5">Resumo Operacional</p>
                                    <h3 className="text-2xl font-bold text-white">Equipe recebe o lead pronto</h3>
                                </div>
                                <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-400 ring-1 ring-inset ring-brand-green/30 w-fit">
                                    <span className="relative flex h-2 w-2">
                                      <span className="absolute hidden h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75 md:inline-flex"></span>
                                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                                    </span>
                                    IA Ativa
                                </div>
                            </div>

                            <div className="space-y-6">
                                {/* Chat Mockup */}
                                <div className="rounded-2xl border border-slate-800/80 bg-slate-900/70 px-5 py-6 md:bg-slate-900/50 md:backdrop-blur-sm">
                                    <div className="mb-6 flex items-center justify-between text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                                        <div className="flex items-center gap-2">
                                            <MessageSquare className="h-4 w-4" />
                                            <span>Inbox Unificado</span>
                                        </div>
                                        <span className="rounded bg-slate-800 px-2 py-1">Instagram Direct</span>
                                    </div>
                                    
                                    <div className="space-y-5">
                                        {/* User message */}
                                        <div className="flex items-start">
                                            <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-slate-800 px-4 py-3 text-sm leading-relaxed text-slate-300">
                                                Quero saber mais sobre a plataforma. Vi o anúncio no Instagram.
                                            </div>
                                        </div>
                                        
                                        {/* IA Agent message */}
                                        <div className="flex items-start justify-end">
                                            <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-brand-green px-4 py-3 text-sm leading-relaxed text-slate-950 font-medium">
                                                A IA já qualificou a necessidade e o tamanho da operação. Lead pronto para vendas.
                                            </div>
                                        </div>

                                        {/* System Notification */}
                                        <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 py-2.5 px-4 text-xs font-medium text-emerald-300">
                                            <CheckCircle2 className="h-4 w-4 shrink-0" />
                                            <span>Lead quente <strong className="font-bold text-emerald-400">entregue com contexto total</strong> para vendas.</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Features grid inside UI */}
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-5 transition-colors md:hover:bg-slate-800/60">
                                        <div className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-brand-green/10 text-brand-green ring-1 ring-brand-green/20">
                                            <Zap className="h-4 w-4" />
                                        </div>
                                        <h4 className="mb-2 text-sm font-bold text-white">Automação</h4>
                                        <p className="text-xs leading-relaxed text-slate-400">
                                            Campanhas, reativação e lembretes saem no momento certo sem intervenção manual.
                                        </p>
                                    </div>
                                    <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-5 transition-colors md:hover:bg-slate-800/60">
                                        <div className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/20">
                                            <ArrowRight className="h-4 w-4" />
                                        </div>
                                        <h4 className="mb-2 text-sm font-bold text-white">Hand-off Seguro</h4>
                                        <p className="text-xs leading-relaxed text-slate-400">
                                            Equipe humana entra em cena apenas quando há chance real de fechamento.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
};
