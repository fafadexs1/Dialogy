'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Building2, Check, Crown, MessageCircle, Sparkles, Zap } from 'lucide-react';
import {
    DEFAULT_TRIAL_DAYS,
    PLANS,
    PLAN_FEATURE_HIGHLIGHTS,
    type SelfServePlanType,
} from '@/lib/plans-types';
import { SectionHeading, Mark } from './brand';
import { cn } from '@/lib/utils';

function formatCurrency(value: number) {
    return value.toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    });
}

const PLAN_ICONS: Record<SelfServePlanType, React.ComponentType<{ className?: string }>> = {
    starter: Zap,
    pro: Crown,
    business: Building2,
};

function CheckoutButton({
    planId,
    label,
    highlighted,
}: {
    planId: SelfServePlanType;
    label: string;
    highlighted: boolean;
}) {
    const [loading, setLoading] = React.useState(false);

    const handleSubscribe = async () => {
        setLoading(true);
        try {
            const { createCheckoutSessionAction } = await import('@/actions/stripe');
            const plan = PLANS[planId];
            const result = await createCheckoutSessionAction(planId, plan.limits.monthly_chats);

            if ('url' in result && result.url) {
                window.location.href = result.url;
                return;
            }

            if ('error' in result && result.error) {
                if (result.error.includes('logado')) {
                    window.location.href = '/login?next=/pricing';
                    return;
                }
                alert(result.error);
            }
        } catch (error) {
            console.error(error);
            alert('Erro ao iniciar pagamento.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <button
            type="button"
            onClick={handleSubscribe}
            disabled={loading}
            className={cn(
                'inline-flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-4 text-[0.95rem] font-extrabold transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-60',
                highlighted
                    ? 'bg-slate-900 text-white shadow-[0_16px_38px_-16px_rgba(15,23,42,0.65)] hover:-translate-y-0.5 hover:bg-slate-800'
                    : 'border border-slate-200 bg-white text-slate-900 hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50',
            )}
        >
            {loading ? 'Processando…' : label}
            {!loading ? <ArrowRight className="h-4 w-4" /> : null}
        </button>
    );
}

function PlanCard({ planId, highlighted = false }: { planId: SelfServePlanType; highlighted?: boolean }) {
    const plan = PLANS[planId];
    const features = PLAN_FEATURE_HIGHLIGHTS[planId];
    const Icon = PLAN_ICONS[planId];

    return (
        <motion.div
            initial={{ opacity: 0, y: 22 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.45 }}
            className={cn(
                'relative rounded-[32px]',
                highlighted && 'shadow-[0_40px_90px_-40px_rgba(15,23,42,0.7)] lg:-my-4',
            )}
        >
            {/* Rotating gradient ring — the inner card's solid background leaves
                only a 2px sliver of it visible. */}
            {highlighted ? (
                <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 overflow-hidden rounded-[32px]"
                >
                    <div className="absolute left-1/2 top-1/2 h-[180%] w-[180%] -translate-x-1/2 -translate-y-1/2 animate-spin-slow bg-[conic-gradient(from_0deg,transparent_0deg,#19F5B2_50deg,transparent_130deg,transparent_200deg,#8B5CFF_250deg,transparent_330deg)] motion-reduce:animate-none" />
                </div>
            ) : null}

            <div
                className={cn(
                    'relative flex h-full flex-col rounded-[30px] p-7 sm:p-8',
                    highlighted
                        ? 'm-[2px] bg-slate-900 text-white lg:py-11'
                        : 'border border-slate-200/90 bg-white',
                )}
            >
            {highlighted ? (
                <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 overflow-hidden rounded-[30px]"
                >
                    <div className="absolute -right-16 -top-20 h-56 w-56 rounded-full bg-brand-green/25 blur-3xl" />
                    <div className="absolute -bottom-24 -left-16 h-56 w-56 rounded-full bg-violet-500/20 blur-3xl" />
                </div>
            ) : null}

            {plan.badge ? (
                <span className="absolute -top-3 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-brand-green px-3.5 py-1.5 text-[0.68rem] font-black uppercase tracking-wide text-slate-900 shadow-lg">
                    <Sparkles className="mr-1 inline h-3 w-3" />
                    {plan.badge}
                </span>
            ) : null}

            <div className="relative">
                <div className="flex items-center gap-2.5">
                    <span
                        className={cn(
                            'flex h-10 w-10 items-center justify-center rounded-xl',
                            highlighted ? 'bg-brand-green text-slate-900' : 'bg-slate-100 text-slate-700',
                        )}
                    >
                        <Icon className="h-5 w-5" />
                    </span>
                    <h3 className={cn('text-lg font-extrabold', highlighted ? 'text-white' : 'text-slate-900')}>
                        {plan.label}
                    </h3>
                </div>
                <p
                    className={cn(
                        'mt-3.5 text-[0.88rem] leading-relaxed',
                        highlighted ? 'text-white/55' : 'text-slate-500',
                    )}
                >
                    {plan.description}
                </p>

                <div className="mt-7 flex items-end gap-1.5">
                    <span
                        className={cn(
                            'text-4xl font-black tracking-tight sm:text-[2.75rem]',
                            highlighted ? 'text-white' : 'text-slate-900',
                        )}
                    >
                        {formatCurrency(plan.price)}
                    </span>
                    <span
                        className={cn(
                            'mb-1.5 text-sm font-bold',
                            highlighted ? 'text-white/50' : 'text-slate-400',
                        )}
                    >
                        /mês
                    </span>
                </div>
                <p
                    className={cn(
                        'mt-1.5 text-[0.82rem] font-semibold',
                        highlighted ? 'text-white/40' : 'text-slate-400',
                    )}
                >
                    {plan.limits.monthly_chats.toLocaleString('pt-BR')} chats/mês · Usuários ilimitados
                </p>
            </div>

            <ul className="relative mt-7 flex-1 space-y-3">
                {features.map((feature) => {
                    const isHeader = feature.endsWith(':');
                    if (isHeader) {
                        return (
                            <li
                                key={feature}
                                className={cn(
                                    'pt-1 text-[0.82rem] font-black uppercase tracking-wide',
                                    highlighted ? 'text-brand-green' : 'text-emerald-600',
                                )}
                            >
                                {feature}
                            </li>
                        );
                    }
                    return (
                        <li key={feature} className="flex items-start gap-2.5">
                            <span
                                className={cn(
                                    'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full',
                                    highlighted ? 'bg-brand-green' : 'bg-emerald-100',
                                )}
                            >
                                <Check
                                    className={cn('h-2.5 w-2.5', highlighted ? 'text-slate-900' : 'text-emerald-600')}
                                    strokeWidth={4}
                                />
                            </span>
                            <span
                                className={cn(
                                    'text-[0.88rem] font-medium',
                                    highlighted ? 'text-white/80' : 'text-slate-600',
                                )}
                            >
                                {feature}
                            </span>
                        </li>
                    );
                })}
            </ul>

            <div className="relative mt-8">
                <CheckoutButton
                    planId={planId}
                    label={`Começar ${DEFAULT_TRIAL_DAYS} dias grátis`}
                    highlighted={highlighted}
                />
                <p
                    className={cn(
                        'mt-3 text-center text-[0.74rem] font-semibold',
                        highlighted ? 'text-white/35' : 'text-slate-400',
                    )}
                >
                    Cancele quando quiser. Sem fidelidade.
                </p>
            </div>
            </div>
        </motion.div>
    );
}

export function Pricing() {
    return (
        <section id="planos" className="relative overflow-hidden bg-white py-20 sm:py-28">
            <div
                aria-hidden="true"
                className="pointer-events-none absolute left-1/2 top-24 h-[30rem] w-[46rem] -translate-x-1/2 rounded-full bg-brand-green/10 blur-[130px]"
            />
            <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                <SectionHeading
                    accent="emerald"
                    eyebrow={
                        <>
                            <Sparkles className="h-3.5 w-3.5" />
                            Planos que crescem com você
                        </>
                    }
                    title={
                        <>
                            Preço fechado, time inteiro dentro,{' '}
                            <Mark>sem cobrança por usuário.</Mark>
                        </>
                    }
                    description={`Todos os planos incluem usuários ilimitados e ${DEFAULT_TRIAL_DAYS} dias grátis. Você paga pelo volume de conversas — não pelo tamanho da equipe.`}
                />

                <div className="mx-auto mt-16 grid max-w-5xl gap-6 lg:grid-cols-3 lg:items-center">
                    <PlanCard planId="starter" />
                    <PlanCard planId="pro" highlighted />
                    <PlanCard planId="business" />
                </div>

                {/* Enterprise */}
                <motion.div
                    initial={{ opacity: 0, y: 18 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: '-60px' }}
                    transition={{ duration: 0.45 }}
                    className="mx-auto mt-6 flex max-w-5xl flex-col items-center gap-6 rounded-[30px] border border-slate-200/90 bg-slate-50/70 p-7 sm:p-8 lg:flex-row"
                >
                    <div className="flex-1 text-center lg:text-left">
                        <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-black uppercase tracking-[0.14em] text-slate-600 ring-1 ring-slate-200">
                            <Building2 className="h-3.5 w-3.5" />
                            Grandes operações
                        </span>
                        <h3 className="mt-4 text-2xl font-extrabold tracking-tight text-slate-900">Enterprise</h3>
                        <p className="mx-auto mt-2 max-w-xl text-[0.94rem] leading-relaxed text-slate-600 lg:mx-0">
                            Acima de 15.000 chats por mês, canais ilimitados, arquitetura dedicada, integrações sob
                            medida e executivo de contas. A gente monta o plano junto com você.
                        </p>
                    </div>
                    <a
                        href="https://wa.me/551151994714"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-8 py-4 text-[0.95rem] font-extrabold text-white shadow-[0_16px_38px_-16px_rgba(15,23,42,0.65)] transition-all hover:-translate-y-0.5 hover:bg-slate-800 lg:w-auto"
                    >
                        <MessageCircle className="h-5 w-5" />
                        Falar com vendas
                    </a>
                </motion.div>
            </div>
        </section>
    );
}
