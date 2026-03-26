'use client';

import { useState } from 'react';
import { ArrowRight, Check, Sparkles } from 'lucide-react';

import {
    CHAT_VOLUME_MIN,
    CHAT_VOLUME_MAX,
    DEFAULT_TRIAL_DAYS,
    getTierPrice,
    PLANS,
    VOLUME_TIERS,
} from '@/lib/plans-types';

type SectionVariant = 'landing' | 'page';

function formatCurrency(value: number) {
    return value.toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
    });
}

function formatChatVolume(value: number) {
    return value.toLocaleString('pt-BR');
}

function FeatureItem({ label, featured = false }: { label: string; featured?: boolean }) {
    return (
        <div className={`flex items-start gap-3 text-sm leading-6 ${featured ? 'text-slate-800' : 'text-slate-600'}`}>
            <Check className={`mt-1 h-4 w-4 shrink-0 ${featured ? 'text-brand-green' : 'text-emerald-500'}`} />
            <span>{label}</span>
        </div>
    );
}

function CheckoutButton({
    monthlyChats,
    label,
    variant = 'solid',
}: {
    monthlyChats: number;
    label: string;
    variant?: 'solid' | 'outline' | 'dark';
}) {
    const [loading, setLoading] = useState(false);

    const handleSubscribe = async () => {
        setLoading(true);
        try {
            const { createCheckoutSessionAction } = await import('@/actions/stripe');
            const result = await createCheckoutSessionAction('starter', monthlyChats);

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

    const baseStyles = "inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-3.5 text-sm font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-60";
    const variants = {
        solid: "bg-brand-green text-slate-950 hover:bg-emerald-400 hover:scale-[1.02] shadow-sm",
        dark: "bg-slate-950 text-white hover:bg-slate-800 hover:scale-[1.02] shadow-sm",
        outline: "bg-white border text-slate-950 border-slate-200 hover:border-slate-300 hover:bg-slate-50 hover:scale-[1.02]"
    };

    return (
        <button
            type="button"
            onClick={handleSubscribe}
            disabled={loading}
            className={`${baseStyles} ${variants[variant]}`}
        >
            {loading ? 'Processando...' : label}
            {!loading && <ArrowRight className="h-4 w-4" />}
        </button>
    );
}

function MainPlanCard({
    selectedTierIndex,
    onTierChange,
}: {
    selectedTierIndex: number;
    onTierChange: (index: number) => void;
}) {
    const selectedTier = VOLUME_TIERS[selectedTierIndex];
    const price = getTierPrice(selectedTier.chats);
    const plan = PLANS.starter;

    const features = [
        `Até ${formatChatVolume(selectedTier.chats)} chats por mês`,
        `${plan.limits.whatsapp} canais conectados`,
        `${DEFAULT_TRIAL_DAYS} dias grátis`,
        'Usuários ilimitados',
        'Inbox unificado',
        'Departamentos',
        'Etiquetas e notas internas',
        `Histórico de ${plan.limits.history_months} meses`,
        'Transcrição de áudio',
        'SLA e distribuição',
    ];

    return (
        <div className="relative flex w-full flex-col overflow-hidden rounded-[24px] border-2 border-brand-green bg-white shadow-xl ring-1 ring-black/5">
            <div className="absolute top-0 right-0 p-4">
                <div className="inline-flex w-fit items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 ring-1 ring-inset ring-brand-green/30">
                    <Sparkles className="h-3.5 w-3.5" />
                    Plano único
                </div>
            </div>

            <div className="p-6 md:p-8 lg:p-10 flex flex-col bg-gradient-to-b from-brand-green/5 to-transparent">
                <div className="mb-4 max-w-[80%]">
                    <h3 className="text-2xl md:text-3xl font-bold text-slate-950">Dialogy</h3>
                    <p className="mt-3 text-sm leading-relaxed text-slate-600">
                        Um plano com tudo incluso. Escolha apenas a faixa de chats que sua operação precisa por mês.
                    </p>
                </div>

                {/* Tier Selector + Price */}
                <div className="my-6 rounded-2xl border border-emerald-100/50 bg-white p-6 shadow-sm">
                    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
                        <div>
                            <p className="text-sm font-medium text-slate-500">Volume selecionado</p>
                            <h4 className="mt-1 flex items-baseline gap-1 text-4xl font-bold tracking-tight text-slate-950">
                                {formatChatVolume(selectedTier.chats)}
                                <span className="text-sm font-medium text-slate-500">chats/mês</span>
                            </h4>
                        </div>
                        <div className="text-left sm:text-right">
                            <p className="text-sm font-medium text-slate-500">Valor mensal</p>
                            <div className="mt-1 text-3xl font-bold tracking-tight text-brand-green">{formatCurrency(price)}</div>
                        </div>
                    </div>

                    <div className="mt-6">
                        <div className="flex flex-wrap gap-2">
                            {VOLUME_TIERS.map((tier, index) => (
                                <button
                                    key={tier.chats}
                                    type="button"
                                    onClick={() => onTierChange(index)}
                                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all border ${
                                        index === selectedTierIndex
                                            ? 'bg-brand-green text-slate-950 border-brand-green shadow-sm'
                                            : 'bg-slate-100 text-slate-600 border-transparent hover:bg-slate-200 hover:text-slate-900'
                                    }`}
                                >
                                    {tier.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Features Grid */}
                <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3 mb-8">
                    {features.map((feature, idx) => (
                        <FeatureItem key={idx} featured label={feature} />
                    ))}
                </div>

                {/* CTA */}
                <div className="mt-auto">
                    <CheckoutButton monthlyChats={selectedTier.chats} label="Começar agora" variant="solid" />
                    <p className="mt-3 text-center text-xs font-medium text-slate-500">
                        Preços fixos por faixa de volume. Sem surpresas.
                    </p>
                </div>
            </div>
        </div>
    );
}

function EnterpriseHorizontalCard() {
    return (
        <div className="flex flex-col xl:flex-row xl:items-center justify-between overflow-hidden rounded-[24px] border border-slate-200 bg-white p-8 md:p-10 shadow-sm transition-all hover:shadow-md">
            <div className="flex-1 xl:pr-12">
                <div className="mb-4 inline-flex w-fit rounded-[8px] bg-slate-900 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-white">
                    Sob medida
                </div>
                <h3 className="text-2xl md:text-3xl font-bold text-slate-950 mb-3">{PLANS.enterprise.label}</h3>
                <p className="text-base leading-relaxed text-slate-600 max-w-2xl">
                    Acima de {formatChatVolume(CHAT_VOLUME_MAX)} chats por mês, a Dialogy entra com desenho comercial, rollout dedicado e suporte próximo. Ideal para operações massivas.
                </p>
            </div>

            <div className="mt-8 xl:mt-0 flex-1 grid sm:grid-cols-2 gap-6 xl:gap-8 items-center">
                 <div className="space-y-4">
                    <FeatureItem label="Usuários e canais ilimitados" featured />
                    <FeatureItem label="Arquitetura de operação dedicada" featured />
                    <FeatureItem label="Implantação e governança sob medida" featured />
                 </div>
                 <div className="flex flex-col justify-center space-y-3">
                     <a
                        href="https://wa.me/551151994714"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-slate-900 px-6 py-4 text-sm font-semibold text-white transition-all hover:bg-slate-800 hover:scale-[1.02] shadow-sm"
                    >
                        Falar com vendas
                        <ArrowRight className="h-4 w-4" />
                    </a>
                    <p className="text-center text-xs font-medium text-slate-500">
                        Fluxo fora do checkout automático.
                    </p>
                 </div>
            </div>
        </div>
    );
}

export function ChatVolumePricingSection({
    variant = 'page',
}: {
    variant?: SectionVariant;
}) {
    const [tierIndex, setTierIndex] = useState(0);
    const isLanding = variant === 'landing';

    return (
        <section
            id="pricing"
            className={
                isLanding
                    ? 'relative z-20 -mt-6 bg-[#f8f9fa] px-4 pb-20 sm:px-6 md:-mt-12 md:pb-24'
                    : 'mx-auto mb-24 max-w-[1400px] px-4 xl:px-8'
            }
        >
            <div className={isLanding ? 'mx-auto max-w-[1400px]' : ''}>
                <div className={isLanding ? 'rounded-[32px] border border-black/5 bg-white px-6 py-12 shadow-sm md:px-12 md:py-20' : ''}>
                    <div className="mx-auto mb-16 max-w-4xl text-center">
                        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50 px-4 py-1.5 text-xs font-semibold text-emerald-800">
                            <Sparkles className="h-3.5 w-3.5 text-brand-green" />
                            {DEFAULT_TRIAL_DAYS} dias grátis, usuários ilimitados e limite por chats
                        </div>
                        <h2 className={`font-bold tracking-tight text-slate-950 ${isLanding ? 'text-4xl md:text-5xl lg:text-6xl' : 'text-5xl md:text-6xl'}`}>
                            Escolha o volume certo para sua operação.
                        </h2>
                        <p className={`mx-auto mt-6 max-w-2xl leading-relaxed text-slate-600 ${isLanding ? 'text-lg md:text-xl' : 'text-lg'}`}>
                            Um plano, tudo incluso. Selecione a faixa de chats mensais e veja o valor atualizar em tempo real.
                        </p>
                    </div>

                    <div className="max-w-3xl mx-auto">
                        <MainPlanCard
                            selectedTierIndex={tierIndex}
                            onTierChange={setTierIndex}
                        />
                    </div>

                    <div className="mt-6 max-w-3xl mx-auto">
                        <EnterpriseHorizontalCard />
                    </div>

                    {!isLanding && (
                        <div className="mx-auto mt-8 max-w-4xl rounded-2xl border border-slate-200 bg-slate-50 px-6 py-4 text-center text-sm font-medium text-slate-600">
                            Faixas de {formatChatVolume(CHAT_VOLUME_MIN)} a {formatChatVolume(CHAT_VOLUME_MAX)} chats por mês. Trial gratuito de {DEFAULT_TRIAL_DAYS} dias.
                        </div>
                    )}
                </div>
            </div>
        </section>
    );
}
