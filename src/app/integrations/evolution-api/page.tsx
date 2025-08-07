
'use client';

import React, { useState } from 'react';
import { MainLayout } from '@/components/layout/main-layout';
import type { User, EvolutionInstance } from '@/lib/types';
import { agents } from '@/lib/mock-data';
import { createClient } from '@/lib/supabase/client';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { KeyRound, Server, Zap, QrCode, Power, PowerOff, ShieldCheck, ShieldOff, Plus, MoreVertical, Trash2, Edit, Cloud, Smartphone, Settings } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Separator } from '@/components/ui/separator';

const mockInstances: EvolutionInstance[] = [
    { id: 'inst-1', name: 'Atendimento Matriz', status: 'connected', type: 'baileys'},
    { id: 'inst-2', name: 'Vendas SP', status: 'disconnected', type: 'wa_cloud'},
    { id: 'inst-3', name: 'Suporte Beta', status: 'pending', type: 'baileys'},
]

function InstanceTypeBadge({ type }: { type: EvolutionInstance['type'] }) {
    const typeInfo = {
        baileys: { text: 'Baileys', icon: <Smartphone className="h-3 w-3" />, color: 'bg-blue-500/20 text-blue-700'},
        wa_cloud: { text: 'Cloud API', icon: <Cloud className="h-3 w-3" />, color: 'bg-green-500/20 text-green-700'},
    };
    const { text, icon, color } = typeInfo[type];
    return (
        <Badge className={`border-transparent font-medium text-xs py-1 px-2 ${color}`}>
            {icon} {text}
        </Badge>
    )
}

function AddInstanceForm({ onAddInstance }: { onAddInstance: (instance: Omit<EvolutionInstance, 'id' | 'status'>) => void }) {
    const [name, setName] = useState('');
    const [type, setType] = useState<EvolutionInstance['type']>('baileys');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!name) {
            alert('Por favor, preencha o nome da instância.');
            return;
        }
        onAddInstance({ name, type });
        setName('');
        setType('baileys');
    };

    return (
        <form onSubmit={handleSubmit}>
            <div className="space-y-4 py-2 pb-4">
                 <div className="space-y-2">
                    <Label htmlFor="instance-name">Nome da Instância</Label>
                    <Input id="instance-name" placeholder="Ex: Vendas Filial RJ" value={name} onChange={e => setName(e.target.value)} required/>
                    <p className="text-xs text-muted-foreground">Um nome único para identificar esta conexão. Ex: "Setor de Vendas".</p>
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="instance-type">Tipo de Conexão</Label>
                    <Select value={type} onValueChange={(value) => setType(value as EvolutionInstance['type'])}>
                        <SelectTrigger id="instance-type">
                            <SelectValue placeholder="Selecione o tipo" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="baileys">Baileys (QR Code)</SelectItem>
                            <SelectItem value="wa_cloud">WhatsApp Cloud API</SelectItem>
                        </SelectContent>
                    </Select>
                     <p className="text-xs text-muted-foreground">Para a Cloud API, a instância deve ser criada no painel da Meta.</p>
                </div>
            </div>
             <DialogFooter>
                <DialogTrigger asChild>
                    <Button type="button" variant="outline">Cancelar</Button>
                </DialogTrigger>
                <Button type="submit">Criar Instância</Button>
            </DialogFooter>
        </form>
    );
}


