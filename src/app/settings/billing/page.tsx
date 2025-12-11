
'use client';

import { useSettings } from "../settings-context";
import { Loader2, CreditCard, Check, Zap, Users, MessageSquare, Shield, HelpCircle } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useEffect, useState } from "react";
import { getCurrentPlanAction } from "@/actions/billing-ui";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { PLANS, PlanType } from "@/lib/plans";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";

function formatCurrency(value: number) {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function BillingPage() {
    const { user, loading: userLoading } = useSettings();
    const [planData, setPlanData] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (user?.activeWorkspaceId) {
            setLoading(true);
            getCurrentPlanAction(user.activeWorkspaceId)
                .then((data) => {
                    setPlanData(data);
                })
                .finally(() => setLoading(false));
        }
    }, [user]);

    if (userLoading || loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        )
    }

    if (!planData) {
        return <p>Não foi possível carregar as informações do plano.</p>
    }

    const { plan: currentPlanId, usage, limits } = planData;
    const currentDetails = PLANS[currentPlanId as PlanType] || PLANS['starter'];

    // Calculate usage percentages
    const usersPct = (usage.users / (limits.users || 1)) * 100;
    const whatsappPct = (usage.whatsapp / (limits.whatsapp || 1)) * 100;

    return (
        <div className="max-w-6xl mx-auto space-y-8 pb-10">
            <header className="mb-6">
                <h1 className="text-2xl font-bold flex items-center gap-2">
                    <CreditCard className="text-primary" />
                    Assinatura e Limites
                </h1>
                <p className="text-muted-foreground">Gerencie seu plano atual, acompanhe o uso de recursos e veja opções de upgrade.</p>
            </header>

            {/* Current Plan Status */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card className="md:col-span-1 border-primary/20 bg-primary/5">
                    <CardHeader>
                        <CardTitle className="flex justify-between items-center">
                            Plano Atual
                            <Badge variant="default" className="bg-primary">{currentDetails.label}</Badge>
                        </CardTitle>
                        <CardDescription>
                            Renova mensalmente
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="text-3xl font-bold">
                            {formatCurrency(currentDetails.price)}
                            <span className="text-sm font-normal text-muted-foreground">/mês</span>
                        </div>
                        <Button className="w-full" disabled>Gerenciar Assinatura (Em breve)</Button>
                    </CardContent>
                </Card>

                {/* Usage Stats */}
                <Card className="md:col-span-2">
                    <CardHeader>
                        <CardTitle>Uso do Workspace</CardTitle>
                        <CardDescription>Acompanhe o consumo dos recursos do seu plano.</CardDescription>
                    </CardHeader>
                    <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {/* Users Usage */}
                        <div className="space-y-2">
                            <div className="flex justify-between text-sm">
                                <span className="flex items-center gap-2"><Users className="w-4 h-4" /> Usuários</span>
                                <span className={cn(usage.users >= limits.users ? "text-destructive font-bold" : "text-muted-foreground")}>
                                    {usage.users} / {limits.users}
                                </span>
                            </div>
                            <Progress value={Math.min(usersPct, 100)} className={cn("h-2", usage.users >= limits.users && "bg-destructive/20")} indicatorClassName={usage.users >= limits.users ? "bg-destructive" : ""} />
                            <p className="text-xs text-muted-foreground">Membros da equipe com acesso ao painel.</p>
                        </div>

                        {/* WhatsApp Usage */}
                        <div className="space-y-2">
                            <div className="flex justify-between text-sm">
                                <span className="flex items-center gap-2"><Zap className="w-4 h-4" /> Conexões WhatsApp</span>
                                <span className={cn(usage.whatsapp >= limits.whatsapp ? "text-destructive font-bold" : "text-muted-foreground")}>
                                    {usage.whatsapp} / {limits.whatsapp}
                                </span>
                            </div>
                            <Progress value={Math.min(whatsappPct, 100)} className={cn("h-2", usage.whatsapp >= limits.whatsapp && "bg-destructive/20")} indicatorClassName={usage.whatsapp >= limits.whatsapp ? "bg-destructive" : ""} />
                            <p className="text-xs text-muted-foreground">Números de WhatsApp conectados (Baileys ou API Oficial).</p>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Plans Matrix */}
            <div className="pt-8">
                <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                    <Shield className="w-5 h-5" />
                    Planos Disponíveis
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {Object.values(PLANS).filter(p => p.id !== 'enterprise').map((plan: any) => {
                        const isCurrent = currentPlanId === plan.id;
                        return (
                            <Card key={plan.id} className={cn("relative flex flex-col", isCurrent && "border-primary shadow-md")}>
                                {isCurrent && (
                                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-xs px-3 py-1 rounded-full font-medium">
                                        Plano Atual
                                    </div>
                                )}
                                <CardHeader>
                                    <CardTitle>{plan.label}</CardTitle>
                                    <div className="text-3xl font-bold mt-2">
                                        {formatCurrency(plan.price)}
                                        <span className="text-sm font-normal text-muted-foreground">/mês</span>
                                    </div>
                                    <CardDescription>
                                        {plan.id === 'starter' && "Para quem está começando a escalar."}
                                        {plan.id === 'pro' && "Para equipes em crescimento."}
                                        {plan.id === 'business' && "Para operações robustas."}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4 flex-1">
                                    <ul className="space-y-2 text-sm">
                                        <li className="flex items-center gap-2">
                                            <Check className="w-4 h-4 text-green-500" />
                                            <span>Até <b>{plan.limits.users}</b> usuários</span>
                                        </li>
                                        <li className="flex items-center gap-2">
                                            <Check className="w-4 h-4 text-green-500" />
                                            <span>Até <b>{plan.limits.whatsapp}</b> conexões WhatsApp</span>
                                        </li>
                                        <li className="flex items-center gap-2">
                                            <Check className="w-4 h-4 text-green-500" />
                                            <span>Histórico de <b>{plan.limits.history_months} meses</b></span>
                                        </li>
                                        <li className="flex items-center gap-2">
                                            {plan.limits.departments ? <Check className="w-4 h-4 text-green-500" /> : <Check className="w-4 h-4 text-muted-foreground opacity-20" />}
                                            <span className={!plan.limits.departments ? "text-muted-foreground line-through decoration-slate-400/50" : ""}>Departamentos</span>
                                        </li>
                                        <li className="flex items-center gap-2">
                                            {plan.limits.campaigns ? <Check className="w-4 h-4 text-green-500" /> : <Check className="w-4 h-4 text-muted-foreground opacity-20" />}
                                            <span className={!plan.limits.campaigns ? "text-muted-foreground line-through decoration-slate-400/50" : ""}>
                                                Campanhas de Disparo
                                            </span>
                                        </li>
                                        <li className="flex items-center gap-2">
                                            {plan.limits.api ? <Check className="w-4 h-4 text-green-500" /> : <Check className="w-4 h-4 text-muted-foreground opacity-20" />}
                                            <span className={!plan.limits.api ? "text-muted-foreground line-through decoration-slate-400/50" : ""}>API & Webhooks</span>
                                        </li>
                                    </ul>
                                </CardContent>
                                <CardFooter>
                                    <Button
                                        className="w-full"
                                        variant={isCurrent ? "outline" : "default"}
                                        disabled={isCurrent}
                                        onClick={() => window.open(`https://wa.me/5511999999999?text=Olá, gostaria de fazer upgrade para o plano ${plan.label}`, '_blank')}
                                    >
                                        {isCurrent ? "Plano Atual" : "Fazer Upgrade"}
                                    </Button>
                                </CardFooter>
                            </Card>
                        )
                    })}
                </div>
            </div>

            <div className="bg-muted/30 p-4 rounded-lg flex items-start gap-3 mt-8">
                <HelpCircle className="w-5 h-5 text-muted-foreground mt-0.5" />
                <div className="space-y-1">
                    <h4 className="font-semibold text-sm">Precisa de um plano personalizado?</h4>
                    <p className="text-sm text-muted-foreground">
                        Para grandes operações ou necessidades específicas de Enterprise, entre em contato com nosso time de vendas para uma cotação sob medida.
                    </p>
                </div>
            </div>
        </div>
    )
}
