'use client';

import { useState } from 'react';
import { ArrowRight, Check, Sparkles, Building2, MessageCircle, Crown, Zap, X } from 'lucide-react';

import {
    DEFAULT_TRIAL_DAYS,
    PLANS,
    PLAN_FEATURE_HIGHLIGHTS,
    type SelfServePlanType,
} from '@/lib/plans-types';

type SectionVariant = 'landing' | 'page';

function formatCurrency(value: number) {
    return value.toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    });
}

function CheckoutButton({
    planId,
    label,
    variant = 'solid',
}: {
    planId: SelfServePlanType;
    label: string;
    variant?: 'solid' | 'outline' | 'dark';
}) {
    const [loading, setLoading] = useState(false);

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

    const baseStyles = "inline-flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-4 text-base font-bold transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-60";
    const variants = {
        solid: "bg-brand-green text-black hover:bg-emerald-400 hover:scale-[1.02] hover:shadow-[0_0_30px_rgba(34,197,94,0.4)] shadow-[0_0_15px_rgba(34,197,94,0.2)]",
        dark: "bg-white text-black hover:bg-white/90 hover:scale-[1.02] shadow-sm",
        outline: "bg-white/5 border text-white border-white/10 hover:border-white/20 hover:bg-white/10 hover:scale-[1.02]"
    };

    return (
        <button
            type="button"
            onClick={handleSubscribe}
            disabled={loading}
            className={`${baseStyles} ${variants[variant]}`}
        >
            {loading ? 'Processando...' : label}
            {!loading && <ArrowRight className="h-5 w-5" />}
        </button>
    );
}

