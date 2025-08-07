
'use client';

import React, { useState, useEffect, useActionState, startTransition } from 'react';
import { MainLayout } from '@/components/layout/main-layout';
import type { User, EvolutionInstance, EvolutionApiConfig, Workspace } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { KeyRound, Server, Zap, QrCode, Power, PowerOff, ShieldCheck, ShieldOff, Plus, MoreVertical, Trash2, Edit, Cloud, Smartphone, Settings, Loader2 } from 'lucide-react';
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
import { useAuth } from '@/hooks/use-auth';
import { getEvolutionApiConfig, saveEvolutionApiConfig, getEvolutionApiInstances, createEvolutionApiInstance, deleteEvolutionApiInstance } from '@/actions/evolution-api';
import { useFormStatus } from 'react-dom';

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

function AddInstanceForm({ onAdd, configId }: { onAdd: () => void, configId: string | undefined }) {
    const { pending } = useFormStatus();
    const [name, setName] = useState('');
    const [type, setType] = useState<EvolutionInstance['type']>('baileys');

    const action = createEvolutionApiInstance.bind(null, { name, type, config_id: configId! });

    return (
        <form action={action} onSubmit={onAdd}>
            <div className="space-y-4 py-2 pb-4">
                 <div className="space-y-2">
                    <Label htmlFor="instance-name">Nome da Instância</Label>
                    <Input id="instance-name" name="name" placeholder="Ex: Vendas Filial RJ" value={name} onChange={e => setName(e.target.value)} required/>
                    <p className="text-xs text-muted-foreground">Um nome único para identificar esta conexão. Ex: "Setor de Vendas".</p>
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="instance-type">Tipo de Conexão</Label>
                    <Select name="type" value={type} onValueChange={(value) => setType(value as EvolutionInstance['type'])}>
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
                    <Button type="button" variant="outline" disabled={pending}>Cancelar</Button>
                </DialogTrigger>
                <Button type="submit" disabled={pending || !configId}>
                    {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {pending ? 'Criando...' : 'Criar Instância'}
                </Button>
            </DialogFooter>
        </form>
    );
}

function SaveConfigButton() {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {pending ? 'Salvando...' : 'Salvar Configurações'}
        </Button>
    )
}

export default function EvolutionApiPage() {
    const user = useAuth();
    const [instances, setInstances] = useState<EvolutionInstance[]>([]);
    const [config, setConfig] = useState<EvolutionApiConfig | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
    
    const { toast } = useToast();

    // Use useActionState for the config form
    const [saveError, saveAction, isSaving] = useActionState(saveEvolutionApiConfig, null);
    
    // Function to fetch all data
    const fetchData = async (workspaceId: string) => {
        setIsLoading(true);
        try {
            const [configData, instancesData] = await Promise.all([
                getEvolutionApiConfig(workspaceId),
                getEvolutionApiInstances(workspaceId)
            ]);
            setConfig(configData);
            setInstances(instancesData.map(i => ({...i, status: 'disconnected'}) as EvolutionInstance)); // Simulate disconnect on load
        } catch (error) {
            console.error("Failed to fetch evolution api data", error);
            toast({ title: "Erro ao buscar dados", description: "Não foi possível carregar as configurações e instâncias.", variant: "destructive" });
        } finally {
            setIsLoading(false);
        }
    };
    
    useEffect(() => {
        if (user?.activeWorkspaceId) {
            const workspace = user.workspaces?.find(ws => ws.id === user.activeWorkspaceId);
            setActiveWorkspace(workspace || null);
        }
    }, [user]);

    useEffect(() => {
        if (activeWorkspace) {
            fetchData(activeWorkspace.id);
        }
    }, [activeWorkspace]);


    const handleFormActionCompletion = (workspaceId: string, toastTitle: string, toastDescription: string) => {
        return () => {
            setIsAddModalOpen(false); // Close modal on success
            toast({ title: toastTitle, description: toastDescription });
            // Re-fetch data to show the new instance/changes
            fetchData(workspaceId);
        }
    }

    const handleRemoveInstance = async (instanceId: string) => {
        try {
            await deleteEvolutionApiInstance(instanceId);
            toast({ title: 'Instância Removida', description: 'A instância foi removida com sucesso.' });
            if (activeWorkspace) {
                fetchData(activeWorkspace.id);
            }
        } catch (error) {
            toast({ title: 'Erro ao remover', description: 'Não foi possível remover a instância.', variant: 'destructive' });
        }
    }

    const handleToggleConnection = (instanceId: string) => {
        setInstances(instances.map(inst => {
            if (inst.id === instanceId) {
                if (inst.status === 'disconnected') {
                    // Simulating API call
                    return { ...inst, status: inst.type === 'baileys' ? 'pending' : 'connected' };
                } else {
                     return { ...inst, status: 'disconnected' };
                }
            }
            return inst;
        }));
    };
    
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

    if (!user || isLoading) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loader2 className="h-8 w-8 animate-spin text-primary"/>
            </div>
        )
    }

    return (
        <MainLayout user={user}>
            <div className="flex flex-col flex-1 h-full">
                <header className="p-4 sm:p-6 border-b flex-shrink-0 bg-background">
                    <h1 className="text-2xl font-bold flex items-center gap-2"><Zap /> Conexões com a Evolution API</h1>
                    <p className="text-muted-foreground">Gerencie suas instâncias da API do WhatsApp para o workspace: <span className='font-semibold'>{activeWorkspace?.name}</span></p>
                </header>
                <main className="flex-1 overflow-y-auto bg-muted/40 p-4 sm:p-6 space-y-8">
                   <form action={saveAction} onSubmit={() => handleFormActionCompletion(activeWorkspace!.id, "Configuração Salva!", "Suas alterações foram salvas com sucesso.")()}>
                        <input type="hidden" name="workspaceId" value={activeWorkspace?.id || ''} />
                        <input type="hidden" name="configId" value={config?.id || ''} />
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2"><Settings /> Configuração Global da API</CardTitle>
                                <CardDescription>Insira os dados do seu servidor da Evolution API. Estes dados serão usados para todas as instâncias deste workspace.</CardDescription>
                            </CardHeader>
                            <CardContent className="grid md:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <Label htmlFor="global-api-url">URL da API</Label>
                                    <Input name="apiUrl" id="global-api-url" placeholder="Ex: http://localhost:8080" defaultValue={config?.api_url || ''} />
                                </div>
                                    <div className="space-y-2">
                                    <Label htmlFor="global-api-key">Chave da API (Global API Key)</Label>
                                    <Input name="apiKey" id="global-api-key" type="password" defaultValue={config?.api_key || ''} placeholder="••••••••••••••••••••••••••" />
                                </div>
                            </CardContent>
                            <CardFooter>
                                <SaveConfigButton />
                            </CardFooter>
                        </Card>
                   </form>

                    <div>
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-xl font-bold">Minhas Instâncias</h2>
                             <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
                                <DialogTrigger asChild>
                                    <Button disabled={!config}>
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
                                    <AddInstanceForm 
                                        configId={config?.id}
                                        onAdd={() => handleFormActionCompletion(activeWorkspace!.id, "Instância Criada!", "A nova instância foi adicionada com sucesso.")()}
                                    />
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
                             {instances.length === 0 && !isLoading && (
                                <div className="col-span-full text-center p-10 border-dashed border-2 rounded-lg">
                                    <p className="text-muted-foreground">Nenhuma instância criada ainda.</p>
                                    <p className="text-sm text-muted-foreground">Adicione uma para começar a conectar números de WhatsApp.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </main>
            </div>
        </MainLayout>
    );
}
