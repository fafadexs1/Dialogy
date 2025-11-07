

'use client';

import React, { useState, useEffect, useCallback, useActionState, useTransition } from 'react';
import type { User, EvolutionInstance, EvolutionInstanceCreationPayload } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, PlusCircle, Server, MessageSquare, Trash2, MoreVertical, Wifi, WifiOff, QrCode, Power, PowerOff, Settings } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import Image from 'next/image';
import { getEvolutionApiInstances, createEvolutionApiInstance, deleteEvolutionApiInstance, checkInstanceStatus, connectInstance, disconnectInstance } from '@/actions/evolution-api';
import { useFormStatus } from 'react-dom';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { TemplateManager } from './template-manager';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';

function SubmitButton() {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Criar Instância
        </Button>
    )
}

function AddInstanceForm({ workspaceId, onSuccess, onClose }: { workspaceId: string, onSuccess: () => void, onClose: () => void }) {
    const [integrationType, setIntegrationType] = useState('WHATSAPP-BAILEYS');
    const [rejectCall, setRejectCall] = useState(false);
    const [useProxy, setUseProxy] = useState(false);
    const { toast } = useToast();

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        
        const payload: EvolutionInstanceCreationPayload = {
            displayName: formData.get('displayName') as string,
            integration: formData.get('integrationType') as any,
            // Common
            number: formData.get('number') as string || undefined,
            // Baileys
            qrcode: true,
            rejectCall: formData.get('rejectCall') === 'on',
            msgCall: formData.get('msgCall') as string || undefined,
            groupsIgnore: formData.get('groupsIgnore') === 'on',
            alwaysOnline: formData.get('alwaysOnline') === 'on',
            readMessages: formData.get('readMessages') === 'on',
            readStatus: formData.get('readStatus') === 'on',
            syncFullHistory: formData.get('syncFullHistory') === 'on',
            // Proxy
            proxy: useProxy ? {
                host: formData.get('proxyHost') as string,
                port: Number(formData.get('proxyPort')),
                username: formData.get('proxyUsername') as string || undefined,
                password: formData.get('proxyPassword') as string || undefined,
            } : undefined,
             // Chatwoot
            chatwoot: {
                accountId: formData.get('chatwootAccountId') ? Number(formData.get('chatwootAccountId')) : undefined,
                token: formData.get('chatwootToken') as string || undefined,
                url: formData.get('chatwootUrl') as string || undefined,
                signMsg: formData.get('chatwootSignMsg') === 'on',
                reopenConversation: formData.get('chatwootReopenConversation') === 'on',
                conversationPending: formData.get('chatwootConversationPending') === 'on',
            },
        };
        
        if (payload.integration === 'WHATSAPP-BUSINESS') {
            payload.qrcode = false; // Override for Cloud API
            payload.token = formData.get('token') as string;
            payload.businessId = formData.get('businessId') as string;
        } else {
             payload.token = formData.get('baileysToken') as string || undefined;
        }
        
        const result = await createEvolutionApiInstance(payload, workspaceId);

        if (result.success) {
            toast({ title: 'Instância Criada!', description: 'Sua instância está sendo provisionada.' });
            onSuccess();
        } else {
            toast({ title: 'Erro ao Criar Instância', description: result.error, variant: 'destructive' });
        }
    };
    
    return (
        <form onSubmit={handleSubmit}>
            <DialogHeader>
                <DialogTitle>Criar Nova Instância</DialogTitle>
                <DialogDescription>Conecte um novo número de WhatsApp para usar no atendimento.</DialogDescription>
            </DialogHeader>
            <ScrollArea className="max-h-[70vh] py-4 px-1">
                <div className="space-y-4 px-2">
                    <div className="space-y-2">
                        <Label htmlFor="displayName">Apelido da Instância (Obrigatório)</Label>
                        <Input id="displayName" name="displayName" placeholder="Ex: Vendas, Suporte Principal" required/>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="number">Número de Telefone (com DDI)</Label>
                        <Input id="number" name="number" placeholder="Ex: 5511999998888"/>
                    </div>
                     <div className="space-y-2">
                        <Label htmlFor="integrationType">Tipo de Conexão</Label>
                        <Select name="integrationType" value={integrationType} onValueChange={setIntegrationType}>
                            <SelectTrigger><SelectValue/></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="WHATSAPP-BAILEYS">WhatsApp (Baileys - Não Oficial)</SelectItem>
                                <SelectItem value="WHATSAPP-BUSINESS">WhatsApp Business (Cloud API - Oficial)</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <Accordion type="multiple" className="w-full">
                        {integrationType === 'WHATSAPP-BUSINESS' ? (
                            <AccordionItem value="meta">
                                <AccordionTrigger>Configurações da Meta Business API</AccordionTrigger>
                                <AccordionContent className="space-y-4 pt-2">
                                    <div className="space-y-2">
                                        <Label htmlFor="numberId">ID do Número de Telefone (Phone Number ID)</Label>
                                        <Input id="numberId" name="numberId" placeholder="ID do número no seu App da Meta" required />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="businessId">ID da Conta do WhatsApp (WABA ID)</Label>
                                        <Input id="businessId" name="businessId" placeholder="ID do seu WhatsApp Business Account" required />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="token">Token de Acesso Permanente</Label>
                                        <Input id="token" name="token" type="password" placeholder="Seu token permanente da API da Meta" required />
                                    </div>
                                </AccordionContent>
                            </AccordionItem>
                        ) : (
                            <>
                                <AccordionItem value="baileys-token">
                                    <AccordionTrigger>Token da Instância (Baileys)</AccordionTrigger>
                                    <AccordionContent className="space-y-4 pt-2">
                                        <div className="space-y-2">
                                            <Label htmlFor="baileysToken">Token (Opcional)</Label>
                                            <Input id="baileysToken" name="baileysToken" placeholder="Token para segurança da instância" />
                                        </div>
                                    </AccordionContent>
                                </AccordionItem>
                                <AccordionItem value="general-settings">
                                    <AccordionTrigger>Configurações Gerais</AccordionTrigger>
                                    <AccordionContent className="space-y-4 pt-4">
                                        <div className="flex items-center space-x-2">
                                            <Checkbox id="alwaysOnline" name="alwaysOnline" />
                                            <Label htmlFor="alwaysOnline">Ficar sempre online</Label>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <Checkbox id="readMessages" name="readMessages" defaultChecked/>
                                            <Label htmlFor="readMessages">Marcar mensagens como lidas</Label>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <Checkbox id="readStatus" name="readStatus" />
                                            <Label htmlFor="readStatus">Marcar status como vistos</Label>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <Checkbox id="syncFullHistory" name="syncFullHistory" />
                                            <Label htmlFor="syncFullHistory">Sincronizar histórico completo de conversas</Label>
                                        </div>
                                    </AccordionContent>
                                </AccordionItem>
                                <AccordionItem value="behavior-settings">
                                    <AccordionTrigger>Comportamento da Instância</AccordionTrigger>
                                    <AccordionContent className="space-y-4 pt-4">
                                        <div className="flex items-center space-x-2">
                                            <Checkbox id="rejectCall" name="rejectCall" checked={rejectCall} onCheckedChange={(checked) => setRejectCall(Boolean(checked))} />
                                            <Label htmlFor="rejectCall">Rejeitar chamadas de voz e vídeo</Label>
                                        </div>
                                        {rejectCall && (
                                            <div className="space-y-2 pl-6 animate-in fade-in-50">
                                                <Label htmlFor="msgCall">Mensagem ao rejeitar chamada</Label>
                                                <Input id="msgCall" name="msgCall" placeholder="Não podemos atender chamadas neste número." />
                                            </div>
                                        )}
                                        <div className="flex items-center space-x-2">
                                            <Checkbox id="groupsIgnore" name="groupsIgnore" />
                                            <Label htmlFor="groupsIgnore">Ignorar mensagens de grupos</Label>
                                        </div>
                                    </AccordionContent>
                                </AccordionItem>
                            </>
                        )}
                        <AccordionItem value="proxy">
                            <AccordionTrigger>Configurações de Proxy</AccordionTrigger>
                            <AccordionContent className="space-y-4 pt-4">
                                <div className="flex items-center space-x-2 mb-4">
                                    <Checkbox id="useProxy" checked={useProxy} onCheckedChange={(checked) => setUseProxy(Boolean(checked))} />
                                    <Label htmlFor="useProxy">Usar um servidor proxy</Label>
                                </div>
                                {useProxy && (
                                     <div className="grid grid-cols-2 gap-4 animate-in fade-in-50">
                                         <div className="space-y-2">
                                            <Label htmlFor="proxyHost">Host</Label>
                                            <Input id="proxyHost" name="proxyHost" placeholder="127.0.0.1" />
                                        </div>
                                         <div className="space-y-2">
                                            <Label htmlFor="proxyPort">Porta</Label>
                                            <Input id="proxyPort" name="proxyPort" type="number" placeholder="8080" />
                                        </div>
                                         <div className="space-y-2">
                                            <Label htmlFor="proxyUsername">Usuário (Opcional)</Label>
                                            <Input id="proxyUsername" name="proxyUsername" />
                                        </div>
                                         <div className="space-y-2">
                                            <Label htmlFor="proxyPassword">Senha (Opcional)</Label>
                                            <Input id="proxyPassword" name="proxyPassword" type="password" />
                                        </div>
                                     </div>
                                )}
                            </AccordionContent>
                        </AccordionItem>
                        
                         <AccordionItem value="chatwoot">
                            <AccordionTrigger>Integração com Chatwoot (Opcional)</AccordionTrigger>
                            <AccordionContent className="space-y-4 pt-4">
                                 <div className="grid grid-cols-2 gap-4">
                                      <div className="space-y-2">
                                        <Label htmlFor="chatwootUrl">URL do Chatwoot</Label>
                                        <Input id="chatwootUrl" name="chatwootUrl" placeholder="https://app.chatwoot.com" />
                                    </div>
                                     <div className="space-y-2">
                                        <Label htmlFor="chatwootToken">Token da Conta</Label>
                                        <Input id="chatwootToken" name="chatwootToken" type="password" />
                                    </div>
                                     <div className="space-y-2">
                                        <Label htmlFor="chatwootAccountId">ID da Conta</Label>
                                        <Input id="chatwootAccountId" name="chatwootAccountId" type="number" />
                                    </div>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <Checkbox id="chatwootSignMsg" name="chatwootSignMsg" />
                                    <Label htmlFor="chatwootSignMsg">Assinar mensagens do agente</Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <Checkbox id="chatwootReopenConversation" name="chatwootReopenConversation" />
                                    <Label htmlFor="chatwootReopenConversation">Reabrir conversa no Chatwoot</Label>
                                </div>
                                 <div className="flex items-center space-x-2">
                                    <Checkbox id="chatwootConversationPending" name="chatwootConversationPending" />
                                    <Label htmlFor="chatwootConversationPending">Marcar conversas como pendentes</Label>
                                </div>
                            </AccordionContent>
                        </AccordionItem>

                        {/* TODO: Add Webhook, RabbitMQ, SQS sections here */}
                    </Accordion>
                </div>
            </ScrollArea>
             <DialogFooter className="pt-4">
                <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
                <SubmitButton />
            </DialogFooter>
        </form>
    )
}

