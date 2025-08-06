
'use client';

import React, { useState } from 'react';
import { MainLayout } from '@/components/layout/main-layout';
import type { User, NexusFlowInstance } from '@/lib/types';
import { agents, nexusFlowInstances as mockInstances } from '@/lib/mock-data';
import { createClient } from '@/lib/supabase/client';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Plus, Trash2, Edit, MoreVertical, Zap } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';


export default function NexusFlowPage() {
    const [user, setUser] = React.useState<User | null>(null);
    const [instances, setInstances] = useState<NexusFlowInstance[]>(mockInstances);
    const supabase = createClient();

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
                        <h1 className="text-2xl font-bold">Automações NexusFlow</h1>
                        <p className="text-muted-foreground">Crie regras para que o piloto automático responda a situações específicas.</p>
                    </div>
                    <Button>
                        <Plus className="mr-2 h-4 w-4" />
                        Adicionar Automação
                    </Button>
                </header>
                <main className="flex-1 overflow-y-auto bg-muted/40 p-4 sm:p-6">
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
                                     <CardDescription>ID: {instance.id}</CardDescription>
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
                                <div className="p-4 border-t flex items-center justify-between">
                                     <span className="text-sm font-medium">{instance.enabled ? 'Ativa' : 'Inativa'}</span>
                                      <Switch
                                        id={`status-${instance.id}`}
                                        checked={instance.enabled}
                                        // onCheckedChange={(checked) => handleToggle(instance.id, checked)}
                                    />
                                </div>
                            </Card>
                        ))}
                    </div>
                </main>
            </div>
        </MainLayout>
    );
}
