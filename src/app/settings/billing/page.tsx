'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
    CalendarDays,
    CreditCard,
    Download,
    HelpCircle,
    Loader2,
    MessageSquare,
    Zap,
    PartyPopper,
} from 'lucide-react';
import { BillingPlanSelector } from './billing-plan-selector';
import { useSearchParams, useRouter } from 'next/navigation';
import { useSettings } from '../settings-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { getCurrentPlanAction } from '@/actions/billing-ui';
import {
    createBillingPortalSessionAction,
    getBillingHistoryAction,
    getBillingOverviewAction,
    type BillingOverview,
} from '@/actions/stripe';
import { useToast } from '@/hooks/use-toast';
import { calculatePlanPrice, CHAT_VOLUME_MAX, CHAT_VOLUME_MIN, PLANS, type PlanType, type SelfServePlanType } from '@/lib/plans-types';
import { cn } from '@/lib/utils';

function formatCurrency(value: number, currency = 'BRL') {
    return value.toLocaleString('pt-BR', {
        style: 'currency',
        currency: currency.toUpperCase(),
    });
}

function formatLongDate(date: string) {
    return format(new Date(date), "dd 'de' MMMM 'de' yyyy", { locale: ptBR });
}

function getBillingStatusMeta(status?: string | null) {
    switch ((status || '').toLowerCase()) {
        case 'active':
            return { label: 'Ativa', className: 'bg-green-100 text-green-700 hover:bg-green-100' };
        case 'paid':
            return { label: 'Pago', className: 'bg-green-100 text-green-700 hover:bg-green-100' };
        case 'trialing':
            return { label: 'Em teste', className: 'bg-blue-100 text-blue-700 hover:bg-blue-100' };
        case 'open':
            return { label: 'Aberta', className: 'bg-amber-100 text-amber-700 hover:bg-amber-100' };
        case 'past_due':
            return { label: 'Pagamento pendente', className: 'bg-amber-100 text-amber-700 hover:bg-amber-100' };
        case 'unpaid':
        case 'uncollectible':
            return { label: 'Inadimplente', className: 'bg-red-100 text-red-700 hover:bg-red-100' };
        case 'incomplete':
        case 'incomplete_expired':
            return { label: 'Pendente', className: 'bg-zinc-100 text-zinc-700 hover:bg-zinc-100' };
        case 'canceled':
        case 'cancelled':
        case 'void':
            return { label: 'Cancelada', className: 'bg-zinc-100 text-zinc-700 hover:bg-zinc-100' };
        case 'inactive':
            return { label: 'Inativa', className: 'bg-zinc-100 text-zinc-700 hover:bg-zinc-100' };
        default:
            return { label: 'Sem assinatura', className: 'bg-zinc-100 text-zinc-700 hover:bg-zinc-100' };
    }
}