function InstanceCard({ instance: initialInstance, onMutate, user }: { instance: Omit<EvolutionInstance, 'status' | 'qrCode'>, onMutate: () => void, user: User }) {
    const { toast } = useToast();
    const [instance, setInstance] = useState<EvolutionInstance>({...initialInstance, status: 'disconnected' });
    const [isChecking, setIsChecking] = useState(false);
    const [isToggling, setIsToggling] = useState(false);

    const checkStatus = useCallback(async () => {
        setIsChecking(true);
        const result = await checkInstanceStatus(instance.instance_name);
        setInstance(prev => ({ ...prev, ...result }));
        setIsChecking(false);
    }, [instance.instance_name]);

    useEffect(() => {
        checkStatus();
    }, [checkStatus]);

    const handleConnect = async () => {
        setIsToggling(true);
        await connectInstance(instance.instance_name);
        checkStatus(); // Re-check status after attempting to connect
        setIsToggling(false);
    }
    
    const handleDisconnect = async () => {
        setIsToggling(true);
        await disconnectInstance(instance.instance_name);
        checkStatus();
        setIsToggling(false);
    }

    const handleDelete = async () => {
        const result = await deleteEvolutionApiInstance(instance.id);
        if (result.error) {
            toast({ title: 'Erro ao deletar', description: result.error, variant: 'destructive'});
        } else {
            toast({ title: 'Instância Deletada!', description: `A instância ${instance.display_name} foi removida.`});
            onMutate();
        }
    }
    
    return (
        <Card>
            <CardHeader>
                <div className="flex justify-between items-start">
                    <div>
                        <CardTitle className="flex items-center gap-2">
                            {instance.status === 'connected' ? <Wifi className="text-green-500"/> : instance.status === 'pending' ? <Loader2 className="animate-spin text-yellow-500" /> : <WifiOff className="text-red-500"/>}
                            {instance.display_name}
                        </CardTitle>
                        <CardDescription>{instance.type === 'wa_cloud' ? 'Cloud API' : 'Baileys'} • {instance.instance_name}</CardDescription>
                    </div>
                    <AlertDialog>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon"><MoreVertical/></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                                <AlertDialogTrigger asChild>
                                    <DropdownMenuItem className="w-full justify-start text-destructive hover:text-destructive" onSelect={(e) => e.preventDefault()}>
                                        <Trash2 className="mr-2"/>Excluir
                                    </DropdownMenuItem>
                                </AlertDialogTrigger>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Tem certeza?</AlertDialogTitle>
                                <AlertDialogDescription>Esta ação é irreversível e removerá permanentemente a instância <span className="font-bold">{instance.display_name}</span>.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                <AlertDialogAction onClick={handleDelete}>Excluir</AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </div>
            </CardHeader>
            <CardContent>
                {instance.status === 'pending' && instance.qrCode ? (
                    <div className="flex flex-col items-center gap-2">
                        <p className='text-sm text-center'>Escaneie o QR Code com seu WhatsApp para conectar.</p>
                        <Image src={`data:image/png;base64,${instance.qrCode}`} alt="QR Code" width={200} height={200} />
                    </div>
                ) : (
                    <div className='text-sm text-muted-foreground text-center p-4'>
                       {instance.status === 'connected' ? 'Conectado e pronto para uso.' : 'A instância está desconectada.'}
                    </div>
                )}
            </CardContent>
            <CardFooter className="gap-2">
                {instance.status === 'connected' ? (
                     <Button variant="destructive" onClick={handleDisconnect} disabled={isToggling} className="w-full">
                        {isToggling ? <Loader2 className="animate-spin mr-2"/> : <PowerOff className="mr-2"/>} Desconectar
                    </Button>
                ) : (
                    <Button variant="default" onClick={handleConnect} disabled={isToggling} className="w-full">
                        {isToggling ? <Loader2 className="animate-spin mr-2"/> : <Power className="mr-2"/>} Conectar
                    </Button>
                )}
                <Button variant="outline" onClick={checkStatus} disabled={isChecking}>
                    {isChecking ? <Loader2 className="animate-spin"/> : <QrCode/>}
                </Button>
            </CardFooter>
        </Card>
    )
}

