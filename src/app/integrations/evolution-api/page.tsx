

'use client';

import React, { useState, useEffect, useCallback, useActionState, useTransition } from 'react';
import type { User, EvolutionInstance, EvolutionInstanceCreationPayload, EvolutionInstanceSettings } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, PlusCircle, Server, MessageSquare, Trash2, MoreVertical, Wifi, WifiOff, QrCode, Power, PowerOff, Settings, RefreshCw, Save, ArrowLeft, ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import Image from 'next/image';
import { getEvolutionApiInstances, createEvolutionApiInstance, deleteEvolutionApiInstance, checkInstanceStatus, connectInstance, disconnectInstance, restartInstance, getInstanceSettings, updateInstanceSettings } from '@/actions/evolution-api';
import { useFormStatus } from 'react-dom';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { TemplateManager } from './template-manager';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';


function AddInstanceForm({ workspaceId, onSuccess, onClose }: { workspaceId: string, onSuccess: (qrCode?: string) => void, onClose: () => void }) {
    const [step, setStep] = useState(1);
    const [integrationType, setIntegrationType] = useState('WHATSAPP-BAILEYS');
    const [rejectCall, setRejectCall] = useState(false);
    const [useProxy, setUseProxy] = useState(false);
    const { toast } = useToast();
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Form data state
    const [formData, setFormData] = useState<Partial<EvolutionInstanceCreationPayload>>({
        displayName: '',
        integration: 'WHATSAPP-BAILEYS',
        rejectCall: false,
        groupsIgnore: false,
        alwaysOnline: false,
        readMessages: true,
        readStatus: false,
        syncFullHistory: false,
        webhook: { events: [] }
    });

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value, type } = e.target;
        const checked = (e.target as HTMLInputElement).checked;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    };
    
    const handleSelectChange = (name: string, value: string | boolean) => {
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setIsSubmitting(true);
        
        const payload: EvolutionInstanceCreationPayload = {
            ...formData,
            displayName: formData.displayName!,
            integration: formData.integration as any,
            qrcode: formData.integration === 'WHATSAPP-BAILEYS',
        };
        
        const result = await createEvolutionApiInstance(payload, workspaceId);
        setIsSubmitting(false);

        if (result.success) {
            toast({ title: 'Instância Criada!', description: 'Sua instância está sendo provisionada.' });
            onSuccess(result.qrCode);
        } else {
            toast({ title: 'Erro ao Criar Instância', description: result.error, variant: 'destructive' });
        }
    };
    
    const isBaileys = formData.integration === 'WHATSAPP-BAILEYS';
    const totalSteps = isBaileys ? 3 : 2;

    const STEPS = [
        { id: 1, title: "Essencial" },
        { id: 2, title: "Conexão" },
        ...(isBaileys ? [{ id: 3, title: "Avançado" }] : [])
    ];

    const nextStep = () => setStep(s => Math.min(s + 1, totalSteps));
    const prevStep = () => setStep(s => Math.max(s - 1, 1));
    
    return (
        <form onSubmit={handleSubmit}>
            <DialogHeader>
                <DialogTitle>Criar Nova Instância</DialogTitle>
                 <div className="flex items-center justify-center pt-2">
                    {STEPS.map((s, index) => (
                        <React.Fragment key={s.id}>
                            <div className="flex flex-col items-center">
                                <div
                                    className={cn(
                                        'h-8 w-8 rounded-full flex items-center justify-center font-bold text-sm transition-colors',
                                        step >= s.id ? 'bg-primary text-primary-foreground' : 'bg-gray-200 text-gray-500'
                                    )}
                                >
                                    {s.id}
                                </div>
                                <p className={cn("text-xs mt-1", step >= s.id ? 'font-semibold' : 'text-muted-foreground')}>{s.title}</p>
                            </div>
                            {index < STEPS.length - 1 && <div className={cn("h-px w-full mx-2 transition-colors", step > s.id ? 'bg-primary' : 'bg-gray-200')} />}
                        </React.Fragment>
                    ))}
                </div>
            </DialogHeader>
            
            <ScrollArea className="h-[60vh]">
            <div className="py-4 px-1 space-y-6">
                {step === 1 && (
                     <Card>
                        <CardHeader>
                            <CardTitle className="text-base">Configurações Essenciais</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                             <div className="space-y-2">
                                <Label htmlFor="displayName">Apelido da Instância (Obrigatório)</Label>
                                <Input id="displayName" name="displayName" placeholder="Ex: Vendas, Suporte Principal" required value={formData.displayName} onChange={handleInputChange} />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="integrationType">Tipo de Conexão</Label>
                                <Select name="integration" value={formData.integration} onValueChange={(value) => { setFormData(prev => ({...prev, integration: value})); }}>
                                    <SelectTrigger><SelectValue/></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="WHATSAPP-BAILEYS">WhatsApp (Baileys - Não Oficial)</SelectItem>
                                        <SelectItem value="WHATSAPP-BUSINESS">WhatsApp Business (Cloud API - Oficial)</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </CardContent>
                    </Card>
                )}

                {step === 2 && isBaileys && (
                    <Card>
                        <CardHeader><CardTitle className="text-base">Detalhes da Conexão (Baileys)</CardTitle></CardHeader>
                        <CardContent className='space-y-4'>
                            <div className="space-y-2">
                                <Label htmlFor="number">Número de Telefone (Opcional, com DDI)</Label>
                                <Input id="number" name="number" placeholder="Ex: 5511999998888" value={formData.number || ''} onChange={handleInputChange} />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="baileysToken">Token da Instância (Opcional)</Label>
                                <Input id="baileysToken" name="token" placeholder="Token para segurança da instância" value={formData.token || ''} onChange={handleInputChange}/>
                            </div>
                        </CardContent>
                    </Card>
                )}
                 {step === 2 && !isBaileys && (
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Configurações da Meta Business API</CardTitle>
                            </CardHeader>
                             <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="numberId">ID do Número de Telefone (Phone Number ID)</Label>
                                    <Input id="numberId" name="number" placeholder="ID do número no seu App da Meta" required value={formData.number || ''} onChange={handleInputChange} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="businessId">ID da Conta do WhatsApp (WABA ID)</Label>
                                    <Input id="businessId" name="businessId" placeholder="ID do seu WhatsApp Business Account" required value={formData.businessId || ''} onChange={handleInputChange} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="token">Token de Acesso Permanente</Label>
                                    <Input id="token" name="token" type="password" placeholder="Seu token permanente da API da Meta" required value={formData.token || ''} onChange={handleInputChange}/>
                                </div>
                            </CardContent>
                        </Card>
                 )}

                 {step === 3 && isBaileys && (
                     <div className="space-y-4">
                         <Accordion type="multiple" className="w-full space-y-4" defaultValue={['general-settings']}>
                                <Card>
                                    <CardHeader className="p-4">
                                        <AccordionItem value="general-settings" className="border-b-0">
                                            <AccordionTrigger className="p-0 text-base">Configurações Gerais</AccordionTrigger>
                                            <AccordionContent className="space-y-4 pt-4">
                                                <div className="flex items-center space-x-2">
                                                    <Checkbox id="alwaysOnline" name="alwaysOnline" checked={formData.alwaysOnline} onCheckedChange={(c) => handleSelectChange('alwaysOnline', !!c)} />
                                                    <Label htmlFor="alwaysOnline">Ficar sempre online</Label>
                                                </div>
                                                <div className="flex items-center space-x-2">
                                                    <Checkbox id="readMessages" name="readMessages" checked={formData.readMessages} onCheckedChange={(c) => handleSelectChange('readMessages', !!c)} />
                                                    <Label htmlFor="readMessages">Marcar mensagens como lidas</Label>
                                                </div>
                                                <div className="flex items-center space-x-2">
                                                    <Checkbox id="readStatus" name="readStatus" checked={formData.readStatus} onCheckedChange={(c) => handleSelectChange('readStatus', !!c)} />
                                                    <Label htmlFor="readStatus">Marcar status como vistos</Label>
                                                </div>
                                                <div className="flex items-center space-x-2">
                                                    <Checkbox id="syncFullHistory" name="syncFullHistory" checked={formData.syncFullHistory} onCheckedChange={(c) => handleSelectChange('syncFullHistory', !!c)} />
                                                    <Label htmlFor="syncFullHistory">Sincronizar histórico completo</Label>
                                                </div>
                                            </AccordionContent>
                                        </AccordionItem>
                                    </CardHeader>
                                </Card>
                                <Card>
                                     <CardHeader className="p-4">
                                        <AccordionItem value="behavior-settings" className="border-b-0">
                                            <AccordionTrigger className="p-0 text-base">Comportamento da Instância</AccordionTrigger>
                                            <AccordionContent className="space-y-4 pt-4">
                                                <div className="flex items-center space-x-2">
                                                    <Checkbox id="rejectCall" name="rejectCall" checked={formData.rejectCall} onCheckedChange={(c) => handleSelectChange('rejectCall', !!c)} />
                                                    <Label htmlFor="rejectCall">Rejeitar chamadas de voz e vídeo</Label>
                                                </div>
                                                {formData.rejectCall && (
                                                    <div className="space-y-2 pl-6 animate-in fade-in-50">
                                                        <Label htmlFor="msgCall">Mensagem ao rejeitar chamada</Label>
                                                        <Input id="msgCall" name="msgCall" placeholder="Não podemos atender chamadas neste número." value={formData.msgCall || ''} onChange={handleInputChange}/>
                                                    </div>
                                                )}
                                                <div className="flex items-center space-x-2">
                                                    <Checkbox id="groupsIgnore" name="groupsIgnore" checked={formData.groupsIgnore} onCheckedChange={(c) => handleSelectChange('groupsIgnore', !!c)} />
                                                    <Label htmlFor="groupsIgnore">Ignorar mensagens de grupos</Label>
                                                </div>
                                            </AccordionContent>
                                        </AccordionItem>
                                    </CardHeader>
                                </Card>
                                <Card>
                                     <CardHeader className="p-4">
                                        <AccordionItem value="proxy" className="border-b-0">
                                            <AccordionTrigger className="p-0 text-base">Configurações de Proxy</AccordionTrigger>
                                            <AccordionContent className="space-y-4 pt-4">
                                                <div className="flex items-center space-x-2 mb-4">
                                                    <Checkbox id="useProxy" checked={useProxy} onCheckedChange={(checked) => setUseProxy(Boolean(checked))} />
                                                    <Label htmlFor="useProxy">Usar um servidor proxy</Label>
                                                </div>
                                                {useProxy && (
                                                    <div className="grid grid-cols-2 gap-4 animate-in fade-in-50">
                                                        {/* Proxy fields here */}
                                                    </div>
                                                )}
                                            </AccordionContent>
                                        </AccordionItem>
                                     </CardHeader>
                                </Card>
                            </Accordion>
                     </div>
                 )}

            </div>
            </ScrollArea>
             <DialogFooter className="pt-4">
                {step > 1 && (
                    <Button type="button" variant="ghost" onClick={prevStep}>
                        <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
                    </Button>
                )}
                <div className="flex-grow" />
                {step < totalSteps ? (
                    <Button type="button" onClick={nextStep}>
                        Continuar <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                ) : (
                    <Button type="submit" disabled={isSubmitting}>
                        {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Criar Instância
                    </Button>
                )}
            </DialogFooter>
        </form>
    )
}

