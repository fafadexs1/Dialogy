
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
import { KeyRound, Server, Zap, QrCode, Power, PowerOff, ShieldCheck, ShieldOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

type ConnectionStatus = 'connected' | 'disconnected' | 'pending';

export default function EvolutionApiPage() {
    const [user, setUser] = React.useState<User | null>(null);
    const [apiUrl, setApiUrl] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [instanceName, setInstanceName] = useState('dialogy-instance');
    const [status, setStatus] = useState<ConnectionStatus>('disconnected');

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
                return { text: 'Pendente', color: 'bg-yellow-500', icon: <Zap className="h-4 w-4" /> };
        }
    }

    const statusInfo = getStatusInfo(status);

    if (!user) {
        return null; // Or a loading spinner
    }

    return (
        <MainLayout user={user}>
            <div className="flex flex-col flex-1 h-full">
                <header className="p-4 sm:p-6 border-b flex-shrink-0 bg-background flex justify-between items-center">
                    <div>
                        <h1 className="text-2xl font-bold flex items-center gap-2"><Zap /> Conexão com a Evolution API</h1>
                        <p className="text-muted-foreground">Gerencie sua instância da API do WhatsApp para atendimento.</p>
                    </div>
                </header>
                <main className="flex-1 overflow-y-auto bg-muted/40 p-4 sm:p-6">
                   <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">
                        <div className="md:col-span-2 space-y-6">
                             <Card>
                                <CardHeader>
                                    <CardTitle>Configurações da Instância</CardTitle>
                                    <CardDescription>Insira os dados da sua instância da Evolution API para conectar.</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                     <div className="space-y-2">
                                        <Label htmlFor="api-url"><Server className="inline-block mr-2 h-4 w-4"/> URL da API</Label>
                                        <Input id="api-url" placeholder="https://sua-api.com" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="api-key"><KeyRound className="inline-block mr-2 h-4 w-4"/> API Key</Label>
                                        <Input id="api-key" type="password" placeholder="••••••••••••••••••••••••••" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
                                    </div>
                                </CardContent>
                                <CardFooter>
                                    <Button>Salvar e Testar Conexão</Button>
                                </CardFooter>
                            </Card>
                             <Card>
                                <CardHeader>
                                    <CardTitle>Controle da Instância</CardTitle>
                                    <CardDescription>Gerencie o estado da sua instância de conexão com o WhatsApp.</CardDescription>
                                </CardHeader>
                                <CardContent className="flex items-center justify-around gap-4">
                                    <Button variant="outline" size="lg" className="flex-1">
                                        <Power className="mr-2 h-4 w-4"/> Iniciar Instância
                                    </Button>
                                    <Button variant="destructive" size="lg" className="flex-1">
                                        <PowerOff className="mr-2 h-4 w-4"/> Desconectar Instância
                                    </Button>
                                </CardContent>
                            </Card>
                        </div>
                        <div className="space-y-6">
                            <Card>
                                <CardHeader>
                                    <CardTitle>Status da Conexão</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="flex items-center justify-between p-4 border rounded-lg">
                                        <span className="font-semibold">Status</span>
                                        <Badge>
                                            <div className={`h-2 w-2 rounded-full mr-2 ${statusInfo.color}`}></div>
                                            {statusInfo.text}
                                        </Badge>
                                    </div>
                                    <div className="text-center p-4 border-dashed border-2 rounded-lg aspect-square flex flex-col items-center justify-center">
                                        <QrCode className="h-24 w-24 text-muted-foreground/50"/>
                                        <p className="mt-4 text-sm text-muted-foreground">Aguardando leitura do QR Code para conectar.</p>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                   </div>
                </main>
            </div>
        </MainLayout>
    );
}
