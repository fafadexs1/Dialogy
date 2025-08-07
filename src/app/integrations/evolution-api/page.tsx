
'use client';

import React, { useState, useEffect, useActionState, startTransition } from 'react';
import Image from 'next/image';
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
import { 
    getEvolutionApiConfig, 
    saveEvolutionApiConfig, 
    getEvolutionApiInstances, 
    createEvolutionApiInstance, 
    deleteEvolutionApiInstance,
    checkInstanceStatus,
    connectInstance,
    disconnectInstance
} from '@/actions/evolution-api';
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

function AddInstanceForm({ onFormSubmit, configId }: { onFormSubmit: () => void, configId: string | undefined }) {
    const [state, formAction] = useActionState(createEvolutionApiInstance, null);
    const { pending } = useFormStatus();

    useEffect(() => {
        if (state?.error === null) {
            onFormSubmit();
        }
    }, [state, onFormSubmit]);

    return (
        <form action={formAction}>
            <input type="hidden" name="config_id" value={configId || ''} />
            <div className="space-y-4 py-2 pb-4">
                 <div className="space-y-2">
                    <Label htmlFor="instance-name">Nome da Instância</Label>
                    <Input id="instance-name" name="name" placeholder="Ex: Vendas Filial RJ" required/>
                    <p className="text-xs text-muted-foreground">Um nome único para identificar esta conexão. Ex: "Setor de Vendas".</p>
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="instance-type">Tipo de Conexão</Label>
                    <Select name="type" defaultValue='baileys'>
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
                {state?.error && <p className="text-sm text-red-500">{state.error}</p>}
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
    const [instanceStates, setInstanceStates] = useState<Record<string, { loading: boolean }>>({});
    
    const { toast } = useToast();

    const [saveState, saveAction] = useActionState(saveEvolutionApiConfig, null);
    
    useEffect(() => {
        if (saveState?.error === null) {
            toast({ title: "Configuração Salva!", description: "Suas alterações foram salvas com sucesso." });
             if (activeWorkspace) {
                fetchData(activeWorkspace.id);
            }
        } else if (saveState?.error) {
            toast({ title: "Erro ao Salvar", description: saveState.error, variant: "destructive" });
        }
    }, [saveState, toast, activeWorkspace]);

    const fetchData = async (workspaceId: string) => {
        console.log("Fetching data for workspace:", workspaceId);
        setIsLoading(true);
        try {
            const configData = await getEvolutionApiConfig(workspaceId);
            setConfig(configData);

            if (configData) {
                const instancesFromDb = await getEvolutionApiInstances(workspaceId);
                const instancesWithStatus = await Promise.all(
                    instancesFromDb.map(async (inst) => {
                        const { status, qrCode } = await checkInstanceStatus(inst.name, configData);
                        return { ...inst, status, qrCode };
                    })
                );
                setInstances(instancesWithStatus);
            } else {
                setInstances([]);
            }

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
        } else {
            setIsLoading(false);
        }
    }, [activeWorkspace]);

    const handleCreationSuccess = () => {
        setIsAddModalOpen(false);
        toast({ title: "Instância Criada!", description: "A nova instância foi adicionada com sucesso." });
        if (activeWorkspace) {
            fetchData(activeWorkspace.id);
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

    const handleToggleConnection = async (instance: EvolutionInstance) => {
        if (!config) return;

        setInstanceStates(prev => ({ ...prev, [instance.id]: { loading: true } }));

        try {
            let result: { status: EvolutionInstance['status']; qrCode?: string };

            if (instance.status === 'connected') {
                result = await disconnectInstance(instance.name, config);
            } else {
                result = await connectInstance(instance.name, config);
            }

            setInstances(prevInstances =>
                prevInstances.map(i =>
                    i.id === instance.id ? { ...i, status: result.status, qrCode: result.qrCode } : i
                )
            );
             // After action, poll for status
            setTimeout(() => {
                if (activeWorkspace) {
                   fetchData(activeWorkspace.id);
                }
            }, 3000)


        } catch (error) {
            toast({ title: 'Erro de Conexão', description: 'Falha ao se comunicar com a API Evolution.', variant: 'destructive' });
        } finally {
            setInstanceStates(prev => ({ ...prev, [instance.id]: { loading: false } }));
        }
    };
    
    const getStatusInfo = (status: EvolutionInstance['status']) => {
        switch (status) {
            case 'connected':
                return { text: 'Conectado', color: 'bg-green-500', icon: <ShieldCheck className="h-4 w-4" /> };
            case 'disconnected':
                return { text: 'Desconectado', color: 'bg-red-500', icon: <ShieldOff className="h-4 w-4" /> };
            case 'pending':
                return { text: 'Aguardando QR Code', color: 'bg-yellow-500', icon: <QrCode className="h-4 w-4" /> };
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
                   <form action={saveAction}>
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
                                        onFormSubmit={handleCreationSuccess}
                                    />
                                </DialogContent>
                            </Dialog>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                            {instances.map(instance => {
                                const statusInfo = getStatusInfo(instance.status);
                                const isLoadingInstance = instanceStates[instance.id]?.loading;
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
                                                    {isLoadingInstance ? (
                                                        <>
                                                            <Loader2 className="h-4 w-4 animate-spin"/>
                                                            <span className="text-sm font-medium">Verificando...</span>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <div className={`h-2.5 w-2.5 rounded-full ${statusInfo.color}`}></div>
                                                            <span className="text-sm font-medium">{statusInfo.text}</span>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                            {instance.type === 'baileys' && instance.status === 'pending' && (
                                                <div className="text-center p-4 border-dashed border-2 rounded-lg aspect-square flex flex-col items-center justify-center bg-secondary/50">
                                                    {instance.qrCode ? (
                                                        <Image src={`data:image/png;base64,${instance.qrCode}`} alt="QR Code" width={200} height={200} />
                                                    ) : (
                                                        <QrCode className="h-24 w-24 text-muted-foreground/50"/>
                                                    )}
                                                    <p className="mt-4 text-sm text-muted-foreground">Leia o QR Code com seu celular.</p>
                                                    <p className="text-xs text-muted-foreground">Clique em "Conectar" para gerar um novo.</p>
                                                </div>
                                            )}
                                            {instance.type === 'wa_cloud' && (
                                                <div className="p-4 border rounded-lg bg-secondary/50 text-center">
                                                    <p className="text-sm text-muted-foreground">A conexão com a API Cloud é direta. Use os botões abaixo para gerenciar.</p>
                                                </div>
                                            )}
                                        </CardContent>
                                        <CardFooter className="p-4 border-t">
                                            {instance.status === 'connected' ? (
                                                <Button variant="destructive" className="w-full" onClick={() => handleToggleConnection(instance)} disabled={isLoadingInstance}>
                                                    {isLoadingInstance ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PowerOff className="mr-2 h-4 w-4"/>}
                                                     Desconectar
                                                </Button>
                                            ) : (
                                                <Button className="w-full" onClick={() => handleToggleConnection(instance)} disabled={isLoadingInstance}>
                                                    {isLoadingInstance ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Power className="mr-2 h-4 w-4"/>}
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
