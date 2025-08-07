

'use client';

import React, { useState } from 'react';
import { MainLayout } from '@/components/layout/main-layout';
import type { User, NexusFlowInstance } from '@/lib/types';
import { nexusFlowInstances as mockInstances } from '@/lib/mock-data';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Plus, Trash2, Edit, MoreVertical, Zap, Bot, DollarSign, BrainCircuit, Cog, ArrowDown, ArrowUp, KeyRound, Loader2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { BarChart, ResponsiveContainer, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/use-auth';


type ModelInfo = {
    name: string;
    description: string;
    inputCost: string;
    outputCost: string;
    contextWindow: string;
}

const modelInfo: Record<string, ModelInfo> = {
    'googleai/gemini-2.0-flash': {
        name: 'Gemini 2.0 Flash',
        description: 'Otimizado para velocidade e custo, ideal para respostas rápidas e automações de alto volume.',
        inputCost: 'R$ 0,94',
        outputCost: 'R$ 1,87',
        contextWindow: '1M tokens'
    },
    'googleai/gemini-2.0-pro': {
        name: 'Gemini 2.0 Pro',
        description: 'Modelo mais poderoso, ideal para tarefas complexas que exigem raciocínio avançado.',
        inputCost: 'R$ 18,70',
        outputCost: 'R$ 56,10',
        contextWindow: '1M tokens'
    }
}

const chartData = [
  { month: "Jan", executions: 186 },
  { month: "Fev", executions: 305 },
  { month: "Mar", executions: 237 },
  { month: "Abr", executions: 73 },
  { month: "Mai", executions: 209 },
  { month: "Jun", executions: 214 },
]

const chartConfig = {
  executions: {
    label: "Execuções",
    color: "hsl(var(--primary))",
  },
}


export default function AutopilotPage() {
    const user = useAuth();
    const [instances, setInstances] = useState<NexusFlowInstance[]>(mockInstances);
    const [aiModel, setAiModel] = useState<string>('googleai/gemini-2.0-flash');

    // These would come from a billing service or usage metrics
    const estimatedMonthlyCost = 12.50;
    const currentMonthCost = 4.75;
    const executionsThisMonth = 950;
    const tokensThisMonth = 254000;
    
    const selectedModelInfo = modelInfo[aiModel];

    if (!user) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loader2 className="h-8 w-8 animate-spin text-primary"/>
            </div>
        )
    }

    return (
        <MainLayout user={user}>
            <div className="flex flex-col flex-1 h-full">
                <header className="p-4 sm:p-6 border-b flex-shrink-0 bg-background flex justify-between items-center">
                    <div>
                        <h1 className="text-2xl font-bold flex items-center gap-2"><Bot /> Piloto Automático</h1>
                        <p className="text-muted-foreground">Crie e gerencie regras para que o Dialogy responda por você.</p>
                    </div>
                    <Button>
                        <Plus className="mr-2 h-4 w-4" />
                        Adicionar Automação
                    </Button>
                </header>
                <main className="flex-1 overflow-y-auto bg-muted/40 p-4 sm:p-6">
                    
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-6">
                        <Card className="lg:col-span-8">
                            <CardHeader>
                                <CardTitle>Visão Geral de Custos e Uso</CardTitle>
                                <CardDescription>Acompanhe o consumo e os custos gerados pelas execuções do Piloto Automático.</CardDescription>
                            </CardHeader>
                            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-4">
                                    <h3 className="font-semibold text-muted-foreground">Métricas do Mês Atual</h3>
                                    <div className="grid grid-cols-2 gap-4 text-center">
                                        <div className='p-4 rounded-lg bg-secondary/50'>
                                            <p className="text-sm text-muted-foreground font-semibold">Execuções</p>
                                            <p className="text-2xl font-bold flex items-center justify-center gap-2">
                                                <BrainCircuit className="h-6 w-6 text-primary"/>
                                                {executionsThisMonth.toLocaleString('pt-BR')}
                                            </p>
                                        </div>
                                         <div className='p-4 rounded-lg bg-secondary/50'>
                                            <p className="text-sm text-muted-foreground font-semibold">Tokens Usados</p>
                                            <p className="text-2xl font-bold flex items-center justify-center gap-2">
                                                <BrainCircuit className="h-6 w-6 text-purple-500"/>
                                                {Math.round(tokensThisMonth / 1000)}k
                                            </p>
                                        </div>
                                        <div className='p-4 rounded-lg bg-secondary/50'>
                                            <p className="text-sm text-muted-foreground font-semibold">Custo Atual</p>
                                            <p className="text-2xl font-bold flex items-center justify-center gap-2">
                                                <DollarSign className="h-6 w-6 text-green-500"/>
                                                {currentMonthCost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                            </p>
                                        </div>
                                        <div className='p-4 rounded-lg bg-secondary/50'>
                                            <p className="text-sm text-muted-foreground font-semibold">Custo Estimado</p>
                                            <p className="text-2xl font-bold flex items-center justify-center gap-2">
                                                <DollarSign className="h-6 w-6 text-amber-500"/>
                                                {estimatedMonthlyCost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                                <div className="space-y-4">
                                    <h3 className="font-semibold text-muted-foreground">Execuções nos Últimos 6 Meses</h3>
                                     <ChartContainer config={chartConfig} className="h-[200px] w-full">
                                        <BarChart accessibilityLayer data={chartData}>
                                            <XAxis
                                            dataKey="month"
                                            tickLine={false}
                                            tickMargin={10}
                                            axisLine={false}
                                            tickFormatter={(value) => value.slice(0, 3)}
                                            />
                                            <YAxis tickLine={false} axisLine={false} />
                                            <ChartTooltip
                                            cursor={false}
                                            content={<ChartTooltipContent indicator="dot" />}
                                            />
                                            <Bar dataKey="executions" fill="var(--color-executions)" radius={4} />
                                        </BarChart>
                                    </ChartContainer>
                                </div>
                            </CardContent>
                        </Card>
                        <div className="lg:col-span-4 space-y-6">
                            <Card>
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2"><Cog/> Configurações do Modelo</CardTitle>
                                    <CardDescription>Selecione o modelo de IA que potencializa as automações.</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="space-y-2">
                                        <Label htmlFor="ai-model">Modelo de IA</Label>
                                        <Select value={aiModel} onValueChange={setAiModel}>
                                            <SelectTrigger id="ai-model">
                                                <SelectValue placeholder="Selecione um modelo" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="googleai/gemini-2.0-flash">Gemini 2.0 Flash (Rápido)</SelectItem>
                                                <SelectItem value="googleai/gemini-2.0-pro">Gemini 2.0 Pro (Avançado)</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        {selectedModelInfo && (
                                            <div className="pt-2 space-y-3 animate-in fade-in-50">
                                                <p className="text-xs text-muted-foreground">{selectedModelInfo.description}</p>
                                                <div className="grid grid-cols-2 gap-3 text-center">
                                                    <div className="p-2 border rounded-lg">
                                                        <p className="text-xs font-semibold text-muted-foreground flex items-center justify-center gap-1"><ArrowDown className='text-green-500'/> Entrada</p>
                                                        <p className="text-sm font-bold">{selectedModelInfo.inputCost}*</p>
                                                    </div>
                                                    <div className="p-2 border rounded-lg">
                                                        <p className="text-xs font-semibold text-muted-foreground flex items-center justify-center gap-1"><ArrowUp className='text-blue-500'/> Saída</p>
                                                        <p className="text-sm font-bold">{selectedModelInfo.outputCost}*</p>
                                                    </div>
                                                </div>
                                                <div className="p-2 border rounded-lg text-center">
                                                    <p className="text-xs font-semibold text-muted-foreground flex items-center justify-center gap-1"><BrainCircuit className='text-purple-500'/> Janela de Contexto</p>
                                                    <p className="text-sm font-bold">{selectedModelInfo.contextWindow}</p>
                                                </div>
                                                <p className="text-[10px] text-muted-foreground/80 leading-tight">* Preços por 1 milhão de tokens. Os valores são estimativas e podem variar.</p>
                                            </div>
                                        )}
                                    </div>
                                </CardContent>
                            </Card>
                             <Card>
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2"><KeyRound/> Credenciais da API Gemini</CardTitle>
                                    <CardDescription>Insira sua chave de API para habilitar as funcionalidades do Piloto Automático.</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="space-y-2">
                                        <Label htmlFor="gemini-api-key">Sua Chave de API</Label>
                                        <Input id="gemini-api-key" type="password" placeholder="••••••••••••••••••••••••••" />
                                        <p className='text-xs text-muted-foreground pt-1'>Sua chave é armazenada de forma segura e usada apenas para as chamadas de IA.</p>
                                    </div>
                                </CardContent>
                                <CardFooter>
                                    <Button>Salvar</Button>
                                </CardFooter>
                            </Card>
                        </div>
                    </div>

                    <Separator className="my-8" />

                    <h2 className="text-xl font-bold mb-4">Regras de Automação Ativas</h2>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {instances.map(instance => (
                            <Card key={instance.id} className="flex flex-col">
                                <CardHeader>
                                    <div className="flex justify-between items-start">
                                        <CardTitle className="max-w-[80%] break-words flex items-center gap-2">
                                            <Zap className="h-5 w-5 text-primary"/>
                                            {instance.name}
                                        </CardTitle>
                                         <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                                    <MoreVertical className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuItem>
                                                    <Edit className="mr-2 h-4 w-4" />
                                                    Editar
                                                </DropdownMenuItem>
                                                <DropdownMenuItem className="text-destructive">
                                                    <Trash2 className="mr-2 h-4 w-4" />
                                                    Remover
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </div>
                                     <CardDescription>
                                        <Badge variant={instance.enabled ? "default" : "secondary"}>
                                            {instance.enabled ? 'Ativa' : 'Inativa'}
                                        </Badge>
                                     </CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4 flex-grow">
                                     <div className="space-y-2">
                                        <p className="text-sm font-medium text-muted-foreground">Gatilho (Quando)</p>
                                        <p className="p-3 rounded-md bg-secondary/50 border text-sm">{instance.trigger}</p>
                                    </div>
                                    <div className="space-y-2">
                                        <p className="text-sm font-medium text-muted-foreground">Ação (Então)</p>
                                        <p className="p-3 rounded-md bg-secondary/50 border text-sm">{instance.action}</p>
                                    </div>
                                </CardContent>
                                <CardFooter className="p-4 border-t flex items-center justify-between">
                                     <span className="text-sm font-medium">Habilitar automação</span>
                                      <Switch
                                        id={`status-${instance.id}`}
                                        checked={instance.enabled}
                                        // onCheckedChange={(checked) => handleToggle(instance.id, checked)}
                                    />
                                </CardFooter>
                            </Card>
                        ))}
                    </div>
                </main>
            </div>
        </MainLayout>
    );
}
