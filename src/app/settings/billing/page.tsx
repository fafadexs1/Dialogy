
'use client';

import { useSettings } from "../settings-context";
import { Loader2, CreditCard, Calendar, CheckCircle2, AlertCircle, FileText } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useEffect, useState } from "react";
import { getUserBillingData, getInstanceCosts } from "@/actions/billing";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { InstanceCost } from "@/lib/types";

function formatCurrency(value: number) {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function BillingPage() {
    const { user, loading: userLoading } = useSettings();
    const [billingInfo, setBillingInfo] = useState<any>(null);
    const [costs, setCosts] = useState<InstanceCost[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if(user?.activeWorkspaceId) {
            setLoading(true);
            Promise.all([
                getUserBillingData(user.activeWorkspaceId),
                getInstanceCosts()
            ]).then(([billingData, costsData]) => {
                setBillingInfo(billingData);
                setCosts(costsData);
                setLoading(false);
            })
        }
    }, [user]);

    const getCost = (type: 'baileys' | 'wa_cloud') => {
        return costs.find(c => c.type === type)?.cost || 0;
    }


    if (userLoading || loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        )
    }

    if (!billingInfo) {
        return <p>Não foi possível carregar as informações de cobrança.</p>
    }

    return (
        <div className="max-w-4xl mx-auto space-y-8">
            <header className="mb-6">
                <h1 className="text-2xl font-bold flex items-center gap-2">
                    <CreditCard />
                    Cobrança e Faturas
                </h1>
                <p className="text-muted-foreground">Gerencie seu plano, veja seu histórico de pagamentos e informações de cobrança.</p>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 <Card>
                    <CardHeader>
                        <CardTitle>Plano Atual</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <p className="text-4xl font-bold text-primary">{billingInfo.plan}</p>
                        <p className="text-sm text-muted-foreground">Sua próxima cobrança será em <span className="font-semibold">{format(new Date(billingInfo.nextBillingDate), 'dd/MM/yyyy', { locale: ptBR })}</span>.</p>
                    </CardContent>
                    <CardFooter>
                        <Button variant="outline">Gerenciar Assinatura</Button>
                    </CardFooter>
                </Card>
                 <Card>
                    <CardHeader>
                        <CardTitle>Preços Atuais</CardTitle>
                        <CardDescription>Valores por instância ativa por mês.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                         <div className="flex justify-between items-center">
                            <span className="text-muted-foreground">Instância Baileys</span>
                            <span className="font-semibold">{formatCurrency(getCost('baileys'))}</span>
                        </div>
                         <div className="flex justify-between items-center">
                            <span className="text-muted-foreground">Instância Cloud API</span>
                            <span className="font-semibold">{formatCurrency(getCost('wa_cloud'))}</span>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Histórico de Faturas</CardTitle>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Data da Fatura</TableHead>
                                <TableHead>Valor</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">Ações</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {billingInfo.invoices.map((invoice: any) => (
                                <TableRow key={invoice.id}>
                                    <TableCell>{format(new Date(invoice.date), 'dd/MM/yyyy', { locale: ptBR })}</TableCell>
                                    <TableCell className="font-medium">{formatCurrency(invoice.amount)}</TableCell>
                                    <TableCell>
                                        <Badge variant={invoice.status === 'paid' ? 'default' : 'destructive'} className={invoice.status === 'paid' ? 'bg-green-600' : ''}>
                                            {invoice.status === 'paid' ? <CheckCircle2 className="mr-1.5 h-3.5 w-3.5"/> : <AlertCircle className="mr-1.5 h-3.5 w-3.5"/>}
                                            {invoice.status === 'paid' ? 'Paga' : 'Pendente'}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button variant="outline" size="sm">
                                            <FileText className="mr-2 h-4 w-4"/>
                                            Ver Fatura
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

        </div>
    )
}
