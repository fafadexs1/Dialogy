

'use client';

import React, { useState, useEffect, useCallback, useActionState, useTransition } from 'react';
import type { User, EvolutionInstance, EvolutionInstanceCreationPayload, EvolutionInstanceSettings } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, PlusCircle, Server, MessageSquare, Trash2, MoreVertical, Wifi, WifiOff, QrCode, Power, PowerOff, Settings, RefreshCw, Save, ArrowLeft, ArrowRight, Lock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import Image from 'next/image';
import { getEvolutionApiInstances, createEvolutionApiInstance, deleteEvolutionApiInstance, checkInstanceStatus, connectInstance, disconnectInstance, restartInstance, getInstanceSettings, updateInstanceSettings } from '@/actions/evolution-api';
import { exchangeMetaAuthCode } from '@/actions/meta-auth';
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
import { useCurrentUser } from '@/hooks/use-online-status';


function AddInstanceForm({ workspaceId, onSuccess, onClose }: { workspaceId: string, onSuccess: (qrCode?: string) => void, onClose: () => void }) {
    const [step, setStep] = useState(1);
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

        if (name.startsWith('proxy.')) {
            const proxyField = name.split('.')[1];
            setFormData(prev => ({
                ...prev,
                proxy: {
                    ...prev.proxy,
                    [proxyField]: value,
                } as any
            }));
        } else {
            setFormData(prev => ({
                ...prev,
                [name]: type === 'checkbox' ? checked : value
            }));
        }
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

    const nextStep = () => {
        if (step === 1) {
            if (!formData.displayName?.trim()) {
                toast({
                    title: "Campo Obrigatório",
                    description: "Por favor, preencha o apelido da instância para continuar.",
                    variant: "destructive",
                });
                return;
            }
        }



        if (step === 2 && !isBaileys) { // Validation for Cloud API step
            if (!formData.number?.trim() || !formData.businessId?.trim() || !formData.token?.trim()) {
                toast({
                    title: "Campos Obrigatórios",
                    description: "Todos os campos da Meta Business API são obrigatórios. Use o botão 'Conectar com WhatsApp' para preenchê-los automaticamente.",
                    variant: "destructive",
                });
                return;
            }
        }

        setStep(s => Math.min(s + 1, totalSteps));
    };

    const handleMetaLogin = () => {
        const appId = process.env.NEXT_PUBLIC_META_APP_ID || '740952588412789';
        const configId = process.env.NEXT_PUBLIC_META_CONFIG_ID || '3807812312846037';
        // Base URL for Embedded Signup
        const baseUrl = 'https://business.facebook.com/messaging/whatsapp/onboard/';
        const extras = JSON.stringify({ sessionInfoVersion: "3", version: "v3" });
        const url = `${baseUrl}?app_id=${appId}&config_id=${configId}&extras=${encodeURIComponent(extras)}`;

        // Open Popup
        const width = 800;
        const height = 600;
        const left = (window.screen.width - width) / 2;
        const top = (window.screen.height - height) / 2;

        window.open(url, 'MetaEmbeddedSignup', `width=${width},height=${height},top=${top},left=${left}`);

        // Listen for messages
        const messageHandler = async (event: MessageEvent) => {
            if (event.origin !== "https://business.facebook.com" && event.origin !== "https://www.facebook.com") {
                // Ignore messages from other origins for security
                // BUT: sometimes local dev or different responses might come. Trusted origins only.
                // return; 
            }

            try {
                const data = JSON.parse(event.data);
                // The event data format from Meta Embedded Signup usually looks like:
                // { type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: { ... } }
                // OR simply the payload itself depending on the listener level.

                // Let's assume standard response structure
                if (data.type === 'WA_EMBEDDED_SIGNUP') {
                    if (data.event === 'FINISH') {
                        const { code, waba_id, phone_number_id } = data.data || {};

                        if (code) {
                            toast({ title: 'Autenticando...', description: 'Trocando código de autorização...' });

                            // Fill IDs immediately if available
                            if (waba_id && phone_number_id) {
                                setFormData(prev => ({ ...prev, businessId: waba_id, number: phone_number_id }));
                            }

                            // Exchange token
                            const result = await exchangeMetaAuthCode(code);
                            if (result.success && result.accessToken) {
                                setFormData(prev => ({
                                    ...prev,
                                    token: result.accessToken,
                                    // If IDs weren't in the FINISH event, maybe they come here? No, token exchange is just token.
                                    // Usually FINISH has the IDs.
                                    businessId: waba_id || prev.businessId,
                                    number: phone_number_id || prev.number
                                }));
                                toast({ title: 'Conectado!', description: 'Credenciais preenchidas com sucesso.' });
                            } else {
                                toast({ title: 'Erro de Autenticação', description: result.error || 'Falha ao obter token de acesso.', variant: 'destructive' });
                            }
                        } else if (data.event === 'CANCEL') {
                            toast({ title: 'Cancelado', description: 'O processo de conexão foi cancelado.' });
                        } else if (data.event === 'ERROR') {
                            toast({ title: 'Erro', description: 'Ocorreu um erro no fluxo do WhatsApp.', variant: 'destructive' });
                        }
                    }
                }
            } catch (err) {
                // Not JSON or irrelevant message
            }
        };

        window.addEventListener('message', messageHandler);

        // Clean up listener? Ideally yes, but hard to know when to stop if popup stays open.
        // We can remove it after success.
        // For now, React useEffect cleanup is tricky inside a handler. 
        // We might just leave it or use a ref to track if we're listening.
    };


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
                                    <Select name="integration" value={formData.integration} onValueChange={(value) => { setFormData(prev => ({ ...prev, integration: value as "WHATSAPP-BAILEYS" | "WHATSAPP-BUSINESS" })); }}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
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
                                    <Input id="baileysToken" name="token" placeholder="Token para segurança da instância" value={formData.token || ''} onChange={handleInputChange} />
                                </div>
                            </CardContent>
                        </Card>
                    )}
                    {step === 2 && !isBaileys && (
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Configurações da Meta Business API</CardTitle>
                                <CardDescription>Conecte sua conta oficial do WhatsApp Business.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="p-4 border rounded-lg bg-blue-50/50 flex flex-col items-center justify-center gap-3">
                                    <p className="text-sm text-center text-muted-foreground">
                                        Use o botão abaixo para conectar sua conta, selecionar o número e preencher as credenciais automaticamente.
                                    </p>
                                    <Button type="button" variant="default" className="bg-[#1877F2] hover:bg-[#1877F2]/90 text-white w-full sm:w-auto" onClick={handleMetaLogin}>
                                        <svg className="mr-2 h-4 w-4" fill="currentColor" viewBox="0 0 24 24" role="img" xmlns="http://www.w3.org/2000/svg"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.791-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" /></svg>
                                        Conectar com WhatsApp
                                    </Button>
                                    <div className="flex items-center gap-2 w-full">
                                        <Separator className="flex-1" />
                                        <span className="text-xs text-muted-foreground">OU PREENCHA MANUALMENTE</span>
                                        <Separator className="flex-1" />
                                    </div>
                                </div>
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
                                    <Input id="token" name="token" type="password" placeholder="Seu token permanente da API da Meta" required value={formData.token || ''} onChange={handleInputChange} />
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
                                                        <Input id="msgCall" name="msgCall" placeholder="Não podemos atender chamadas neste número." value={formData.msgCall || ''} onChange={handleInputChange} />
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
                                                        <div className="col-span-2 space-y-2">
                                                            <Label htmlFor="proxy.host">Host do Proxy</Label>
                                                            <Input id="proxy.host" name="proxy.host" placeholder="127.0.0.1" value={formData.proxy?.host || ''} onChange={handleInputChange} />
                                                        </div>
                                                        <div className="space-y-2">
                                                            <Label htmlFor="proxy.port">Porta</Label>
                                                            <Input id="proxy.port" name="proxy.port" type="number" placeholder="8080" value={formData.proxy?.port || ''} onChange={handleInputChange} />
                                                        </div>
                                                        <div className="space-y-2">
                                                            <Label htmlFor="proxy.protocol">Protocolo</Label>
                                                            <Input id="proxy.protocol" name="proxy.protocol" placeholder="http" value={formData.proxy?.protocol || ''} onChange={handleInputChange} />
                                                        </div>
                                                        <div className="space-y-2">
                                                            <Label htmlFor="proxy.username">Usuário (Opcional)</Label>
                                                            <Input id="proxy.username" name="proxy.username" value={formData.proxy?.username || ''} onChange={handleInputChange} />
                                                        </div>
                                                        <div className="space-y-2">
                                                            <Label htmlFor="proxy.password">Senha (Opcional)</Label>
                                                            <Input id="proxy.password" name="proxy.password" type="password" value={formData.proxy?.password || ''} onChange={handleInputChange} />
                                                        </div>
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
            </ScrollArea >
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
        </form >
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
                    toast({ title: 'Erro ao buscar configurações', description: 'Não foi possível carregar as configurações atuais da instância.', variant: 'destructive' });
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
                <DropdownMenuItem onSelect={(e) => e.preventDefault()}><Settings className="mr-2" />Configurações</DropdownMenuItem>
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
    const [instance, setInstance] = useState<EvolutionInstance>({ ...initialInstance, status: 'disconnected' });
    const [isToggling, setIsToggling] = useState(false);

    const [errorCount, setErrorCount] = useState(0);

    const checkStatus = useCallback(async () => {
        try {
            const result = await checkInstanceStatus(instance.instance_name);
            setInstance(prev => ({ ...prev, ...result }));
            setErrorCount(0);
        } catch (error) {
            console.error("[InstanceCard] Polling error:", error);
            setErrorCount(prev => prev + 1);
        }
    }, [instance.instance_name]);

    useEffect(() => {
        let intervalId: NodeJS.Timeout;

        if (errorCount > 5) {
            console.warn("[InstanceCard] Too many errors, stopping polling.");
            toast({
                title: "Erro de Conexão",
                description: "Falha ao atualizar status. Recarregue a página.",
                variant: "destructive"
            });
            return;
        }

        const setupPolling = (currentStatus: EvolutionInstance['status']) => {
            if (intervalId) clearInterval(intervalId); // Clear previous interval
            const intervalTime = currentStatus === 'pending' ? 3000 : 15000;
            intervalId = setInterval(checkStatus, intervalTime);
        };

        checkStatus(); // Initial check
        setupPolling(instance.status);

        return () => clearInterval(intervalId);
    }, [checkStatus, instance.status, errorCount, toast]);


    const handleConnect = async () => {
        setIsToggling(true);
        const result = await connectInstance(instance.instance_name);
        setInstance(prev => ({ ...prev, ...result }));
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
            toast({ title: 'Erro ao deletar', description: result.error, variant: 'destructive' });
        } else {
            toast({ title: 'Instância Deletada!', description: `A instância ${instance.display_name} foi removida.` });
            onMutate();
        }
    }

    const handleRestart = async () => {
        toast({ title: 'Reiniciando...', description: `A instância ${instance.display_name} está sendo reiniciada.` });
        const result = await restartInstance(instance.instance_name);
        if (result.error) {
            toast({ title: 'Erro ao reiniciar', description: result.error, variant: 'destructive' });
        } else {
            toast({ title: 'Instância Reiniciada', description: 'Aguarde alguns instantes para a reconexão.' });
            setTimeout(checkStatus, 3000);
        }
    }

    return (
        <Card>
            <CardHeader>
                <div className="flex justify-between items-start">
                    <div>
                        <CardTitle className="flex items-center gap-2">
                            {instance.status === 'connected' ? <Wifi className="text-green-500" /> : instance.status === 'pending' ? <Loader2 className="animate-spin text-yellow-500" /> : <WifiOff className="text-red-500" />}
                            {instance.display_name}
                        </CardTitle>
                        <CardDescription>{instance.type === 'wa_cloud' ? 'Cloud API' : 'Baileys'} • {instance.instance_name}</CardDescription>
                    </div>
                    <AlertDialog>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon"><MoreVertical /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                                {instance.type === 'baileys' && <EditInstanceDialog instance={instance} onSave={onMutate} />}
                                <DropdownMenuSeparator />
                                <AlertDialogTrigger asChild>
                                    <DropdownMenuItem className="w-full justify-start text-destructive hover:text-destructive" onSelect={(e) => e.preventDefault()}>
                                        <Trash2 className="mr-2" />Excluir
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
                        {isToggling ? <Loader2 className="animate-spin mr-2" /> : <PowerOff className="mr-2" />} Desconectar
                    </Button>
                ) : (
                    <Button variant="default" onClick={handleConnect} disabled={isToggling} className="w-full">
                        {isToggling ? <Loader2 className="animate-spin mr-2" /> : <Power className="mr-2" />} Conectar
                    </Button>
                )}
                {instance.status === 'connected' ? (
                    <Button variant="outline" onClick={handleRestart}>
                        <RefreshCw />
                    </Button>
                ) : (
                    <Button variant="outline" onClick={checkStatus} disabled={instance.status === 'pending'}>
                        <QrCode />
                    </Button>
                )}
            </CardFooter>
        </Card>
    )
}

