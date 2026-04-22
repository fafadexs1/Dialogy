'use client';

import { useState } from 'react';
import { ArrowRight, Check, Sparkles, Building2, MessageCircle } from 'lucide-react';

import {
    CHAT_VOLUME_MIN,
    CHAT_VOLUME_MAX,
    DEFAULT_TRIAL_DAYS,
    getTierPrice,
    PLANS,
    VOLUME_TIERS,
} from '@/lib/plans-types';
import { Slider } from '@/components/ui/slider';

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
        'Usuários ilimitados',
        `${plan.limits.whatsapp} canais conectados`,
        'Inbox unificado',
        'Departamentos e Repasses',
        'SLA e Distribuição',
        'Etiquetas e Notas',
        'Transcrição via IA',
        `Histórico de ${plan.limits.history_months} meses`,
    ];

    return (
        <div className="relative mx-auto w-full max-w-xl flex flex-col overflow-hidden rounded-[2rem] border border-white/10 bg-zinc-950/80 backdrop-blur-xl shadow-2xl p-8 md:p-10">
            <div className="absolute top-0 right-0 p-6 hidden sm:block">
                <div className="inline-flex items-center gap-1.5 rounded-full bg-brand-green/10 px-3 py-1.5 text-xs font-bold text-brand-green border border-brand-green/20">
                    <Sparkles className="h-3.5 w-3.5" />
                    Tudo Incluso
                </div>
            </div>

            <div className="flex flex-col text-center">
                {/* Price Display */}
                <div className="mb-8">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-white/40 mb-3">Plano Único</h3>
                    <div className="flex items-center justify-center gap-1">
                        <span className="text-5xl md:text-6xl font-extrabold tracking-tight text-white">{formatCurrency(price)}</span>
                        <span className="text-lg text-white/50 font-medium self-end mb-1.5">/mês</span>
                    </div>
                </div>

                {/* Slider Selector */}
                <div className="mb-10 text-left bg-black/40 p-6 rounded-3xl border border-white/5">
                    <div className="flex items-center justify-between mb-6">
                        <span className="text-sm font-medium text-white/60">Volume mensal</span>
                        <span className="text-xl font-bold text-brand-green">Até {formatChatVolume(selectedTier.chats)} chats</span>
                    </div>
                    
                    <div className="px-2">
                        <Slider
                            value={[selectedTierIndex]}
                            max={VOLUME_TIERS.length - 1}
                            step={1}
                            onValueChange={(val) => onTierChange(val[0])}
                            className="py-2 cursor-pointer [&_[role=slider]]:bg-brand-green [&_[role=slider]]:border-brand-green [&_[role=slider]]:shadow-[0_0_15px_rgba(34,197,94,0.5)] [&_.bg-primary]:bg-brand-green"
                        />
                    </div>
                    
                    <div className="flex justify-between mt-4 text-xs text-white/30 font-bold px-2">
                        <span>{formatChatVolume(CHAT_VOLUME_MIN)}</span>
                        <span>{formatChatVolume(CHAT_VOLUME_MAX)}</span>
                    </div>
                </div>

                {/* Features Grid */}
                <div className="pt-2 mb-10 text-left">
                    <div className="grid grid-cols-2 gap-y-4 gap-x-4">
                        {features.map((feature, idx) => (
                            <div key={idx} className="flex items-center gap-3 text-white/80">
                                <Check className="h-4 w-4 text-brand-green shrink-0" strokeWidth={3} />
                                <span className="text-sm font-medium">{feature}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* CTA */}
                <div className="mt-auto">
                    <CheckoutButton monthlyChats={selectedTier.chats} label={`Começar meus ${DEFAULT_TRIAL_DAYS} dias grátis`} variant="solid" />
                    <p className="mt-4 text-center text-xs font-medium text-white/40">
                        Cancele a qualquer momento. Sem fidelidade ou taxas.
                    </p>
                </div>
            </div>
        </div>
    );
}

function EnterpriseCard() {
    return (
        <div className="mx-auto mt-6 w-full max-w-xl flex flex-col items-center gap-6 rounded-[2rem] border border-white/10 bg-gradient-to-br from-zinc-900/90 to-black/90 backdrop-blur-xl p-8 shadow-xl text-center">
            <div>
                <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold text-white border border-white/5">
                    <Building2 className="h-3.5 w-3.5" />
                    Grandes Operações
                </div>
                <h3 className="text-2xl font-bold text-white mb-3">Sob Medida</h3>
                <p className="text-white/50 text-sm leading-relaxed max-w-[280px] mx-auto font-medium">
                    Acima de {formatChatVolume(CHAT_VOLUME_MAX)} chats. Arquitetura dedicada e executivo de contas.
                </p>
            </div>
            <div className="w-full">
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
    const [tierIndex, setTierIndex] = useState(0);
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
                            Um plano único
                        </div>
                        <h2 className={`font-extrabold tracking-tight text-white ${isLanding ? 'text-4xl md:text-5xl lg:text-6xl' : 'text-4xl md:text-5xl'}`}>
                            Preço simples para <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-green to-emerald-300">crescer junto</span>.
                        </h2>
                    </div>

                    <div className="max-w-4xl mx-auto flex flex-col items-center">
                        <MainPlanCard
                            selectedTierIndex={tierIndex}
                            onTierChange={setTierIndex}
                        />
                        <EnterpriseCard />
                    </div>

                </div>
            </div>
        </section>
    );
}

