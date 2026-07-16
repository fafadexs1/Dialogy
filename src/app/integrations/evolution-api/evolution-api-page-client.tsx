

'use client';

import React, { useState, useEffect, useCallback, useActionState, useTransition } from 'react';
import type { User, EvolutionInstance, EvolutionInstanceCreationPayload, EvolutionInstanceSettings } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, PlusCircle, Server, MessageSquare, Trash2, MoreVertical, Wifi, WifiOff, QrCode, Power, PowerOff, Settings, RefreshCw, Save, ArrowLeft, ArrowRight, Lock, Send, ShieldCheck } from 'lucide-react';
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

const META_CONFIG_PLACEHOLDERS = new Set([
    '1234567890123456',
]);

function getMetaEmbeddedSignupConfig() {
    const appId = (process.env.NEXT_PUBLIC_FACEBOOK_APP_ID || process.env.NEXT_PUBLIC_META_APP_ID || '').trim();
    const configId = (process.env.NEXT_PUBLIC_META_CONFIG_ID || '').trim();

    return {
        appId,
        configId,
        hasValidAppId: /^\d{8,}$/.test(appId),
        hasValidConfigId: /^\d{8,}$/.test(configId) && !META_CONFIG_PLACEHOLDERS.has(configId),
    };
}

type ChannelMode = 'whatsapp' | 'telegram';

function getInitialFormData(channelMode: ChannelMode): Partial<EvolutionInstanceCreationPayload> {
    return {
        displayName: '',
        integration: channelMode === 'telegram' ? 'EVOLUTION' : 'WHATSAPP-BAILEYS',
        channel: channelMode === 'telegram' ? 'telegram' : undefined,
        rejectCall: false,
        groupsIgnore: false,
        alwaysOnline: false,
        readMessages: true,
        readStatus: false,
        syncFullHistory: false,
        webhook: { events: [] }
    };
}


