
'use client';

import React, { useState, useEffect, useActionState, useCallback, useMemo } from 'react';
import Image from 'next/image';
import { MainLayout } from '@/components/layout/main-layout';
import type { User, EvolutionInstance, EvolutionApiConfig, Workspace } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { KeyRound, Server, Zap, QrCode, Power, PowerOff, ShieldCheck, ShieldOff, Plus, MoreVertical, Trash2, Edit, Cloud, Smartphone, Settings, Loader2, CheckCircle, XCircle, AlertCircle, Rabbit, Webhook, ListTree, Unplug } from 'lucide-react';
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
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
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
import { useRouter } from 'next/navigation';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

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
            <div className="space-y-4 py-2 pb-4 max-h-[70vh] overflow-y-auto px-1">
                <Accordion type="multiple" defaultValue={['general']} className="w-full">
                    {/* General Settings */}
                    <AccordionItem value="general">
                        <AccordionTrigger>Configurações Gerais</AccordionTrigger>
                        <AccordionContent className="space-y-4 p-1">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="instanceName">Nome da Instância</Label>
                                    <Input id="instanceName" name="instanceName" placeholder="Ex: Vendas Filial RJ" required />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="type">Tipo de Conexão</Label>
                                    <Select name="integration" defaultValue='WHATSAPP-BAILEYS'>
                                        <SelectTrigger id="type">
                                            <SelectValue placeholder="Selecione o tipo" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="WHATSAPP-BAILEYS">Baileys (QR Code)</SelectItem>
                                            <SelectItem value="WHATSAPP-BUSINESS">WhatsApp Business (Cloud API)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="token">Token Secreto</Label>
                                    <Input id="token" name="token" placeholder="Deixe em branco para gerar um" />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="number">Número do WhatsApp (Opcional)</Label>
                                    <Input id="number" name="number" placeholder="5511999998888" />
                                </div>
                            </div>
                             <div className="space-y-2">
                                <Label htmlFor="msgCall">Mensagem ao Rejeitar Chamada</Label>
                                <Input id="msgCall" name="msgCall" placeholder="No momento não podemos atender ligações." />
                            </div>
                            <div className="flex flex-wrap gap-x-6 gap-y-4 pt-2">
                                 <div className="flex items-center space-x-2">
                                    <p className="text-sm font-medium text-muted-foreground">Gerar QR Code no Console está sempre ativo por padrão.</p>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <Switch id="rejectCall" name="rejectCall" />
                                    <Label htmlFor="rejectCall">Rejeitar Chamadas</Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <Switch id="groupsIgnore" name="groupsIgnore" />
                                    <Label htmlFor="groupsIgnore">Ignorar Grupos</Label>
                                </div>
                                 <div className="flex items-center space-x-2">
                                    <Switch id="alwaysOnline" name="alwaysOnline" />
                                    <Label htmlFor="alwaysOnline">Sempre Online</Label>
                                </div>
                                 <div className="flex items-center space-x-2">
                                    <Switch id="readMessages" name="readMessages" />
                                    <Label htmlFor="readMessages">Marcar Mensagens como Lidas</Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <Switch id="readStatus" name="readStatus" />
                                    <Label htmlFor="readStatus">Marcar Status como Visto</Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <Switch id="syncFullHistory" name="syncFullHistory" />
                                    <Label htmlFor="syncFullHistory">Sincronizar Histórico Completo</Label>
                                </div>
                            </div>
                        </AccordionContent>
                    </AccordionItem>
                    
                    {/* Webhook Settings */}
                    <AccordionItem value="webhook">
                        <AccordionTrigger className="flex items-center gap-2"><Webhook className="h-4 w-4"/> Configurações de Webhook</AccordionTrigger>
                        <AccordionContent className="space-y-4 p-1">
                            <div className="space-y-2">
                                <Label htmlFor="webhook.url">URL do Webhook</Label>
                                <Input id="webhook.url" name="webhook.url" placeholder="https://seu-servidor.com/webhook" />
                            </div>
                             <div className="space-y-2">
                                <Label htmlFor="webhook.events">Eventos do Webhook (um por linha)</Label>
                                <Textarea id="webhook.events" name="webhook.events" placeholder="APPLICATION_STARTUP&#x0a;QRCODE_UPDATED&#x0a;MESSAGES_SET" rows={4} />
                            </div>
                            <div className="flex items-center space-x-2">
                                <Switch id="webhook.byEvents" name="webhook.byEvents" />
                                <Label htmlFor="webhook.byEvents">Enviar eventos individuais (em vez de um array)</Label>
                            </div>
                            <div className="flex items-center space-x-2">
                                <Switch id="webhook.base64" name="webhook.base64" />
                                <Label htmlFor="webhook.base64">Enviar mídia em Base64 no webhook</Label>
                            </div>
                        </AccordionContent>
                    </AccordionItem>

                     {/* Queues Settings */}
                    <AccordionItem value="queues">
                        <AccordionTrigger className="flex items-center gap-2"><ListTree className="h-4 w-4"/> Filas (RabbitMQ / SQS)</AccordionTrigger>
                        <AccordionContent className="space-y-6 p-1">
                           <div className="p-4 border rounded-lg">
                               <div className="flex items-center justify-between mb-2">
                                   <Label className="font-semibold flex items-center gap-2"><Rabbit className="h-4 w-4" /> RabbitMQ</Label>
                                   <Switch id="rabbitmq.enabled" name="rabbitmq.enabled" />
                               </div>
                               <Label htmlFor="rabbitmq.events" className="text-xs text-muted-foreground">Eventos (um por linha)</Label>
                               <Textarea id="rabbitmq.events" name="rabbitmq.events" placeholder="MESSAGES_UPSERT&#x0a;CHATS_UPDATE" rows={3} />
                           </div>
                           <div className="p-4 border rounded-lg">
                               <div className="flex items-center justify-between mb-2">
                                   <Label className="font-semibold">Amazon SQS</Label>
                                   <Switch id="sqs.enabled" name="sqs.enabled" />
                               </div>
                               <Label htmlFor="sqs.events" className="text-xs text-muted-foreground">Eventos (um por linha)</Label>
                               <Textarea id="sqs.events" name="sqs.events" placeholder="CONNECTION_UPDATE" rows={3} />
                           </div>
                        </AccordionContent>
                    </AccordionItem>

                     {/* Proxy Settings */}
                    <AccordionItem value="proxy">
                        <AccordionTrigger className="flex items-center gap-2"><Unplug className="h-4 w-4"/> Configurações de Proxy</AccordionTrigger>
                        <AccordionContent className="space-y-4 p-1">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="proxyHost">Host</Label>
                                    <Input id="proxyHost" name="proxyHost" />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="proxyPort">Porta</Label>
                                    <Input id="proxyPort" name="proxyPort" type="number" />
                                </div>
                            </div>
                             <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="proxyUsername">Usuário</Label>
                                    <Input id="proxyUsername" name="proxyUsername" />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="proxyPassword">Senha</Label>
                                    <Input id="proxyPassword" name="proxyPassword" type="password" />
                                </div>
                            </div>
                        </AccordionContent>
                    </AccordionItem>
                </Accordion>
                {state?.error && (
                  <Alert variant="destructive" className="mt-4">
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>Erro ao Criar</AlertTitle>
                      <AlertDescription>{state.error}</AlertDescription>
                  </Alert>
                )}
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

    const fetchData = useCallback(async (workspaceId: string) => {
        setIsLoading(true);
        try {
            const configData = await getEvolutionApiConfig(workspaceId);
            setConfig(configData);

            if (configData && configData.api_url && configData.api_key) {
                const instancesFromDb = await getEvolutionApiInstances(workspaceId);
                const instancesWithStatus = await Promise.all(
                    instancesFromDb.map(async (inst) => {
                        // Reset loading state for this instance
                        setInstanceStates(prev => ({ ...prev, [inst.id]: { loading: false } }));
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
            setInstances([]);
        } finally {
            setIsLoading(false);
        }
    }, [toast]);
    
    useEffect(() => {
        if (user?.activeWorkspaceId) {
            const workspace = user.workspaces?.find(ws => ws.id === user.activeWorkspaceId);
            setActiveWorkspace(workspace || null);
            if(workspace) {
              fetchData(workspace.id);
            }
        } else if (user) {
            setIsLoading(false);
        }
    }, [user, fetchData]);

    useEffect(() => {
        if (saveState?.error === null) {
            toast({ title: "Configuração Salva!", description: "Suas alterações foram salvas com sucesso." });
            if (activeWorkspace) {
                fetchData(activeWorkspace.id);
            }
        } else if (saveState?.error) {
            toast({ title: "Erro ao Salvar", description: saveState.error, variant: "destructive" });
        }
    }, [saveState, toast, activeWorkspace, fetchData]);


    const handleCreationSuccess = () => {
        setIsAddModalOpen(false);
        toast({ title: "Instância Criada!", description: "A nova instância foi adicionada com sucesso." });
        if (activeWorkspace) {
            fetchData(activeWorkspace.id);
        }
    }

    const handleRemoveInstance = async (instanceId: string) => {
        try {
            const result = await deleteEvolutionApiInstance(instanceId);
             if (result.error) {
                 toast({ title: 'Erro ao remover', description: result.error, variant: 'destructive' });
             } else {
                toast({ title: 'Instância Removida', description: 'A instância foi removida com sucesso.' });
                if (activeWorkspace) {
                    fetchData(activeWorkspace.id);
                }
             }
        } catch (error: any) {
            toast({ title: 'Erro ao remover', description: error.message || 'Não foi possível remover a instância.', variant: 'destructive' });
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
             
            setTimeout(() => {
                if (activeWorkspace) {
                   fetchData(activeWorkspace.id);
                }
            }, 5000)

        } catch (error) {
            toast({ title: 'Erro de Conexão', description: 'Falha ao se comunicar com a API Evolution.', variant: 'destructive' });
        } finally {
            setInstanceStates(prev => ({ ...prev, [instance.id]: { loading: false } }));
        }
    };
    
    const getStatusInfo = (status: EvolutionInstance['status']) => {
        switch (status) {
            case 'connected':
                return { text: 'Conectado', color: 'bg-green-500' };
            case 'disconnected':
                return { text: 'Desconectado', color: 'bg-red-500' };
            case 'pending':
                return { text: 'Aguardando QR Code', color: 'bg-yellow-500' };
            default:
                return { text: 'Desconhecido', color: 'bg-gray-500' };
        }
    };

    if (!user) {
        return (
            <MainLayout>
                <div className="flex items-center justify-center h-full">
                    <Loader2 className="h-8 w-8 animate-spin text-primary"/>
                </div>
            </MainLayout>
        )
    }

    return (
        <MainLayout user={user}>
            <div className="flex flex-col flex-1 h-full">
                <header className="p-4 sm:p-6 border-b flex-shrink-0 bg-background">
                    <h1 className="text-2xl font-bold flex items-center gap-2"><Zap /> Conexões com a Evolution API</h1>
                    <p className="text-muted-foreground">Gerencie suas instâncias da API do WhatsApp para o workspace: <span className='font-semibold'>{activeWorkspace?.name || '...'}</span></p>
                </header>
                <main className="flex-1 overflow-y-auto bg-muted/40 p-4 sm:p-6 space-y-8">
                   { isLoading ? (
                        <Card>
                            <CardHeader><Skeleton className="h-8 w-1/2" /></CardHeader>
                            <CardContent><Skeleton className="h-10 w-full" /></CardContent>
                            <CardFooter><Skeleton className="h-10 w-32" /></CardFooter>
                        </Card>
                   ) : (
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
                   )}

                    <div>
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-xl font-bold">Minhas Instâncias</h2>
                             <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
                                <DialogTrigger asChild>
                                    <Button disabled={!config?.api_url || !config?.api_key || isLoading}>
                                        <Plus className="mr-2 h-4 w-4" />
                                        Adicionar Instância
                                    </Button>
                                </DialogTrigger>
                                <DialogContent className="max-w-2xl">
                                    <DialogHeader>
                                        <DialogTitle>Criar Nova Instância</DialogTitle>
                                        <DialogDescription>
                                            Configure uma nova instância para conectar um número de WhatsApp com todas as opções.
                                        </DialogDescription>
                                    </DialogHeader>
                                    <AddInstanceForm 
                                        configId={config?.id}
                                        onFormSubmit={handleCreationSuccess}
                                    />
                                </DialogContent>
                            </Dialog>
                        </div>
                        
                         {!config?.api_url || !config?.api_key ? (
                             <div className="col-span-full text-center p-10 border-dashed border-2 rounded-lg">
                                <AlertCircle className="mx-auto h-12 w-12 text-muted-foreground" />
                                <h3 className="mt-4 text-lg font-medium">Configure sua API Global</h3>
                                <p className="mt-2 text-sm text-muted-foreground">
                                    Para gerenciar instâncias, por favor, insira e salve a URL e a Chave da sua API Evolution nas configurações acima.
                                </p>
                            </div>
                         ) : (
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
                                                                <span className="text-sm font-medium">Aguarde...</span>
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
                                                            <div className="flex flex-col items-center justify-center text-muted-foreground">
                                                                <Loader2 className="h-12 w-12 animate-spin"/>
                                                                <p className="mt-2 text-sm">Gerando QR Code...</p>
                                                            </div>
                                                        )}
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
                                                        Conectar
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
                        )}
                    </div>
                </main>
            </div>
        </MainLayout>
    );
}