export default function EvolutionApiPage() {
    const { toast } = useToast();
    const user = useCurrentUser();
    const [instances, setInstances] = useState<Omit<EvolutionInstance, 'status' | 'qrCode'>[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [initialQrCode, setInitialQrCode] = useState<string | undefined>();
    const [limitStatus, setLimitStatus] = useState<{ reached: boolean, current: number, max: number, plan: string } | null>(null);

    const fetchData = useCallback(async () => {
        if (!user?.activeWorkspaceId) return;
        setLoading(true);
        try {
            const result = await getEvolutionApiInstances(user.activeWorkspaceId);
            if (result.error) {
                toast({ title: 'Erro ao carregar inst\u00e2ncias', description: result.error, variant: 'destructive' });
                setInstances([]);
            } else {
                setInstances(result.instances || []);
                if (result.limitStatus) {
                    setLimitStatus(result.limitStatus);
                }
            }
        } catch (error) {
            console.error('[EVO_PAGE] Falha ao buscar inst\u00e2ncias', error);
            toast({ title: 'Erro ao carregar inst\u00e2ncias', description: 'N\u00e3o foi poss\u00edvel buscar as inst\u00e2ncias deste workspace.', variant: 'destructive' });
            setInstances([]);
        }
        setLoading(false);
    }, [toast, user?.activeWorkspaceId]);

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
                    {limitStatus?.reached ? (
                        <div className="flex flex-col items-end gap-1">
                            <Button variant="ghost" disabled className="bg-destructive/10 text-destructive hover:bg-destructive/20 cursor-not-allowed border border-destructive/20">
                                <Lock className="mr-2 h-4 w-4" /> Limite Atingido ({limitStatus.current}/{limitStatus.max})
                            </Button>
                            <span className="text-[10px] text-muted-foreground mr-1">Faça upgrade do plano {limitStatus.plan}</span>
                        </div>
                    ) : (
                        <DialogTrigger asChild>
                            <Button>
                                <PlusCircle className="mr-2 h-4 w-4" />
                                Criar Instância
                            </Button>
                        </DialogTrigger>
                    )}
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