function EditInstanceDialog({ instance, onSave }: { instance: EvolutionInstance, onSave: () => void }) {
    const { toast } = useToast();
    const [isOpen, setIsOpen] = useState(false);
    const [settings, setSettings] = useState<EvolutionInstanceSettings | null>(null);
    const [loadingSettings, setLoadingSettings] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        const fetchSettings = async () => {
            if (isOpen) {
                setLoadingSettings(true);
                const result = await getInstanceSettings(instance.instance_name);
                if (result) {
                    setSettings(result);
                } else {
                    toast({ title: 'Erro ao buscar configurações', description: 'Não foi possível carregar as configurações atuais da instância.', variant: 'destructive'});
                    setIsOpen(false);
                }
                setLoadingSettings(false);
            }
        };
        fetchSettings();
    }, [isOpen, instance.instance_name, toast]);
    
    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setIsSubmitting(true);
        const formData = new FormData(e.currentTarget);
        
        const newSettings: EvolutionInstanceSettings = {
            rejectCall: formData.get('rejectCall') === 'on',
            msgCall: formData.get('msgCall') as string,
            groupsIgnore: formData.get('groupsIgnore') === 'on',
            alwaysOnline: formData.get('alwaysOnline') === 'on',
            readMessages: formData.get('readMessages') === 'on',
            readStatus: formData.get('readStatus') === 'on',
            syncFullHistory: formData.get('syncFullHistory') === 'on',
        };

        const result = await updateInstanceSettings(instance.instance_name, newSettings);

        if (result.success) {
            toast({ title: 'Configurações Salvas!', description: 'As alterações foram aplicadas à instância.' });
            setIsOpen(false);
            onSave();
        } else {
            toast({ title: 'Erro ao Salvar', description: result.error, variant: 'destructive' });
        }
        setIsSubmitting(false);
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <DropdownMenuItem onSelect={(e) => e.preventDefault()}><Settings className="mr-2"/>Configurações</DropdownMenuItem>
            </DialogTrigger>
            <DialogContent>
                 <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>Editar Configurações</DialogTitle>
                        <DialogDescription>Ajuste as configurações para a instância <span className='font-bold'>{instance.display_name}</span>.</DialogDescription>
                    </DialogHeader>
                    {loadingSettings ? (
                        <div className="flex items-center justify-center h-48">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        </div>
                    ) : settings ? (
                        <div className="py-4 space-y-4">
                            <div className="flex items-center space-x-2">
                                <Switch id="rejectCall" name="rejectCall" defaultChecked={settings.rejectCall} />
                                <Label htmlFor="rejectCall">Rejeitar chamadas</Label>
                            </div>
                             <div className="space-y-2">
                                <Label htmlFor="msgCall">Mensagem ao rejeitar</Label>
                                <Input id="msgCall" name="msgCall" defaultValue={settings.msgCall} />
                            </div>
                            <div className="flex items-center space-x-2">
                                <Switch id="groupsIgnore" name="groupsIgnore" defaultChecked={settings.groupsIgnore} />
                                <Label htmlFor="groupsIgnore">Ignorar grupos</Label>
                            </div>
                            <div className="flex items-center space-x-2">
                                <Switch id="alwaysOnline" name="alwaysOnline" defaultChecked={settings.alwaysOnline} />
                                <Label htmlFor="alwaysOnline">Sempre online</Label>
                            </div>
                             <div className="flex items-center space-x-2">
                                <Switch id="readMessages" name="readMessages" defaultChecked={settings.readMessages} />
                                <Label htmlFor="readMessages">Marcar como lido</Label>
                            </div>
                        </div>
                    ) : null}
                    <DialogFooter>
                         <DialogClose asChild><Button type="button" variant="ghost">Cancelar</Button></DialogClose>
                         <Button type="submit" disabled={isSubmitting || loadingSettings}>
                            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                             <Save className="mr-2 h-4 w-4" /> Salvar
                         </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

