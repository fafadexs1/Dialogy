

'use client';

import React, { useState } from 'react';
import { MainLayout } from '@/components/layout/main-layout';
import type { User, NexusFlowInstance } from '@/lib/types';
import { agents, nexusFlowInstances as mockInstances } from '@/lib/mock-data';
import { createClient } from '@/lib/supabase/client';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Plus, Trash2, Edit, MoreVertical } from 'lucide-react';
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
                        <p className="text-muted-foreground">Gerencie seus webhooks para conectar agentes de automação.</p>
                    </div>
                    <Button>
                        <Plus className="mr-2 h-4 w-4" />
                        Adicionar Webhook
                    </Button>
                </header>
                <main className="flex-1 overflow-y-auto bg-muted/40 p-4 sm:p-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {instances.map(instance => (
                            <Card key={instance.id}>
                                <CardHeader>
                                    <div className="flex justify-between items-start">
                                        <CardTitle className="max-w-[80%] break-words">{instance.agentName}</CardTitle>
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
                                <CardContent className="space-y-4">
                                     <div className="space-y-1">
                                        <Label htmlFor={`webhook-url-${instance.id}`}>URL do Webhook</Label>
                                        <Input id={`webhook-url-${instance.id}`} value={instance.webhookUrl} readOnly />
                                    </div>
                                </CardContent>
                                <CardFooter>
                                     <div className="flex items-center justify-between w-full">
                                        <Label htmlFor={`status-${instance.id}`} className="flex items-center gap-2 text-sm font-normal text-muted-foreground cursor-pointer">
                                            Status
                                        </Label>
                                        <div className="flex items-center gap-2">
                                            <Switch
                                                id={`status-${instance.id}`}
                                                checked={instance.enabled}
                                                // onCheckedChange={(checked) => handleToggle(instance.id, checked)}
                                            />
                                            <span className="text-sm font-medium">{instance.enabled ? 'Ativo' : 'Inativo'}</span>
                                        </div>
                                    </div>
                                </CardFooter>
                            </Card>
                        ))}
                    </div>
                </main>
            </div>
        </MainLayout>
    );
}
