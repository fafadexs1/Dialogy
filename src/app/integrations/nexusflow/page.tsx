
'use client';

import React, { useState } from 'react';
import { MainLayout } from '@/components/layout/main-layout';
import type { User, NexusFlowInstance } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Plus, Trash2, Edit, MoreVertical, Webhook, Loader2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/use-auth';

// Mock data for initial instances
const initialInstances = [
    { id: 'inst-1', agentName: 'Agente de Vendas', webhookUrl: 'https://api.example.com/webhook/sales', enabled: true },
    { id: 'inst-2', agentName: 'Agente de Suporte N1', webhookUrl: 'https://api.example.com/webhook/support-n1', enabled: true },
    { id: 'inst-3', agentName: 'Agente Financeiro', webhookUrl: 'https://api.example.com/webhook/billing', enabled: false },
]

export default function NexusFlowPage() {
    const user = useAuth();
    const [instances, setInstances] = useState(initialInstances);

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
                        <h1 className="text-2xl font-bold flex items-center gap-2"><Webhook /> Gerenciador de Instâncias NexusFlow</h1>
                        <p className="text-muted-foreground">Adicione e configure webhooks para direcionar conversas para seus robôs.</p>
                    </div>
                    {/* This would open a modal or a new view to add an instance */}
                    <Button>
                        <Plus className="mr-2 h-4 w-4" />
                        Adicionar Instância
                    </Button>
                </header>
                <main className="flex-1 overflow-y-auto bg-muted/40 p-4 sm:p-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {instances.map(instance => (
                            <Card key={instance.id} className="flex flex-col">
                                <CardHeader>
                                    <div className="flex justify-between items-start">
                                        <CardTitle className="max-w-[80%] break-words flex items-center gap-2">
                                            {instance.agentName}
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
                                </CardHeader>
                                <CardContent className="space-y-4 flex-grow">
                                     <div className="space-y-2">
                                        <Label htmlFor={`webhook-url-${instance.id}`}>URL do Webhook</Label>
                                        <Input id={`webhook-url-${instance.id}`} value={instance.webhookUrl} readOnly />
                                    </div>
                                </CardContent>
                                <CardFooter className="p-4 border-t flex items-center justify-between">
                                     <span className="text-sm font-medium">Habilitar instância</span>
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
