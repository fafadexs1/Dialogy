
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getBillingData, type BillingData } from "@/actions/billing";
import { DollarSign, Server, Badge, Smartphone } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";

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

export default async function BillingPage() {
    const { data, error } = await getBillingData();

    if (error || !data) {
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
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                 <StatCard 
                    title="Receita Total Mensal"
                    value={formatCurrency(data.totalCost)}
                    icon={DollarSign}
                    description={`${data.totalBaileysInstances + data.totalCloudInstances} instâncias ativas`}
                />
                 <StatCard 
                    title="Instâncias Baileys"
                    value={data.totalBaileysInstances.toString()}
                    icon={Server}
                    description={`Receita de ${formatCurrency(data.totalBaileysCost)}`}
                />
                <StatCard 
                    title="Instâncias Cloud API"
                    value={data.totalCloudInstances.toString()}
                    icon={Smartphone}
                    description={`Receita de ${formatCurrency(data.totalCloudCost)}`}
                />
                 <StatCard 
                    title="Ticket Médio"
                    value={formatCurrency(data.totalCost / (data.workspaces.length || 1))}
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
                            {data.workspaces.map(ws => (
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
                             {data.workspaces.length === 0 && (
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