function InstanceCard({ instance: initialInstance, onMutate, user }: { instance: Omit<EvolutionInstance, 'status' | 'qrCode'>, onMutate: () => void, user: User }) {
    const { toast } = useToast();
    const [instance, setInstance] = useState<EvolutionInstance>({...initialInstance, status: 'disconnected' });
    const [isToggling, setIsToggling] = useState(false);

    const checkStatus = useCallback(async () => {
        const result = await checkInstanceStatus(instance.instance_name);
        setInstance(prev => ({ ...prev, ...result }));
    }, [instance.instance_name]);

    useEffect(() => {
        let intervalId: NodeJS.Timeout;

        const setupPolling = (currentStatus: EvolutionInstance['status']) => {
            if (intervalId) clearInterval(intervalId); // Clear previous interval
            const intervalTime = currentStatus === 'pending' ? 2000 : 15000;
            intervalId = setInterval(checkStatus, intervalTime);
        };
        
        checkStatus(); // Initial check
        setupPolling(instance.status);

        return () => clearInterval(intervalId);
    }, [checkStatus, instance.status]);


    const handleConnect = async () => {
        setIsToggling(true);
        const result = await connectInstance(instance.instance_name);
        setInstance(prev => ({...prev, ...result }));
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
    
    const handleRestart = async () => {
        toast({ title: 'Reiniciando...', description: `A instância ${instance.display_name} está sendo reiniciada.`});
        const result = await restartInstance(instance.instance_name);
        if(result.error) {
            toast({ title: 'Erro ao reiniciar', description: result.error, variant: 'destructive'});
        } else {
            toast({ title: 'Instância Reiniciada', description: 'Aguarde alguns instantes para a reconexão.'});
            setTimeout(checkStatus, 3000);
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
                                {instance.type === 'baileys' && <EditInstanceDialog instance={instance} onSave={onMutate} />}
                                <DropdownMenuSeparator />
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
                        <Image src={instance.qrCode} alt="QR Code" width={200} height={200} />
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
                 {instance.status === 'connected' ? (
                     <Button variant="outline" onClick={handleRestart}>
                        <RefreshCw/>
                    </Button>
                 ) : (
                    <Button variant="outline" onClick={checkStatus} disabled={instance.status === 'pending'}>
                        <QrCode/>
                    </Button>
                 )}
            </CardFooter>
        </Card>
    )
}

export default function EvolutionApiPage() {
    const [user, setUser] = useState<User | null>(null);
    const [instances, setInstances] = useState<Omit<EvolutionInstance, 'status' | 'qrCode'>[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [initialQrCode, setInitialQrCode] = useState<string | undefined>();

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
    
    const handleSuccess = (qrCode?: string) => {
        setIsModalOpen(false);
        if (qrCode) {
            setInitialQrCode(qrCode);
        }
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
