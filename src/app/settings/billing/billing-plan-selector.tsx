'use client';

import { useState } from 'react';
import {
    ArrowRight,
    Check,
    Crown,
    Loader2,
    RefreshCw,
    Shield,
    Sparkles,
    X,
    Zap,
    Building2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import {
    PLANS,
    PLAN_FEATURE_HIGHLIGHTS,
    type PlanType,
    type SelfServePlanType,
} from '@/lib/plans-types';
import { cn } from '@/lib/utils';

function formatCurrency(value: number) {
    return value.toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    });
}

const PLAN_ORDER: SelfServePlanType[] = ['starter', 'pro', 'business'];

const PLAN_ICONS: Record<SelfServePlanType, React.ReactNode> = {
    starter: <Zap className="w-5 h-5" />,
    pro: <Crown className="w-5 h-5" />,
    business: <Building2 className="w-5 h-5" />,
};

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
    const [selectedPlan, setSelectedPlan] = useState<SelfServePlanType>(
        (PLAN_ORDER.includes(currentPlanId as SelfServePlanType) ? currentPlanId : 'starter') as SelfServePlanType
    );
    const [loading, setLoading] = useState(false);

    const isSamePlan = selectedPlan === currentPlanId && hasSubscription;
    const isUpgrade = PLAN_ORDER.indexOf(selectedPlan) > PLAN_ORDER.indexOf(currentPlanId as SelfServePlanType);
    const selectedDetails = PLANS[selectedPlan];
    const currentDetails = PLANS[currentPlanId as PlanType] || PLANS.starter;
    const priceDiff = selectedDetails.price - currentDetails.price;

    async function handleSubscribe() {
        if (loading) return;
        setLoading(true);

        try {
            const { createCheckoutSessionAction } = await import('@/actions/stripe');
            const result = await createCheckoutSessionAction(selectedPlan, selectedDetails.limits.monthly_chats);

            if ('success' in result && result.success) {
                toast({
                    title: 'Plano atualizado!',
                    description: `Seu plano foi alterado para ${selectedDetails.label}. ${
                        isUpgrade
                            ? 'A diferenca proporcional sera cobrada agora.'
                            : 'O credito proporcional sera abatido na proxima fatura.'
                    }`,
                });
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

    return (
        <div className="pt-8 space-y-6">
            <h2 className="text-xl font-bold flex items-center gap-2">
                <Shield className="w-5 h-5" />
                Planos Dialogy
            </h2>

            {/* Plan selector pills */}
            <div className="flex flex-wrap gap-3">
                {PLAN_ORDER.map((planId) => {
                    const plan = PLANS[planId];
                    const isCurrent = planId === currentPlanId && hasSubscription;
                    const isSelected = planId === selectedPlan;

                    return (
                        <button
                            key={planId}
                            onClick={() => setSelectedPlan(planId)}
                            className={cn(
                                'relative flex items-center gap-3 rounded-2xl px-5 py-4 border transition-all text-left min-w-[200px]',
                                isSelected
                                    ? 'bg-primary/10 border-primary shadow-sm'
                                    : 'bg-muted/30 border-transparent hover:bg-muted/60 hover:border-muted-foreground/20'
                            )}
                        >
                            <div className={cn(
                                'p-2 rounded-xl',
                                isSelected ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                            )}>
                                {PLAN_ICONS[planId]}
                            </div>
                            <div>
                                <div className="flex items-center gap-2">
                                    <span className="font-bold text-sm">{plan.label}</span>
                                    {isCurrent && (
                                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-primary text-primary">
                                            Atual
                                        </Badge>
                                    )}
                                </div>
                                <span className="text-xs text-muted-foreground">
                                    {formatCurrency(plan.price)}/mes
                                </span>
                            </div>
                        </button>
                    );
                })}
            </div>

            {/* Selected plan details */}
            <Card className={cn(
                'shadow-lg transition-all',
                selectedPlan === 'pro' ? 'border-primary/30' : 'border-border'
            )}>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="text-2xl flex items-center gap-2">
                                {PLAN_ICONS[selectedPlan]}
                                {selectedDetails.label}
                                {selectedDetails.badge && (
                                    <Badge className="bg-primary/10 text-primary border-primary/20 text-xs">
                                        {selectedDetails.badge}
                                    </Badge>
                                )}
                            </CardTitle>
                            <CardDescription className="mt-1">
                                {selectedDetails.description}
                            </CardDescription>
                        </div>
                        {hasSubscription && selectedPlan === currentPlanId && (
                            <Badge variant="outline" className="border-primary text-primary">
                                Assinante
                            </Badge>
                        )}
                    </div>
                </CardHeader>

                <CardContent className="space-y-6">
                    {/* Price Display */}
                    <div className="rounded-xl bg-muted/50 p-6 space-y-4">
                        <div className="flex items-end justify-between">
                            <div>
                                <p className="text-sm text-muted-foreground mb-1">
                                    {selectedDetails.limits.monthly_chats.toLocaleString('pt-BR')} chats/mes · Usuarios ilimitados
                                </p>
                                <span className="text-4xl font-bold">
                                    {formatCurrency(selectedDetails.price)}
                                </span>
                                <span className="text-sm text-muted-foreground ml-1">/mes</span>
                            </div>
                            {hasActiveSubscription && !isSamePlan && (
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

                        {hasActiveSubscription && !isSamePlan && (
                            <p className="text-xs text-muted-foreground border-t pt-3">
                                {isUpgrade
                                    ? 'Ao confirmar, a diferenca proporcional sera cobrada na sua proxima fatura. Os novos recursos serao liberados imediatamente.'
                                    : 'Ao confirmar, o credito proporcional sera abatido na sua proxima fatura.'}
                            </p>
                        )}
                    </div>

                    {/* Features */}
                    <div className="space-y-3">
                        {PLAN_FEATURE_HIGHLIGHTS[selectedPlan].map((feature, idx) => {
                            const isHeader = feature.endsWith(':');
                            return (
                                <div key={idx} className={`flex items-center gap-2 text-sm ${isHeader ? 'pt-2' : ''}`}>
                                    {isHeader ? (
                                        <span className="font-bold text-primary">{feature}</span>
                                    ) : (
                                        <>
                                            <Check className="w-4 h-4 text-green-500 shrink-0" />
                                            <span>{feature}</span>
                                        </>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </CardContent>

                <CardFooter>
                    <Button
                        className="w-full"
                        size="lg"
                        disabled={
                            isSamePlan ||
                            !canManageBilling ||
                            loading
                        }
                        onClick={handleSubscribe}
                    >
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {isSamePlan
                            ? 'Plano atual'
                            : hasActiveSubscription && !isSamePlan
                                ? <>
                                    <RefreshCw className="mr-2 h-4 w-4" />
                                    {isUpgrade ? 'Fazer upgrade' : 'Alterar'} para {selectedDetails.label}
                                </>
                                : <>
                                    Assinar {selectedDetails.label} — {formatCurrency(selectedDetails.price)}/mes
                                    <ArrowRight className="ml-1 h-4 w-4" />
                                </>}
                    </Button>
                </CardFooter>
            </Card>
        </div>
    );
}