export default function BillingPage() {
    const { user, loading: userLoading } = useSettings();
    const { toast } = useToast();
    const [planData, setPlanData] = useState<any>(null);
    const [invoices, setInvoices] = useState<any[]>([]);
    const [billingOverview, setBillingOverview] = useState<BillingOverview | null>(null);
    const [loading, setLoading] = useState(true);
    const [showSuccessModal, setShowSuccessModal] = useState(false);
    const [trialDays, setTrialDays] = useState<number | null>(null);
    const [isManagingBilling, setIsManagingBilling] = useState(false);

    const searchParams = useSearchParams();
    const router = useRouter();

    useEffect(() => {
        if (searchParams.get('success') === 'true') {
            setShowSuccessModal(true);
            setTrialDays(Number(searchParams.get('trial_days') || '0') || null);
            router.replace('/settings/billing');
        }
    }, [searchParams, router]);

    useEffect(() => {
        if (!user?.activeWorkspaceId) {
            return;
        }

        setLoading(true);
        Promise.all([
            getCurrentPlanAction(user.activeWorkspaceId),
            getBillingHistoryAction(user.activeWorkspaceId),
            getBillingOverviewAction(user.activeWorkspaceId),
        ])
            .then(([currentPlan, invoicesData, overviewData]) => {
                setPlanData(currentPlan);
                setInvoices('invoices' in invoicesData ? invoicesData.invoices || [] : []);
                setBillingOverview(overviewData.overview || null);
            })
            .finally(() => setLoading(false));
    }, [user, showSuccessModal]);

    async function handleManageBilling() {
        if (!user?.activeWorkspaceId || !billingOverview?.canManage) {
            return;
        }

        if (!billingOverview.portalAvailable) {
            window.location.href = '/pricing';
            return;
        }

        setIsManagingBilling(true);
        const result = await createBillingPortalSessionAction(user.activeWorkspaceId);
        setIsManagingBilling(false);

        if (result.url) {
            window.location.href = result.url;
            return;
        }

        toast({
            title: 'Nao foi possivel abrir o portal',
            description: result.error || 'Tente novamente em instantes.',
            variant: 'destructive',
        });
    }

    if (userLoading || loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    if (!planData) {
        return <p>Nao foi possivel carregar as informacoes do plano.</p>;
    }

    const { plan: currentPlanId, usage, limits } = planData;
    const currentDetails = PLANS[currentPlanId as PlanType] || PLANS.starter;
    const currentPlanPrice = currentPlanId !== 'enterprise'
        ? calculatePlanPrice(currentPlanId as SelfServePlanType, limits.monthly_chats)
        : currentDetails.price;
    const chatsPct = (usage.chats / (limits.monthly_chats || 1)) * 100;
    const whatsappPct = (usage.whatsapp / (limits.whatsapp || 1)) * 100;
    const billingStatus = getBillingStatusMeta(billingOverview?.status);
    const canManageBilling = billingOverview?.canManage ?? false;
    const nextBillingLabel =
        billingOverview?.status?.toLowerCase() === 'trialing'
            ? 'Fim do teste'
            : billingOverview?.cancelAtPeriodEnd
                ? 'Acesso ate'
                : 'Proxima renovacao';

    return (
        <div className="max-w-6xl mx-auto space-y-8 pb-10">
            <Dialog open={showSuccessModal} onOpenChange={setShowSuccessModal}>
                <DialogContent className="sm:max-w-md text-center">
                    <DialogHeader>
                        <div className="mx-auto bg-green-100 p-3 rounded-full w-fit mb-4">
                            <PartyPopper className="h-8 w-8 text-green-600" />
                        </div>
                        <DialogTitle className="text-xl text-center">
                            {trialDays ? `Teste de ${trialDays} dias ativado!` : 'Assinatura iniciada!'}
                        </DialogTitle>
                        <DialogDescription className="text-center pt-2">
                            {trialDays
                                ? 'Seu workspace entrou em teste e os novos limites ja estao disponiveis.'
                                : 'Seu plano foi atualizado com sucesso e os novos limites ja estao disponiveis no workspace.'}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="sm:justify-center mt-4">
                        <Button onClick={() => setShowSuccessModal(false)} className="w-full sm:w-auto min-w-[120px]">
                            Fechar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <header className="mb-6">
                <h1 className="text-2xl font-bold flex items-center gap-2">
                    <CreditCard className="text-primary" />
                    Assinatura e limites
                </h1>
                <p className="text-muted-foreground">Gerencie seu plano, acompanhe chats do mes atual e mantenha a equipe inteira sem limite de usuarios.</p>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card className="md:col-span-1 border-primary/20 bg-primary/5">
                    <CardHeader>
                        <CardTitle className="flex justify-between items-center gap-3">
                            <span>Plano atual</span>
                            <Badge variant="default" className="bg-primary">{currentDetails.label}</Badge>
                        </CardTitle>
                        <CardDescription>
                            {billingOverview?.portalAvailable ? 'Assinatura recorrente gerenciada pela Stripe.' : 'Ainda sem cobranca recorrente ativa.'}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="text-3xl font-bold">
                            {formatCurrency(currentPlanPrice)}
                            <span className="text-sm font-normal text-muted-foreground">/mes</span>
                        </div>

                        <div className="space-y-3 rounded-lg border bg-background/60 p-4 text-sm">
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-muted-foreground">Status</span>
                                <Badge variant="secondary" className={billingStatus.className}>
                                    {billingStatus.label}
                                </Badge>
                            </div>

                            <div className="flex items-center justify-between gap-3">
                                <span className="text-muted-foreground flex items-center gap-2">
                                    <CalendarDays className="h-4 w-4" />
                                    {nextBillingLabel}
                                </span>
                                <span className="font-medium text-right">
                                    {billingOverview?.nextBillingDate ? formatLongDate(billingOverview.nextBillingDate) : 'Nao definida'}
                                </span>
                            </div>
                        </div>

                        {billingOverview?.cancelAtPeriodEnd && billingOverview.nextBillingDate && (
                            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                                A assinatura foi configurada para encerrar no fim do ciclo atual.
                            </p>
                        )}

                        <Button
                            className="w-full"
                            disabled={!canManageBilling || isManagingBilling}
                            onClick={handleManageBilling}
                        >
                            {isManagingBilling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {!canManageBilling
                                ? 'Somente o proprietario pode gerenciar'
                                : billingOverview?.portalAvailable
                                    ? 'Gerenciar assinatura'
                                    : 'Ver planos'}
                        </Button>
                    </CardContent>
                </Card>

                <Card className="md:col-span-2">
                    <CardHeader>
                        <CardTitle>Uso do workspace</CardTitle>
                        <CardDescription>Acompanhe o consumo por chats no mes atual. Usuarios permanecem ilimitados em todos os planos.</CardDescription>
                    </CardHeader>
                    <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="space-y-2">
                            <div className="flex justify-between text-sm">
                                <span className="flex items-center gap-2"><MessageSquare className="w-4 h-4" /> Chats no mes</span>
                                <span className={cn(usage.chats >= limits.monthly_chats ? 'text-destructive font-bold' : 'text-muted-foreground')}>
                                    {usage.chats.toLocaleString('pt-BR')} / {limits.monthly_chats.toLocaleString('pt-BR')}
                                </span>
                            </div>
                            <Progress
                                value={Math.min(chatsPct, 100)}
                                className={cn('h-2', usage.chats >= limits.monthly_chats && 'bg-destructive/20')}
                                indicatorClassName={usage.chats >= limits.monthly_chats ? 'bg-destructive' : ''}
                            />
                            <p className="text-xs text-muted-foreground">Contagem baseada em novos chats criados no mes atual do workspace.</p>
                        </div>

                        <div className="space-y-2">
                            <div className="flex justify-between text-sm">
                                <span className="flex items-center gap-2"><Zap className="w-4 h-4" /> Canais conectados</span>
                                <span className={cn(usage.whatsapp >= limits.whatsapp ? 'text-destructive font-bold' : 'text-muted-foreground')}>
                                    {usage.whatsapp} / {limits.whatsapp}
                                </span>
                            </div>
                            <Progress
                                value={Math.min(whatsappPct, 100)}
                                className={cn('h-2', usage.whatsapp >= limits.whatsapp && 'bg-destructive/20')}
                                indicatorClassName={usage.whatsapp >= limits.whatsapp ? 'bg-destructive' : ''}
                            />
                            <p className="text-xs text-muted-foreground">Canais conectados via QR Code ou API oficial.</p>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <BillingPlanSelector
                currentPlanId={currentPlanId}
                canManageBilling={canManageBilling}
                currentMonthlyChats={limits.monthly_chats}
                hasSubscription={!!billingOverview?.status}
                hasActiveSubscription={['active', 'trialing', 'past_due'].includes(billingOverview?.status?.toLowerCase() || '')}
            />

            <div className="pt-8">
                <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                    <CreditCard className="w-5 h-5" />
                    Historico de faturas
                </h2>
                <Card>
                    <CardContent className="p-0">
                        {invoices.length === 0 ? (
                            <div className="p-8 text-center text-muted-foreground">
                                Nenhuma fatura encontrada.
                            </div>
                        ) : (
                            <table className="w-full text-sm">
                                <thead className="bg-muted/50 border-b">
                                    <tr>
                                        <th className="px-4 py-3 text-left font-medium">Data</th>
                                        <th className="px-4 py-3 text-left font-medium">Valor</th>
                                        <th className="px-4 py-3 text-left font-medium">Status</th>
                                        <th className="px-4 py-3 text-right font-medium">Fatura</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {invoices.map((invoice) => {
                                        const amount = invoice.amount_paid > 0 ? invoice.amount_paid : invoice.amount_due;
                                        const statusMeta = getBillingStatusMeta(invoice.status);

                                        return (
                                            <tr key={invoice.id} className="border-b last:border-0 hover:bg-muted/30">
                                                <td className="px-4 py-3">
                                                    {format(new Date(invoice.created * 1000), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
                                                </td>
                                                <td className="px-4 py-3 font-medium">
                                                    {formatCurrency(amount / 100, invoice.currency)}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <Badge variant="secondary" className={statusMeta.className}>
                                                        {statusMeta.label}
                                                    </Badge>
                                                </td>
                                                <td className="px-4 py-3 text-right">
                                                    {invoice.invoice_pdf && (
                                                        <Button variant="ghost" size="sm" asChild>
                                                            <a href={invoice.invoice_pdf} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1">
                                                                <Download className="w-3 h-3" />
                                                                <span className="hidden sm:inline">PDF</span>
                                                            </a>
                                                        </Button>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </CardContent>
                </Card>
            </div>

            <div className="bg-muted/30 p-4 rounded-lg flex items-start gap-3 mt-8">
                <HelpCircle className="w-5 h-5 text-muted-foreground mt-0.5" />
                <div className="space-y-1">
                    <h4 className="font-semibold text-sm">Precisa de um plano personalizado?</h4>
                    <p className="text-sm text-muted-foreground">
                        Para grandes operacoes ou necessidades especificas de Enterprise, fale com o time comercial.
                    </p>
                </div>
            </div>
        </div>
    );
}
