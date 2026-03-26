'use client';

import { useState } from 'react';
import {
    ArrowRight,
    Check,
    Loader2,
    RefreshCw,
    Shield,
    SlidersHorizontal,
    Sparkles,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import {
    findNearestTierIndex,
    getTierPrice,
    PLANS,
    VOLUME_TIERS,
} from '@/lib/plans-types';
import { cn } from '@/lib/utils';

function formatCurrency(value: number) {
    return value.toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
    });
}

export function BillingPlanSelector({
    currentPlanId,
    canManageBilling,
    currentMonthlyChats,
    hasSubscription,
    hasActiveSubscription,
}: {
    currentPlanId: string;
    canManageBilling: boolean;
    currentMonthlyChats: number;
    /** True if the workspace has ANY subscription (even canceled) */
    hasSubscription: boolean;
    /** True if the subscription is active/trialing/past_due (can do proration) */
    hasActiveSubscription: boolean;
}) {
    const { toast } = useToast();
    const currentTierIndex = findNearestTierIndex(currentMonthlyChats);
    const [selectedTierIndex, setSelectedTierIndex] = useState(currentTierIndex);
    const [loading, setLoading] = useState(false);
    const selectedTier = VOLUME_TIERS[selectedTierIndex];
    const selectedPrice = getTierPrice(selectedTier.chats);
    const currentPrice = getTierPrice(currentMonthlyChats);

    const isSameTier = selectedTierIndex === currentTierIndex;
    const isUpgrade = selectedTierIndex > currentTierIndex;
    const priceDiff = selectedPrice - currentPrice;

    async function handleSubscribe() {
        if (loading) return;
        setLoading(true);

        try {
            const { createCheckoutSessionAction } = await import('@/actions/stripe');
            const result = await createCheckoutSessionAction('starter', selectedTier.chats);

            if ('success' in result && result.success) {
                toast({
                    title: 'Plano atualizado!',
                    description: `Sua faixa de chats foi alterada para ${selectedTier.label} chats/mes. ${
                        isUpgrade
                            ? 'A diferenca proporcional sera cobrada agora.'
                            : 'O credito proporcional sera abatido na proxima fatura.'
                    }`,
                });
                // Reload to reflect new plan
                window.location.reload();
                return;
            }

            if ('url' in result && result.url) {
                window.location.href = result.url;
                return;
            }

            if ('error' in result && result.error) {
                if (result.error.includes('logado')) {
                    window.location.href = '/login?next=/settings/billing';
                    return;
                }
                toast({
                    title: 'Erro ao processar',
                    description: result.error,
                    variant: 'destructive',
                });
            }
        } catch (error) {
            console.error(error);
            toast({
                title: 'Erro inesperado',
                description: 'Nao foi possivel processar o pagamento.',
                variant: 'destructive',
            });
        } finally {
            setLoading(false);
        }
    }

    const plan = PLANS.starter;

    return (
        <div className="pt-8 space-y-6">
            <h2 className="text-xl font-bold flex items-center gap-2">
                <Shield className="w-5 h-5" />
                Plano Dialogy
            </h2>

            {/* Single plan card with volume selector */}
            <Card className="border-primary/30 shadow-lg">
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="text-2xl flex items-center gap-2">
                                <Sparkles className="w-5 h-5 text-primary" />
                                Dialogy
                            </CardTitle>
                            <CardDescription className="mt-1">
                                Um unico plano com tudo incluso. Escolha apenas o volume de chats que sua operacao precisa.
                            </CardDescription>
                        </div>
                        {hasSubscription && (
                            <Badge variant="outline" className="border-primary text-primary">
                                Assinante
                            </Badge>
                        )}
                    </div>
                </CardHeader>

                <CardContent className="space-y-6">
                    {/* Volume Selector */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                            <SlidersHorizontal className="w-4 h-4" />
                            Volume mensal de chats
                        </div>

                        <div className="flex flex-wrap gap-2">
                            {VOLUME_TIERS.map((tier, index) => {
                                const isCurrent = index === currentTierIndex && hasSubscription;
                                return (
                                    <button
                                        key={tier.chats}
                                        onClick={() => setSelectedTierIndex(index)}
                                        className={cn(
                                            'relative px-3 py-1.5 rounded-full text-sm font-medium transition-all border',
                                            index === selectedTierIndex
                                                ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                                                : isCurrent
                                                    ? 'bg-primary/10 text-primary border-primary/30'
                                                    : 'bg-muted/50 text-muted-foreground border-transparent hover:bg-muted hover:text-foreground'
                                        )}
                                    >
                                        {tier.label}
                                        {isCurrent && index !== selectedTierIndex && (
                                            <span className="absolute -top-1 -right-1 w-2 h-2 bg-primary rounded-full" />
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Price Display */}
                    <div className="rounded-xl bg-muted/50 p-6 space-y-4">
                        <div className="flex items-end justify-between">
                            <div>
                                <p className="text-sm text-muted-foreground mb-1">
                                    {selectedTier.chats.toLocaleString('pt-BR')} chats por mes
                                </p>
                                <span className="text-4xl font-bold">
                                    {formatCurrency(selectedPrice)}
                                </span>
                                <span className="text-sm text-muted-foreground ml-1">/mes</span>
                            </div>
                            {hasActiveSubscription && !isSameTier && (
                                <div className={cn(
                                    'text-right rounded-lg px-3 py-2',
                                    isUpgrade ? 'bg-amber-500/10 text-amber-600' : 'bg-green-500/10 text-green-600'
                                )}>
                                    <p className="text-xs font-medium">
                                        {isUpgrade ? 'Diferenca proporcional' : 'Credito proporcional'}
                                    </p>
                                    <p className="text-lg font-bold">
                                        {isUpgrade ? '+' : ''}{formatCurrency(priceDiff)}
                                    </p>
                                </div>
                            )}
                        </div>

                        {hasActiveSubscription && !isSameTier && (
                            <p className="text-xs text-muted-foreground border-t pt-3">
                                {isUpgrade
                                    ? 'Ao confirmar, a diferenca proporcional sera cobrada na sua proxima fatura. O novo limite de chats sera aplicado imediatamente.'
                                    : 'Ao confirmar, o credito proporcional sera abatido na sua proxima fatura. O novo limite de chats sera aplicado imediatamente.'}
                            </p>
                        )}
                    </div>

                    {/* Features */}
                    <div className="grid grid-cols-2 gap-3">
                        {[
                            'Usuarios ilimitados',
                            `Ate ${plan.limits.whatsapp} canais conectados`,
                            `Historico de ${plan.limits.history_months} meses`,
                            'Transcricao de audio',
                            'Departamentos',
                            `${plan.trialDays || 0} dias de teste gratis`,
                            'Inbox unificado',
                            'Etiquetas e notas internas',
                        ].map((feature) => (
                            <div key={feature} className="flex items-center gap-2 text-sm">
                                <Check className="w-4 h-4 text-green-500 shrink-0" />
                                <span>{feature}</span>
                            </div>
                        ))}
                    </div>
                </CardContent>

                <CardFooter>
                    <Button
                        className="w-full"
                        size="lg"
                        disabled={
                            (hasSubscription && isSameTier) ||
                            !canManageBilling ||
                            loading
                        }
                        onClick={handleSubscribe}
                    >
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {isSameTier && hasSubscription
                            ? 'Faixa atual'
                            : hasActiveSubscription && !isSameTier
                                ? <>
                                    <RefreshCw className="mr-2 h-4 w-4" />
                                    Alterar para {selectedTier.label} chats/mes
                                </>
                                : <>
                                    Assinar Dialogy — {selectedTier.label} chats/mes
                                    <ArrowRight className="ml-1 h-4 w-4" />
                                </>}
                    </Button>
                </CardFooter>
            </Card>
        </div>
    );
}
