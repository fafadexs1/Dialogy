
'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getBillingData, type BillingData, getInstanceCosts, updateInstanceCosts, type InstanceCost } from "@/actions/billing";
import { DollarSign, Server, Smartphone, Badge, Save, Loader2 } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";

function StatCard({ title, value, icon: Icon, description }: { title: string, value: string, icon: React.ElementType, description: string }) {
    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{title}</CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold">{value}</div>
                <p className="text-xs text-muted-foreground">{description}</p>
            </CardContent>
        </Card>
    );
}

function formatCurrency(value: number) {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function CostSettings({ initialCosts }: { initialCosts: InstanceCost[] }) {
    const [costs, setCosts] = useState({
        baileys: initialCosts.find(c => c.type === 'baileys')?.cost || 0,
        wa_cloud: initialCosts.find(c => c.type === 'wa_cloud')?.cost || 0,
    });
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSave = async () => {
        setIsSubmitting(true);
        const result = await updateInstanceCosts(costs);
        if (result.success) {
            toast({ title: 'Custos atualizados com sucesso!' });
        } else {
            toast({ title: 'Erro ao atualizar custos', description: result.error, variant: 'destructive' });
        }
        setIsSubmitting(false);
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Configuração de Custos</CardTitle>
                <CardDescription>Defina o valor cobrado por cada tipo de instância por mês.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                    <Label htmlFor="baileys-cost" className="flex items-center gap-2"><Server className="h-4 w-4" /> Custo Instância Baileys (R$)</Label>
                    <Input 
                        id="baileys-cost" 
                        type="number" 
                        value={costs.baileys}
                        onChange={(e) => setCosts(prev => ({ ...prev, baileys: parseFloat(e.target.value) || 0 }))}
                    />
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="cloud-cost" className="flex items-center gap-2"><Smartphone className="h-4 w-4" /> Custo Instância Cloud API (R$)</Label>
                    <Input 
                        id="cloud-cost" 
                        type="number" 
                        value={costs.wa_cloud}
                        onChange={(e) => setCosts(prev => ({ ...prev, wa_cloud: parseFloat(e.target.value) || 0 }))}
                    />
                </div>
            </CardContent>
            <CardFooter>
                 <Button onClick={handleSave} disabled={isSubmitting}>
                    {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}
                    <Save className="mr-2 h-4 w-4"/>
                    Salvar Custos
                </Button>
            </CardFooter>
        </Card>
    )
}

export default function BillingPage() {
    const [billingData, setBillingData] = useState<BillingData | null>(null);
    const [instanceCosts, setInstanceCosts] = useState<InstanceCost[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function loadData() {
            setLoading(true);
            const [billingRes, costsRes] = await Promise.all([
                getBillingData(),
                getInstanceCosts()
            ]);

            if (billingRes.error || !billingRes.data) {
                setError(billingRes.error || "Ocorreu um erro desconhecido.");
            } else {
                setBillingData(billingRes.data);
            }
            
            setInstanceCosts(costsRes || []);
            setLoading(false);
        }
        loadData();
    }, []);


    if (loading) {
        return <div>Carregando...</div>
    }

    if (error || !billingData) {
        return (
             <Card>
                <CardHeader>
                    <CardTitle>Erro ao carregar dados</CardTitle>
                    <CardDescription>
                        Não foi possível buscar as informações de faturamento.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-destructive">{error || "Ocorreu um erro desconhecido."}</p>
                </CardContent>
            </Card>
        )
    }

    return (
        <div className="space-y-6">
             <CostSettings initialCosts={instanceCosts} />
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                 <StatCard 
                    title="Receita Total Mensal"
                    value={formatCurrency(billingData.totalCost)}
                    icon={DollarSign}
                    description={`${billingData.totalBaileysInstances + billingData.totalCloudInstances} instâncias ativas`}
                />
                 <StatCard 
                    title="Instâncias Baileys"
                    value={billingData.totalBaileysInstances.toString()}
                    icon={Server}
                    description={`Receita de ${formatCurrency(billingData.totalBaileysCost)}`}
                />
                <StatCard 
                    title="Instâncias Cloud API"
                    value={billingData.totalCloudInstances.toString()}
                    icon={Smartphone}
                    description={`Receita de ${formatCurrency(billingData.totalCloudCost)}`}
                />
                 <StatCard 
                    title="Ticket Médio"
                    value={formatCurrency(billingData.totalCost / (billingData.workspaces.length || 1))}
                    icon={Badge}
                    description={`Por workspace`}
                />
            </div>
            
             <Card>
                <CardHeader>
                    <CardTitle>Faturamento por Workspace</CardTitle>
                    <CardDescription>
                        Detalhes dos custos de cada workspace baseado nas instâncias ativas.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Workspace</TableHead>
                                <TableHead>Proprietário</TableHead>
                                <TableHead className="text-center">Instâncias Baileys</TableHead>
                                <TableHead className="text-center">Instâncias Cloud API</TableHead>
                                <TableHead className="text-right">Subtotal</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {billingData.workspaces.map(ws => (
                                <TableRow key={ws.id}>
                                    <TableCell className="font-medium">{ws.name}</TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-2">
                                            <Avatar className="h-6 w-6">
                                                <AvatarImage src={`https://api.dicebear.com/8.x/initials/svg?seed=${encodeURIComponent(ws.owner_name)}`} />
                                                <AvatarFallback>{ws.owner_name.charAt(0)}</AvatarFallback>
                                            </Avatar>
                                            {ws.owner_name}
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-center">{ws.baileys_count}</TableCell>
                                    <TableCell className="text-center">{ws.cloud_count}</TableCell>
                                    <TableCell className="text-right font-semibold">{formatCurrency(ws.subtotal)}</TableCell>
                                </TableRow>
                            ))}
                             {billingData.workspaces.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                                        Nenhum workspace com instâncias encontrado.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    )
}