function AddInstanceForm({ workspaceId, onSuccess, onClose, channelMode }: { workspaceId: string, onSuccess: (qrCode?: string) => void, onClose: () => void, channelMode: ChannelMode }) {
    const { toast } = useToast();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [statusMessage, setStatusMessage] = useState<string>('');
    const isTelegramOnly = channelMode === 'telegram';
    const [manualMode, setManualMode] = useState(isTelegramOnly);
    const {
        appId: metaAppId,
        configId: metaConfigId,
        hasValidAppId: hasValidMetaAppId,
        hasValidConfigId: hasValidMetaConfigId,
    } = getMetaEmbeddedSignupConfig();
    const canStartMetaEmbeddedSignup = hasValidMetaAppId && hasValidMetaConfigId;

    // Form data state
    const [formData, setFormData] = useState<Partial<EvolutionInstanceCreationPayload>>(() => getInitialFormData(channelMode));

    // Manual Steps
    const [step, setStep] = useState(1);
    const [useProxy, setUseProxy] = useState(false);

    useEffect(() => {
        setManualMode(isTelegramOnly);
        setFormData(getInitialFormData(channelMode));
        setStep(1);
    }, [channelMode, isTelegramOnly]);

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
        setStatusMessage('Provisionando instância...');

        const payload: EvolutionInstanceCreationPayload = {
            ...formData,
            displayName: formData.displayName!,
            integration: formData.integration as any,
            qrcode: formData.integration === 'WHATSAPP-BAILEYS',
        };

        const result = await createEvolutionApiInstance(payload, workspaceId);
        setIsSubmitting(false);
        setStatusMessage('');

        if (result.success) {
            toast({ title: 'Instância Criada!', description: 'Sua instância está sendo provisionada.' });
            onSuccess(result.qrCode);
        } else {
            toast({ title: 'Erro ao Criar Instância', description: result.error, variant: 'destructive' });
        }
    };

    // --- AUTOMATED META FLOW ---
    const handleMetaLogin = () => {
        if (!hasValidMetaAppId) {
            toast({
                title: 'Configuração Meta ausente',
                description: 'Defina NEXT_PUBLIC_FACEBOOK_APP_ID ou NEXT_PUBLIC_META_APP_ID com o App ID correto antes de conectar o WhatsApp.',
                variant: 'destructive'
            });
            return;
        }

        if (!hasValidMetaConfigId) {
            toast({
                title: 'Config ID da Meta ausente',
                description: 'Defina NEXT_PUBLIC_META_CONFIG_ID com o Config ID real do Facebook Login for Business / WhatsApp Embedded Signup.',
                variant: 'destructive'
            });
            return;
        }

        if (!window.FB) {
            toast({ title: 'Erro', description: 'SDK do Facebook não carregado. Verifique bloqueadores de anúncios.', variant: 'destructive' });
            return;
        }

        // Shared data capture container
        const capture = {
            waba_id: null as string | null,
            phone_number_id: null as string | null,
            code: null as string | null
        };

        const messageHandler = (event: MessageEvent) => {
            // Log all messages from facebook for debugging
            if (event.origin.includes('facebook')) {
                console.log('[Meta] Raw message from Facebook:', event.data);
            }
            if (event.origin !== "https://www.facebook.com" && event.origin !== "https://web.facebook.com") return;
            try {
                const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
                console.log('[Meta] Parsed message:', data);
                if (data.type === 'WA_EMBEDDED_SIGNUP') {
                    console.log('[Meta] WA_EMBEDDED_SIGNUP event:', data);
                    if (data.event === 'FINISH' || data.event === 'SUBMIT') {
                        const d = data.data || {};
                        capture.waba_id = d.waba_id || d.wabaId;
                        capture.phone_number_id = d.phone_number_id || d.phoneNumberId;
                        console.log('[Meta] Captured IDs:', { waba_id: capture.waba_id, phone_number_id: capture.phone_number_id });
                    }
                }
            } catch (e) {
                // Not JSON, ignore
            }
        };

        window.addEventListener('message', messageHandler);

        window.FB.login((response: any) => {
            (async () => {
                console.log('[Meta] Login response:', response);

                // Early return if no valid auth code - FB.login can call callback multiple times
                if (!response.authResponse || !response.authResponse.code) {
                    console.log('[Meta] Waiting for auth code...');
                    return;
                }

                capture.code = response.authResponse.code;
                console.log('[Meta] Auth code received, proceeding with token exchange...');

                setIsSubmitting(true);
                setStatusMessage('Autenticando com Meta...');

                try {
                    const result = await exchangeMetaAuthCode(
                        response.authResponse.code,
                        capture.waba_id || undefined
                    );

                    if (result.success && result.accessToken) {
                        // Use WABA IDs from API response (or from postMessage if available)
                        const wabaId = capture.waba_id || result.wabaId;
                        const phoneId = capture.phone_number_id || result.phoneNumberId;

                        if (result.metaInfo) {
                            console.log('[Meta] Meta Info captured:', result.metaInfo);
                        }

                        if (!wabaId || !phoneId) {
                            console.error('[Meta] No WABA IDs found. Result:', result, 'Capture:', capture);
                            toast({
                                title: 'Erro de Configuração',
                                description: 'Não foi possível obter os IDs do WhatsApp Business. Verifique se a conta tem um número de telefone registrado.',
                                variant: 'destructive'
                            });
                            return;
                        }

                        setStatusMessage('Criando Instância Evolution...');

                        // This is only the friendly label in Dialogy.
                        const displayName = `wb${phoneId.slice(-4)}`;
                        const payload: EvolutionInstanceCreationPayload = {
                            displayName,
                            integration: 'WHATSAPP-BUSINESS',
                            businessId: wabaId,
                            number: phoneId,
                            token: result.accessToken,
                            qrcode: false,
                            // Definições padrão
                            readMessages: true,
                            readStatus: false,
                            rejectCall: false,
                            groupsIgnore: false,
                            alwaysOnline: true,
                            webhook: { events: [] },
                            // Only include metaInfo if it exists (prevents "$undefined" serialization)
                            ...(result.metaInfo && { metaInfo: result.metaInfo })
                        };

                        const creationResult = await createEvolutionApiInstance(payload, workspaceId);

                        if (creationResult.success) {
                            toast({ title: 'Conectado!', description: 'WhatsApp Business conectado com sucesso.' });
                            onSuccess(undefined);
                        } else {
                            toast({ title: 'Erro na Criação', description: creationResult.error, variant: 'destructive' });
                        }
                    } else {
                        toast({ title: 'Erro de Autenticação', description: result.error || 'Falha ao trocar token.', variant: 'destructive' });
                    }
                } catch (error) {
                    console.error(error);
                    toast({ title: 'Erro Interno', description: 'Falha ao processar integração.', variant: 'destructive' });
                } finally {
                    window.removeEventListener('message', messageHandler);
                    setIsSubmitting(false);
                    setStatusMessage('');
                }
            })();
        }, {
            config_id: metaConfigId,
            response_type: 'code',
            override_default_response_type: true,
            extras: {
                feature: 'whatsapp_embedded_signup',
                sessionInfoVersion: 3,
            }
        });
    };


    // --- MANUAL STEPS LOGIC (LEGACY) ---
    const isBaileys = formData.integration === 'WHATSAPP-BAILEYS';
    const isTelegram = formData.integration === 'EVOLUTION';
    const totalSteps = isBaileys ? 3 : 2;

    const STEPS = [
        { id: 1, title: "Essencial" },
        { id: 2, title: isTelegram ? "Bot" : "Conexao" },
        ...(isBaileys ? [{ id: 3, title: "Avançado" }] : [])
    ];

    const nextStep = () => {
        if (step === 1) {
            if (!formData.displayName?.trim()) {
                toast({ title: "Campo Obrigatório", description: "O apelido é obrigatório.", variant: "destructive" });
                return;
            }
        }
        if (step === 2 && isTelegram) {
            if (!formData.telegramBotToken?.trim()) {
                toast({ title: "Campo Obrigatorio", description: "Cole o token do bot Telegram.", variant: "destructive" });
                return;
            }
        }
        if (step === 2 && !isBaileys && !isTelegram) {
            if (!formData.number?.trim() || !formData.businessId?.trim() || !formData.token?.trim()) {
                toast({ title: "Campos Obrigatórios", description: "Todos os campos da Meta Business API são obrigatórios.", variant: "destructive" });
                return;
            }
        }
        setStep(s => Math.min(s + 1, totalSteps));
    };
    const prevStep = () => setStep(s => Math.max(s - 1, 1));

    const startManualConnection = (integration: 'WHATSAPP-BAILEYS' | 'WHATSAPP-BUSINESS') => {
        setFormData(prev => ({
            ...prev,
            integration,
            channel: undefined,
        }));
        setStep(1);
        setManualMode(true);
    };


    // --- RENDER ---

    if (isSubmitting) {
        return (
            <div className="h-[400px] flex flex-col items-center justify-center space-y-4">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
                <div className="text-center">
                    <h3 className="text-lg font-medium">Aguarde um momento</h3>
                    <p className="text-sm text-muted-foreground">{statusMessage || 'Processando...'}</p>
                </div>
            </div>
        )
    }

    if (!manualMode) {
        return (
            <div className="py-8 px-4 flex flex-col items-center space-y-8">
                <div className="text-center space-y-2">
                    <h2 className="text-2xl font-bold">Conectar WhatsApp</h2>
                    <p className="text-muted-foreground max-w-md mx-auto">
                        Escolha entre Cloud API oficial ou conexao via QR Code, ambas gerenciadas pela Evolution API.
                    </p>
                </div>

                <div className="grid w-full max-w-xl grid-cols-1 gap-4">
                <Card
                    className={cn(
                        "border-2 border-blue-100 transition-colors shadow-lg group",
                        canStartMetaEmbeddedSignup ? "cursor-pointer hover:border-blue-300" : "cursor-not-allowed opacity-70"
                    )}
                    onClick={canStartMetaEmbeddedSignup ? handleMetaLogin : undefined}
                >
                    <CardHeader className="text-center pb-2">
                        <div className="mx-auto w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                            <svg className="w-8 h-8 text-[#1877F2]" fill="currentColor" viewBox="0 0 24 24" role="img" xmlns="http://www.w3.org/2000/svg"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.791-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" /></svg>
                        </div>
                        <CardTitle className="text-xl">WhatsApp Cloud API (Oficial)</CardTitle>
                        <CardDescription>
                            {canStartMetaEmbeddedSignup
                                ? 'Recomendado para empresas'
                                : 'Configure NEXT_PUBLIC_META_CONFIG_ID com o Config ID real da Meta para habilitar esta conexão.'}
                        </CardDescription>
                    </CardHeader>
                    <CardFooter className="justify-center pt-2 pb-6">
                        <Button className="bg-[#1877F2] hover:bg-[#1877F2]/90 w-full font-semibold" disabled={!canStartMetaEmbeddedSignup}>
                            Conectar com Facebook
                        </Button>
                    </CardFooter>
                </Card>
                </div>

                <div className="relative w-full max-w-md">
                    <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                    <div className="relative flex justify-center text-xs uppercase"><span className="bg-background px-2 text-muted-foreground">Ou</span></div>
                </div>

                <Button variant="ghost" size="sm" onClick={() => startManualConnection('WHATSAPP-BAILEYS')} className="text-muted-foreground hover:text-foreground">
                    Conectar manualmente (QRCode / Baileys / Token)
                </Button>
            </div>
        )
    }

    return (
        <form onSubmit={handleSubmit}>
            <DialogHeader>
                <div className="flex items-center gap-2">
                    {!isTelegramOnly && (
                        <Button type="button" variant="ghost" size="icon" onClick={() => setManualMode(false)} className="-ml-2"><ArrowLeft className="h-4 w-4" /></Button>
                    )}
                    <DialogTitle>{isTelegramOnly ? 'Configurar Telegram Bot' : 'Configuração Manual'}</DialogTitle>
                </div>
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
                                <CardTitle className="text-base">{isTelegramOnly ? 'Configurações do Bot' : 'Configurações Essenciais'}</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="displayName">{isTelegramOnly ? 'Apelido do Bot (Obrigatório)' : 'Apelido da Instância (Obrigatório)'}</Label>
                                    <Input
                                        id="displayName"
                                        name="displayName"
                                        placeholder={isTelegramOnly ? 'Ex: Suporte Telegram, Bot Comercial' : 'Ex: Vendas, Suporte Principal'}
                                        required
                                        value={formData.displayName}
                                        onChange={handleInputChange}
                                    />
                                </div>
                                {isTelegramOnly ? (
                                    <div className="rounded-lg border bg-sky-50 p-4 text-sm text-sky-950">
                                        <div className="flex items-start gap-3">
                                            <Send className="mt-0.5 h-4 w-4 flex-shrink-0" />
                                            <p>Canal fixo: Telegram Bot conectado via Evolution Channel, com webhook automático para o inbox.</p>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        <Label htmlFor="integrationType">Tipo de Conexão</Label>
                                        <Select name="integration" value={formData.integration} onValueChange={(value) => { setFormData(prev => ({ ...prev, integration: value as "WHATSAPP-BAILEYS" | "WHATSAPP-BUSINESS", channel: undefined })); }}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="WHATSAPP-BAILEYS">WhatsApp (Baileys - Não Oficial)</SelectItem>
                                                <SelectItem value="WHATSAPP-BUSINESS">WhatsApp Business (Cloud API - Oficial)</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                )}
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
                    {step === 2 && isTelegram && (
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Telegram Bot</CardTitle>
                                <CardDescription>Cole o token criado no BotFather. A Dialogy valida o bot, cria a instancia Evolution Channel e ativa o webhook automaticamente.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="telegramBotToken">Token do Bot Telegram</Label>
                                    <Input
                                        id="telegramBotToken"
                                        name="telegramBotToken"
                                        type="password"
                                        placeholder="123456789:AA..."
                                        required
                                        value={formData.telegramBotToken || ''}
                                        onChange={handleInputChange}
                                    />
                                </div>
                                <div className="rounded-lg border bg-sky-50 p-4 text-sm text-sky-950">
                                    <div className="flex items-start gap-3">
                                        <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0" />
                                        <p>Use um bot dedicado para atendimento. Assim que a instancia for criada, mensagens novas do Telegram entram no inbox como qualquer conversa.</p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    )}
                    {step === 2 && !isBaileys && !isTelegram && (
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Configurações da Meta Business API</CardTitle>
                                <CardDescription>Insira as credenciais do seu aplicativo Meta manualmente.</CardDescription>
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
                                {/* Other settings cards kept as is */}
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
        let intervalId: ReturnType<typeof setInterval>;

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

    const cloudPrimaryLabel = instance.verified_name || instance.business_name || null;
    const cloudPhoneLabel = instance.display_phone_number || instance.phone_number_id || null;
    const cloudWabaLabel = instance.waba_name || instance.waba_id || null;
    const isTelegram = instance.type === 'telegram';
    const typeLabel = instance.type === 'wa_cloud'
        ? 'Cloud API'
        : isTelegram
            ? 'Telegram Bot'
            : 'Baileys';

    return (
        <Card>
            <CardHeader>
                <div className="flex justify-between items-start">
                    <div>
                        <CardTitle className="flex items-center gap-2">
                            {isTelegram ? <Send className="text-sky-500" /> : instance.status === 'connected' ? <Wifi className="text-green-500" /> : instance.status === 'pending' ? <Loader2 className="animate-spin text-yellow-500" /> : <WifiOff className="text-red-500" />}
                            {instance.display_name}
                        </CardTitle>
                        <CardDescription>{typeLabel} • {instance.instance_name}</CardDescription>
                        {instance.type === 'wa_cloud' && (
                            <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                                {cloudPrimaryLabel && <p className="text-foreground/90 font-medium">{cloudPrimaryLabel}</p>}
                                {cloudPhoneLabel && <p>Número: {cloudPhoneLabel}</p>}
                                {cloudWabaLabel && <p>WABA: {cloudWabaLabel}</p>}
                                {!cloudPrimaryLabel && !cloudPhoneLabel && !cloudWabaLabel && (
                                    <p>Dados da Meta indisponíveis nesta instância.</p>
                                )}
                            </div>
                        )}
                        {isTelegram && (
                            <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                                {instance.telegram_bot_username && <p className="text-foreground/90 font-medium">@{instance.telegram_bot_username}</p>}
                                {instance.telegram_bot_name && <p>Bot: {instance.telegram_bot_name}</p>}
                                {instance.telegram_bot_id && <p>ID: {instance.telegram_bot_id}</p>}
                            </div>
                        )}
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
                {instance.status === 'pending' && instance.qrCode && !isTelegram ? (
                    <div className="flex flex-col items-center gap-2">
                        <p className='text-sm text-center'>Escaneie o QR Code com seu WhatsApp para conectar.</p>
                        <Image src={instance.qrCode} alt="QR Code" width={200} height={200} />
                    </div>
                ) : (
                    <div className='text-sm text-muted-foreground text-center p-4'>
                        {isTelegram
                            ? instance.status === 'connected' ? 'Webhook do Telegram ativo e pronto para receber mensagens.' : 'Webhook do Telegram pausado ou pendente.'
                            : instance.status === 'connected' ? 'Conectado e pronto para uso.' : 'A instância está desconectada.'}
                    </div>
                )}
            </CardContent>
            <CardFooter className="gap-2">
                {instance.status === 'connected' ? (
                    <Button variant="destructive" onClick={handleDisconnect} disabled={isToggling} className="w-full">
                        {isToggling ? <Loader2 className="animate-spin mr-2" /> : <PowerOff className="mr-2" />} {isTelegram ? 'Pausar webhook' : 'Desconectar'}
                    </Button>
                ) : (
                    <Button variant="default" onClick={handleConnect} disabled={isToggling} className="w-full">
                        {isToggling ? <Loader2 className="animate-spin mr-2" /> : <Power className="mr-2" />} {isTelegram ? 'Ativar webhook' : 'Conectar'}
                    </Button>
                )}
                {instance.status === 'connected' ? (
                    <Button variant="outline" onClick={handleRestart}>
                        <RefreshCw />
                    </Button>
                ) : (
                    <Button variant="outline" onClick={checkStatus} disabled={instance.status === 'pending'}>
                        {isTelegram ? <RefreshCw /> : <QrCode />}
                    </Button>
                )}
            </CardFooter>
        </Card>
    )
}

export default function EvolutionApiPage({ channelMode = 'whatsapp' }: { channelMode?: ChannelMode }) {
    const { toast } = useToast();
    const user = useCurrentUser();
    const [instances, setInstances] = useState<Omit<EvolutionInstance, 'status' | 'qrCode'>[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [initialQrCode, setInitialQrCode] = useState<string | undefined>();
    const [limitStatus, setLimitStatus] = useState<{ reached: boolean, current: number, max: number, plan: string } | null>(null);
    const isTelegramView = channelMode === 'telegram';

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

    const visibleInstances = instances.filter((instance) => isTelegramView ? instance.type === 'telegram' : instance.type !== 'telegram');
    const cloudApiInstances = visibleInstances.filter(i => i.type === 'wa_cloud');
    const pageTitle = isTelegramView ? 'Telegram Bot' : 'Conexao com a Evolution API';
    const pageDescription = isTelegramView
        ? 'Gerencie bots do Telegram com webhook automatico e inbox dedicado.'
        : 'Gerencie instancias de WhatsApp para atendimento.';
    const primaryActionLabel = isTelegramView ? 'Adicionar Bot' : 'Criar Instancia';
    const emptyTitle = isTelegramView ? 'Nenhum bot conectado' : 'Nenhuma instancia criada';
    const emptyDescription = isTelegramView
        ? 'Clique em "Adicionar Bot" para conectar seu primeiro bot do Telegram.'
        : 'Clique em "Criar Instancia" para conectar seu primeiro canal.';

    return (
        <div className="flex flex-col flex-1 h-full">
            <header className="p-4 sm:p-6 border-b flex-shrink-0 bg-background flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">{isTelegramView ? <Send /> : <Server />} {pageTitle}</h1>
                    <p className="text-muted-foreground">{pageDescription}</p>
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
                                {primaryActionLabel}
                            </Button>
                        </DialogTrigger>
                    )}
                    <DialogContent className="max-w-3xl">
                        <DialogTitle className="sr-only">{isTelegramView ? 'Adicionar bot Telegram' : 'Criar nova instancia'}</DialogTitle>
                        <DialogDescription className="sr-only">{isTelegramView ? 'Cadastre um bot do Telegram com Evolution Channel.' : 'Escolha uma opcao para conectar WhatsApp.'}</DialogDescription>
                        <AddInstanceForm workspaceId={user.activeWorkspaceId!} onSuccess={handleSuccess} onClose={() => setIsModalOpen(false)} channelMode={channelMode} />
                    </DialogContent>
                </Dialog>
            </header>
            <main className="flex-1 overflow-y-auto bg-muted/40 p-4 sm:p-6 space-y-6">
                {loading ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        <Skeleton className="h-72" />
                        <Skeleton className="h-72" />
                    </div>
                ) : visibleInstances.length === 0 ? (
                    <div className="text-center p-10 border-dashed border-2 rounded-lg mt-8">
                        <MessageSquare className="mx-auto h-12 w-12 text-muted-foreground" />
                        <h3 className="mt-4 text-lg font-medium">{emptyTitle}</h3>
                        <p className="mt-2 text-sm text-muted-foreground">
                            {emptyDescription}
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {visibleInstances.map(instance => <InstanceCard key={instance.id} instance={instance} onMutate={fetchData} user={user} />)}
                    </div>
                )}

                {cloudApiInstances.length > 0 && user.activeWorkspaceId && (
                    <TemplateManager instances={cloudApiInstances} />
                )}

            </main>
        </div>
    );
}