function PlanCard({
    planId,
    highlighted = false,
}: {
    planId: SelfServePlanType;
    highlighted?: boolean;
}) {
    const plan = PLANS[planId];
    const features = PLAN_FEATURE_HIGHLIGHTS[planId];
    const chats = plan.limits.monthly_chats;

    const icons: Record<SelfServePlanType, React.ReactNode> = {
        starter: <Zap className="h-5 w-5" />,
        pro: <Crown className="h-5 w-5" />,
        business: <Building2 className="h-5 w-5" />,
    };

    return (
        <div className={`relative flex flex-col overflow-hidden rounded-[2rem] backdrop-blur-xl p-8 transition-all duration-300 ${
            highlighted
                ? 'border-2 border-brand-green/40 bg-zinc-950/90 shadow-[0_0_60px_rgba(34,197,94,0.1)] scale-[1.02]'
                : 'border border-white/10 bg-zinc-950/70 hover:border-white/20'
        }`}>
            {/* Badge */}
            {plan.badge && (
                <div className="absolute top-0 right-0 p-5">
                    <div className="inline-flex items-center gap-1.5 rounded-full bg-brand-green/10 px-3 py-1.5 text-xs font-bold text-brand-green border border-brand-green/20">
                        <Sparkles className="h-3 w-3" />
                        {plan.badge}
                    </div>
                </div>
            )}

            {/* Header */}
            <div className="mb-6">
                <div className="flex items-center gap-2 mb-3">
                    <div className={`p-2 rounded-xl ${highlighted ? 'bg-brand-green/10 text-brand-green' : 'bg-white/5 text-white/60'}`}>
                        {icons[planId]}
                    </div>
                    <h3 className="text-lg font-bold text-white">{plan.label}</h3>
                </div>
                <p className="text-sm text-white/40 leading-relaxed">{plan.description}</p>
            </div>

            {/* Price */}
            <div className="mb-8">
                <div className="flex items-end gap-1">
                    <span className="text-4xl md:text-5xl font-extrabold tracking-tight text-white">
                        {formatCurrency(plan.price)}
                    </span>
                    <span className="text-base text-white/60 font-medium mb-1">/mês</span>
                </div>
                <p className="mt-2 text-sm text-white/30 font-medium">
                    {chats.toLocaleString('pt-BR')} chats/mês · Usuários ilimitados
                </p>
            </div>

            {/* Features */}
            <div className="flex-1 mb-8 space-y-3">
                {features.map((feature, idx) => {
                    const isHeader = feature.endsWith(':');
                    return (
                        <div key={idx} className={`flex items-start gap-3 ${isHeader ? 'pt-1' : ''}`}>
                            {isHeader ? (
                                <span className="text-sm font-bold text-brand-green">{feature}</span>
                            ) : (
                                <>
                                    <Check className={`h-4 w-4 shrink-0 mt-0.5 ${highlighted ? 'text-brand-green' : 'text-white/40'}`} strokeWidth={3} />
                                    <span className="text-sm font-medium text-white/80">{feature}</span>
                                </>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* CTA */}
            <div className="mt-auto">
                <CheckoutButton
                    planId={planId}
                    label={`Começar ${DEFAULT_TRIAL_DAYS} dias grátis`}
                    variant={highlighted ? 'solid' : 'outline'}
                />
                <p className="mt-3 text-center text-xs font-medium text-white/30">
                    Cancele a qualquer momento. Sem fidelidade.
                </p>
            </div>
        </div>
    );
}

function EnterpriseCard() {
    return (
        <div className="mx-auto mt-8 w-full max-w-4xl flex flex-col sm:flex-row items-center gap-6 rounded-[2rem] border border-white/10 bg-gradient-to-br from-zinc-900/90 to-black/90 backdrop-blur-xl p-8 shadow-xl">
            <div className="flex-1 text-center sm:text-left">
                <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold text-white border border-white/5">
                    <Building2 className="h-3.5 w-3.5" />
                    Grandes operações
                </div>
                <h3 className="text-2xl font-bold text-white mb-2">Enterprise</h3>
                <p className="text-white/40 text-sm leading-relaxed max-w-md font-medium">
                    Acima de 15.000 chats, canais ilimitados, arquitetura dedicada, integrações customizadas e executivo de contas.
                </p>
            </div>
            <div className="w-full sm:w-auto sm:min-w-[220px]">
                <a
                    href="https://wa.me/551151994714"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-white text-black px-8 py-4 text-sm font-bold transition-all hover:bg-zinc-200 hover:scale-105 shadow-lg"
                >
                    <MessageCircle className="h-5 w-5" />
                    Falar com Vendas
                </a>
            </div>
        </div>
    );
}

export function ChatVolumePricingSection({
    variant = 'page',
}: {
    variant?: SectionVariant;
}) {
    const isLanding = variant === 'landing';

    return (
        <section
            id="pricing"
            className={
                isLanding
                    ? 'relative z-20 -mt-6 bg-transparent px-4 pb-20 sm:px-6 md:-mt-12 md:pb-24'
                    : 'mx-auto mb-24 max-w-[1400px] px-4 xl:px-8 pt-12'
            }
        >
            <div className={isLanding ? 'mx-auto max-w-[1200px]' : ''}>
                <div className={isLanding ? 'rounded-[32px] border border-white/5 bg-transparent px-2 py-12 md:px-12 md:py-20' : ''}>
                    
                    {/* Header */}
                    <div className="mx-auto mb-16 max-w-2xl text-center">
                        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-brand-green/20 bg-brand-green/10 px-4 py-1.5 text-xs font-bold text-brand-green shadow-[0_0_15px_rgba(34,197,94,0.15)]">
                            <Sparkles className="h-4 w-4" />
                            Planos que crescem com você
                        </div>
                        <h2 className={`font-extrabold tracking-tight text-white ${isLanding ? 'text-4xl md:text-5xl lg:text-6xl' : 'text-4xl md:text-5xl'}`}>
                            Escolha o plano ideal para sua{' '}
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-green to-emerald-300">
                                operação
                            </span>
                            .
                        </h2>
                        <p className="mt-4 text-lg text-white/40 max-w-lg mx-auto">
                            Todos os planos incluem usuários ilimitados e {DEFAULT_TRIAL_DAYS} dias grátis. Sem fidelidade.
                        </p>
                    </div>

                    {/* Plan Cards Grid */}
                    <div className="mx-auto max-w-5xl grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
                        <PlanCard planId="starter" />
                        <PlanCard planId="pro" highlighted />
                        <PlanCard planId="business" />
                    </div>

                    {/* Enterprise */}
                    <EnterpriseCard />

                </div>
            </div>
        </section>
    );
}
