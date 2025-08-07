
'use client';

import React, { useState } from 'react';
import { MainLayout } from '@/components/layout/main-layout';
import type { User } from '@/lib/types';
import { agents } from '@/lib/mock-data';
import { createClient } from '@/lib/supabase/client';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { KeyRound, Server, Zap, QrCode, Power, PowerOff, ShieldCheck, ShieldOff, Plus, MoreVertical, Trash2, Edit } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type ConnectionStatus = 'connected' | 'disconnected' | 'pending';

interface EvolutionInstance {
    id: string;
    name: string;
    apiUrl: string;
    apiKey: string;
    status: ConnectionStatus;
}

const mockInstances: EvolutionInstance[] = [
    { id: 'inst-1', name: 'Atendimento Matriz', apiUrl: 'https://api1.example.com', apiKey: 'key-1', status: 'connected'},
    { id: 'inst-2', name: 'Vendas SP', apiUrl: 'https://api2.example.com', apiKey: 'key-2', status: 'disconnected'},
    { id: 'inst-3', name: 'Suporte Beta', apiUrl: 'https://api3.example.com', apiKey: 'key-3', status: 'pending'},
]


export default function EvolutionApiPage() {
    const [user, setUser] = React.useState<User | null>(null);
    const [instances, setInstances] = useState<EvolutionInstance[]>(mockInstances);
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

    const getStatusInfo = (status: ConnectionStatus) => {
        switch (status) {
            case 'connected':
                return { text: 'Conectado', color: 'bg-green-500', icon: <ShieldCheck className="h-4 w-4" /> };
            case 'disconnected':
                return { text: 'Desconectado', color: 'bg-red-500', icon: <ShieldOff className="h-4 w-4" /> };
            case 'pending':
                return { text: 'Pendente', color: 'bg-yellow-500', icon: <QrCode className="h-4 w-4" /> };
        }
    }

    if (!user) {
        return null; // Or a loading spinner
    }

    return (
        <MainLayout user={user}>
            <div className="flex flex-col flex-1 h-full">
                <header className="p-4 sm:p-6 border-b flex-shrink-0 bg-background flex justify-between items-center">
                    <div>
                        <h1 className="text-2xl font-bold flex items-center gap-2"><Zap /> Conexões com a Evolution API</h1>
                        <p className="text-muted-foreground">Gerencie suas instâncias da API do WhatsApp para atendimento.</p>
                    </div>
                     <Button>
                        <Plus className="mr-2 h-4 w-4" />
                        Adicionar Instância
                    </Button>
                </header>
                <main className="flex-1 overflow-y-auto bg-muted/40 p-4 sm:p-6">
                   <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {instances.map(instance => {
                             const statusInfo = getStatusInfo(instance.status);
                             return (
                                <Card key={instance.id} className="flex flex-col">
                                    <CardHeader>
                                        <div className="flex justify-between items-start">
                                            <div className="max-w-[80%] break-words">
                                                <CardTitle className="flex items-center gap-2">
                                                    <Server className="h-5 w-5 text-primary"/>
                                                    {instance.name}
                                                </CardTitle>
                                                <CardDescription className="mt-1">
                                                     <Badge variant={"outline"}>
                                                        <div className={`h-2 w-2 rounded-full mr-2 ${statusInfo.color}`}></div>
                                                        {statusInfo.text}
                                                    </Badge>
                                                </CardDescription>
                                            </div>
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
                                    <CardContent className="flex-grow space-y-4">
                                        <div className="space-y-1">
                                            <p className="text-xs font-medium text-muted-foreground">URL da API</p>
                                            <p className="text-sm font-mono bg-secondary/50 p-2 rounded-md truncate">{instance.apiUrl}</p>
                                        </div>
                                        {instance.status === 'pending' && (
                                             <div className="text-center p-4 border-dashed border-2 rounded-lg aspect-square flex flex-col items-center justify-center">
                                                <QrCode className="h-24 w-24 text-muted-foreground/50"/>
                                                <p className="mt-4 text-sm text-muted-foreground">Aguardando leitura do QR Code.</p>
                                            </div>
                                        )}
                                    </CardContent>
                                    <CardFooter className="p-4 border-t">
                                        {instance.status === 'connected' ? (
                                             <Button variant="destructive" className="w-full">
                                                <PowerOff className="mr-2 h-4 w-4"/> Desconectar
                                            </Button>
                                        ) : (
                                            <Button className="w-full">
                                                <Power className="mr-2 h-4 w-4"/> Conectar e Gerar QR Code
                                            </Button>
                                        )}
                                    </CardFooter>
                                </Card>
                             )
                        })}
                   </div>
                </main>
            </div>
        </MainLayout>
    );
}
