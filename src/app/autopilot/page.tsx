

'use client';

import React, { useState } from 'react';
import { MainLayout } from '@/components/layout/main-layout';
import type { User, NexusFlowInstance } from '@/lib/types';
import { agents, nexusFlowInstances as mockInstances } from '@/lib/mock-data';
import { createClient } from '@/lib/supabase/client';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Plus, Trash2, Edit, MoreVertical, Zap, Bot, DollarSign, BrainCircuit, FileText, Globe, Upload } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';


const mockKnowledgeBase = [
    { id: 'kb-1', type: 'text', title: 'Política de Devolução', content: 'Nossa política de devolução permite que os clientes retornem produtos em até 30 dias após a compra, desde que o produto esteja em sua embalagem original e sem sinais de uso. O cliente deve apresentar o recibo original. Para produtos com defeito, a troca é garantida em até 90 dias.'},
    { id: 'kb-2', type: 'url', title: 'Perguntas Frequentes (FAQ)', content: 'https://dialogy.com/faq' },
];


export default function AutopilotPage() {
    const [user, setUser] = React.useState<User | null>(null);
    const [instances, setInstances] = useState<NexusFlowInstance[]>(mockInstances);
    const supabase = createClient();

    // These would come from a billing service or usage metrics
    const estimatedMonthlyCost = 12.50;
    const currentMonthCost = 4.75;
    const executionsThisMonth = 950;


    React.useEffect(() => {
        const fetchUser = async () => {
            const { data: { user: authUser } } = await supabase.auth.getUser();
            if (authUser) {
                 const appUser = agents.find(a => a.email === authUser.email) || {
                    ...agents[0],
                    name: authUser.user_metadata.full_name || authUser.email,
                    email: authUser.email,
                    id: authUser.id
                };
                setUser(appUser);
            } else {
                redirect('/login');
            }
        };
        fetchUser();
    }, [supabase.auth]);

    if (!user) {
        return null; // Or a loading spinner
    }

    return (
        <MainLayout user={user}>
            <div className="flex flex-col flex-1 h-full">
                <header className="p-4 sm:p-6 border-b flex-shrink-0 bg-background flex justify-between items-center">
                    <div>
                        <h1 className="text-2xl font-bold flex items-center gap-2"><Bot /> Piloto Automático</h1>
                        <p className="text-muted-foreground">Crie regras e automações para que o Dialogy responda por você.</p>
                    </div>
                    <Button>
                        <Plus className="mr-2 h-4 w-4" />
                        Adicionar Automação
                    </Button>
                </header>
                <main className="flex-1 overflow-y-auto bg-muted/40 p-4 sm:p-6">
                    
                    <Card className="mb-6">
                        <CardHeader>
                            <CardTitle>Visão Geral de Custos e Uso</CardTitle>
                            <CardDescription>Acompanhe o consumo e os custos gerados pelas execuções do Piloto Automático.</CardDescription>
                        </CardHeader>
                        <CardContent>
                           <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
                                <div className='p-4 rounded-lg bg-secondary/50'>
                                    <p className="text-sm text-muted-foreground font-semibold">Execuções este Mês</p>
                                    <p className="text-2xl font-bold flex items-center justify-center gap-2">
                                        <BrainCircuit className="h-6 w-6 text-primary"/>
                                        {executionsThisMonth.toLocaleString('pt-BR')}
                                    </p>
                                </div>
                                <div className='p-4 rounded-lg bg-secondary/50'>
                                    <p className="text-sm text-muted-foreground font-semibold">Custo do Mês Atual</p>
                                    <p className="text-2xl font-bold flex items-center justify-center gap-2">
                                         <DollarSign className="h-6 w-6 text-green-500"/>
                                        {currentMonthCost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                    </p>
                                </div>
                                 <div className='p-4 rounded-lg bg-secondary/50'>
                                    <p className="text-sm text-muted-foreground font-semibold">Custo Mensal Estimado</p>
                                    <p className="text-2xl font-bold flex items-center justify-center gap-2">
                                         <DollarSign className="h-6 w-6 text-amber-500"/>
                                        {estimatedMonthlyCost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                    </p>
                                </div>
                           </div>
                        </CardContent>
                    </Card>

                    <Separator className="my-6" />

                     <Card className="mb-6">
                        <CardHeader>
                            <CardTitle>Base de Conhecimento do Piloto Automático</CardTitle>
                            <CardDescription>Forneça documentos, textos e links para que a IA entenda o contexto do seu negócio e responda de forma mais precisa.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-4">
                                     <h3 className="font-semibold text-muted-foreground">Fontes de Conhecimento Atuais</h3>
                                     <div className="space-y-3">
                                        {mockKnowledgeBase.map(item => (
                                            <div key={item.id} className="flex items-start justify-between p-3 border rounded-md bg-background">
                                               <div className="flex items-start gap-3">
                                                 {item.type === 'text' ? <FileText className="h-5 w-5 text-primary mt-1" /> : <Globe className="h-5 w-5 text-primary mt-1" />}
                                                 <div>
                                                     <p className="font-medium">{item.title}</p>
                                                     <p className="text-sm text-muted-foreground truncate max-w-sm">{item.content}</p>
                                                 </div>
                                               </div>
                                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        ))}
                                     </div>
                                </div>
                                 <div className="space-y-4 p-4 rounded-lg bg-secondary/50">
                                     <h3 className="font-semibold text-muted-foreground">Adicionar Novo Conhecimento</h3>
                                    <Button className="w-full justify-start">
                                        <Upload className="mr-2 h-4 w-4" /> Fazer Upload de Arquivo
                                    </Button>
                                    <div className="space-y-2">
                                        <Textarea placeholder="Ou cole um texto aqui para a IA aprender..." rows={5} />
                                         <Button size="sm">Adicionar Texto</Button>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Separator className="my-6" />

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