export default function EvolutionApiPage() {
    const [user, setUser] = useState<User | null>(null);
    const [instances, setInstances] = useState<Omit<EvolutionInstance, 'status' | 'qrCode'>[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);

    const fetchData = useCallback(async () => {
        if (!user?.activeWorkspaceId) return;
        setLoading(true);
        const data = await getEvolutionApiInstances(user.activeWorkspaceId);
        setInstances(data);
        setLoading(false);
    }, [user?.activeWorkspaceId]);

    useEffect(() => {
        const fetchUser = async () => {
            const res = await fetch('/api/user');
            if (res.ok) {
                setUser(await res.json());
            }
        };
        fetchUser();
    }, []);

    useEffect(() => {
        if (user) {
            fetchData();
        }
    }, [user, fetchData]);
    
    const handleSuccess = () => {
        setIsModalOpen(false);
        fetchData();
    }

    if (!user) {
        return <div className="flex h-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }
    
    const cloudApiInstances = instances.filter(i => i.type === 'wa_cloud');

    return (
        <div className="flex flex-col flex-1 h-full">
            <header className="p-4 sm:p-6 border-b flex-shrink-0 bg-background flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2"><Server /> Conexão com a Evolution API</h1>
                    <p className="text-muted-foreground">Gerencie suas instâncias do WhatsApp para atendimento.</p>
                </div>
                <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
                    <DialogTrigger asChild>
                        <Button>
                            <PlusCircle className="mr-2 h-4 w-4" />
                            Criar Instância
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-3xl">
                        <AddInstanceForm workspaceId={user.activeWorkspaceId!} onSuccess={handleSuccess} onClose={() => setIsModalOpen(false)} />
                    </DialogContent>
                </Dialog>
            </header>
            <main className="flex-1 overflow-y-auto bg-muted/40 p-4 sm:p-6 space-y-6">
                {loading ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        <Skeleton className="h-72" />
                        <Skeleton className="h-72" />
                    </div>
                ) : instances.length === 0 ? (
                    <div className="text-center p-10 border-dashed border-2 rounded-lg mt-8">
                        <MessageSquare className="mx-auto h-12 w-12 text-muted-foreground" />
                        <h3 className="mt-4 text-lg font-medium">Nenhuma instância criada</h3>
                        <p className="mt-2 text-sm text-muted-foreground">
                            Clique em "Criar Instância" para conectar seu primeiro número de WhatsApp.
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {instances.map(instance => <InstanceCard key={instance.id} instance={instance} onMutate={fetchData} user={user} />)}
                    </div>
                )}
                
                {cloudApiInstances.length > 0 && user.activeWorkspaceId && (
                     <TemplateManager instances={cloudApiInstances} />
                )}

            </main>
        </div>
    );
}