export default function EvolutionApiPage() {
    const [user, setUser] = React.useState<User | null>(null);
    const [instances, setInstances] = useState<EvolutionInstance[]>(mockInstances);
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [globalApiUrl, setGlobalApiUrl] = useState('http://localhost:8080');
    const [globalApiKey, setGlobalApiKey] = useState('');

    const supabase = createClient();
    const { toast } = useToast();

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

    const getStatusInfo = (status: EvolutionInstance['status']) => {
        switch (status) {
            case 'connected':
                return { text: 'Conectado', color: 'bg-green-500', icon: <ShieldCheck className="h-4 w-4" /> };
            case 'disconnected':
                return { text: 'Desconectado', color: 'bg-red-500', icon: <ShieldOff className="h-4 w-4" /> };
            case 'pending':
                return { text: 'Pendente', color: 'bg-yellow-500', icon: <QrCode className="h-4 w-4" /> };
        }
    }
    
    const handleAddInstance = (newInstanceData: Omit<EvolutionInstance, 'id' | 'status'>) => {
        const newInstance: EvolutionInstance = {
            id: `inst-${Date.now()}`,
            ...newInstanceData,
            status: 'disconnected',
        };
        setInstances([...instances, newInstance]);
        setIsAddModalOpen(false);
        toast({
            title: 'Sucesso!',
            description: `A instância "${newInstance.name}" foi criada.`
        })
    };

    const handleRemoveInstance = (instanceId: string) => {
        setInstances(instances.filter(inst => inst.id !== instanceId));
        toast({
            title: 'Instância Removida',
            description: 'A instância foi removida com sucesso.',
            variant: 'destructive'
        })
    }

    const handleToggleConnection = (instanceId: string) => {
        setInstances(instances.map(inst => {
            if (inst.id === instanceId) {
                if (inst.status === 'disconnected') {
                    return { ...inst, status: inst.type === 'baileys' ? 'pending' : 'connected' };
                } else {
                     return { ...inst, status: 'disconnected' };
                }
            }
            return inst;
        }));
    };


    if (!user) {
        return null; // Or a loading spinner
    }

    return (
        <MainLayout user={user}>
            <div className="flex flex-col flex-1 h-full">
                <header className="p-4 sm:p-6 border-b flex-shrink-0 bg-background">
                    <h1 className="text-2xl font-bold flex items-center gap-2"><Zap /> Conexões com a Evolution API</h1>
                    <p className="text-muted-foreground">Gerencie suas instâncias da API do WhatsApp para atendimento.</p>
                </header>
                <main className="flex-1 overflow-y-auto bg-muted/40 p-4 sm:p-6 space-y-8">
                   <Card>
                       <CardHeader>
                           <CardTitle className="flex items-center gap-2"><Settings /> Configuração Global da API</CardTitle>
                           <CardDescription>Insira os dados do seu servidor da Evolution API. Estes dados serão usados para todas as instâncias.</CardDescription>
                       </CardHeader>
                       <CardContent className="grid md:grid-cols-2 gap-6">
                           <div className="space-y-2">
                               <Label htmlFor="global-api-url">URL da API</Label>
                               <Input id="global-api-url" placeholder="Ex: http://localhost:8080" value={globalApiUrl} onChange={e => setGlobalApiUrl(e.target.value)} />
                           </div>
                            <div className="space-y-2">
                               <Label htmlFor="global-api-key">Chave da API (Global API Key)</Label>
                               <Input id="global-api-key" type="password" value={globalApiKey} onChange={e => setGlobalApiKey(e.target.value)} placeholder="••••••••••••••••••••••••••" />
                           </div>
                       </CardContent>
                       <CardFooter>
                           <Button>Salvar Configurações</Button>
                       </CardFooter>
                   </Card>

                    <div>
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-xl font-bold">Minhas Instâncias</h2>
                             <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
                                <DialogTrigger asChild>
                                    <Button>
                                        <Plus className="mr-2 h-4 w-4" />
                                        Adicionar Instância
                                    </Button>
                                </DialogTrigger>
                                <DialogContent>
                                    <DialogHeader>
                                        <DialogTitle>Criar Nova Instância</DialogTitle>
                                        <DialogDescription>
                                            Configure uma nova instância para conectar um número de WhatsApp.
                                        </DialogDescription>
                                    </DialogHeader>
                                    <AddInstanceForm onAddInstance={handleAddInstance} />
                                </DialogContent>
                            </Dialog>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                            {instances.map(instance => {
                                const statusInfo = getStatusInfo(instance.status);
                                return (
                                    <Card key={instance.id} className="flex flex-col">
                                        <CardHeader>
                                            <div className="flex justify-between items-start">
                                                <div className="max-w-[80%] break-words space-y-2">
                                                    <CardTitle className="flex items-center gap-2">
                                                        <Server className="h-5 w-5 text-primary"/>
                                                        {instance.name}
                                                    </CardTitle>
                                                    <InstanceTypeBadge type={instance.type} />
                                                </div>
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="ghost" size="icon" className="h-8 w-8">
                                                            <MoreVertical className="h-4 w-4" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        <DropdownMenuItem disabled>
                                                            <Edit className="mr-2 h-4 w-4" />
                                                            Editar
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem onClick={() => handleRemoveInstance(instance.id)} className="text-destructive">
                                                            <Trash2 className="mr-2 h-4 w-4" />
                                                            Remover
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </div>
                                        </CardHeader>
                                        <CardContent className="flex-grow space-y-4">
                                            <div className="space-y-1">
                                                <div className="flex items-center gap-2">
                                                    <div className={`h-2.5 w-2.5 rounded-full ${statusInfo.color}`}></div>
                                                    <span className="text-sm font-medium">{statusInfo.text}</span>
                                                </div>
                                            </div>
                                            {instance.type === 'baileys' && instance.status === 'pending' && (
                                                <div className="text-center p-4 border-dashed border-2 rounded-lg aspect-square flex flex-col items-center justify-center bg-secondary/50">
                                                    <QrCode className="h-24 w-24 text-muted-foreground/50"/>
                                                    <p className="mt-4 text-sm text-muted-foreground">Aguardando leitura do QR Code.</p>
                                                    <p className="text-xs text-muted-foreground">Clique em Conectar para gerar um novo.</p>
                                                </div>
                                            )}
                                            {instance.type === 'wa_cloud' && (
                                                <div className="p-4 border rounded-lg bg-secondary/50 text-center">
                                                    <p className="text-sm text-muted-foreground">A conexão com a API Cloud é direta. Clique em conectar para ativá-la.</p>
                                                </div>
                                            )}
                                        </CardContent>
                                        <CardFooter className="p-4 border-t">
                                            {instance.status === 'connected' ? (
                                                <Button variant="destructive" className="w-full" onClick={() => handleToggleConnection(instance.id)}>
                                                    <PowerOff className="mr-2 h-4 w-4"/> Desconectar
                                                </Button>
                                            ) : (
                                                <Button className="w-full" onClick={() => handleToggleConnection(instance.id)}>
                                                    <Power className="mr-2 h-4 w-4"/>
                                                    {instance.type === 'baileys' ? 'Conectar e Gerar QR Code' : 'Conectar'}
                                                </Button>
                                            )}
                                        </CardFooter>
                                    </Card>
                                )
                            })}
                        </div>
                    </div>
                </main>
            </div>
        </MainLayout>
    );
}
