

'use client';

import React, { useState, useEffect, useCallback, useActionState, useTransition } from 'react';
import type { User, EvolutionInstance, EvolutionInstanceCreationPayload, EvolutionInstanceSettings } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Activity, CheckCircle2, Clock3, Loader2, MessageCircle, PlusCircle, Search, Server, MessageSquare, Trash2, MoreVertical, QrCode, Power, PowerOff, Settings, RefreshCw, Save, ArrowLeft, ArrowRight, Lock, Send, ShieldCheck } from 'lucide-react';
import { FaMeta, FaWhatsapp } from 'react-icons/fa6';
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
import { EvolutionWebhookPanel } from './evolution-webhook-panel';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { useCurrentUser } from '@/hooks/use-online-status';
import workspaceStyles from '@/app/team/team-page.module.css';
import whatsappStyles from '../whatsapp-api/whatsapp-api-page.module.css';

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


export function AddInstanceForm({ workspaceId, onSuccess, onClose, channelMode }: { workspaceId: string, onSuccess: (qrCode?: string, instanceId?: string) => void, onClose: () => void, channelMode: ChannelMode }) {
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
    const [reviewAdvanced, setReviewAdvanced] = useState(false);
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
        setStatusMessage('Preparando sua conexão…');

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
            toast({ title: 'Conexão criada', description: 'Seu número já tem um lugar na Dialogy.' });
            onSuccess(result.qrCode, result.instanceId);
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
                            onSuccess(undefined, creationResult.instanceId);
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
    const totalSteps = isBaileys ? (reviewAdvanced ? 3 : 1) : 2;

    const STEPS = [
        { id: 1, title: "Essencial" },
        ...(!isBaileys || reviewAdvanced ? [{ id: 2, title: isTelegram ? "Bot" : "Conexão" }] : []),
        ...(isBaileys && reviewAdvanced ? [{ id: 3, title: 'Avançado' }] : [])
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
        setReviewAdvanced(false);
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
            <div className={whatsappStyles.connectChoices}>
                <span className={workspaceStyles.eyebrow}>UM NOVO PONTO DE ENCONTRO</span>
                <h2>Como você quer se conectar?</h2>
                <p>Escolha o caminho que faz sentido para seu momento. Nós cuidamos de reunir suas conversas por aqui.</p>
                <div className={whatsappStyles.connectionOptions}>
                    <button type="button" onClick={() => startManualConnection('WHATSAPP-BAILEYS')}>
                        <QrCode size={28} strokeWidth={1.4} />
                        <strong>Pelo seu celular</strong>
                        <small>Leia um QR Code e comece a conversar. Mensagens e carrosséis sem a etapa de aprovação. Conexão não oficial.</small>
                        <span>Conectar com QR Code <ArrowRight size={14} /></span>
                    </button>
                    <button type="button" onClick={canStartMetaEmbeddedSignup ? handleMetaLogin : () => startManualConnection('WHATSAPP-BUSINESS')}>
                        <FaMeta size={31} />
                        <strong>Com uma conta oficial</strong>
                        <small>Use sua conta WhatsApp Business na Meta. Crie templates e carrosséis com aprovação oficial.</small>
                        <span>{canStartMetaEmbeddedSignup ? 'Continuar com a Meta' : 'Usar credenciais da Meta'} <ArrowRight size={14} /></span>
                    </button>
                </div>
                {canStartMetaEmbeddedSignup && <button type="button" className={whatsappStyles.connectManual} onClick={() => startManualConnection('WHATSAPP-BUSINESS')}>Já tenho as credenciais da Meta <ArrowRight size={13} /></button>}
            </div>
        );
    }

    return (
        <form onSubmit={handleSubmit}>
            <DialogHeader>
                <div className="flex items-center gap-2">
                    {!isTelegramOnly && (
                        <Button type="button" variant="ghost" size="icon" aria-label="Voltar às opções de conexão" onClick={() => setManualMode(false)} className="-ml-2"><ArrowLeft className="h-4 w-4" /></Button>
                    )}
                    <h2>{isTelegramOnly ? 'Configurar Telegram Bot' : 'Conecte seu WhatsApp'}</h2>
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

            <div className="max-h-[52vh] overflow-y-auto">
                <div className="py-4 px-1 space-y-6">
                    {step === 1 && (
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">{isTelegramOnly ? 'Configurações do Bot' : 'Um nome para o seu número'}</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="displayName">{isTelegramOnly ? 'Apelido do Bot (Obrigatório)' : 'Nome da conexão'}</Label>
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
                                            <SelectTrigger id="integrationType"><SelectValue /></SelectTrigger>
                                            <SelectContent className={workspaceStyles.surface}>
                                                <SelectItem value="WHATSAPP-BAILEYS">QR Code · não oficial</SelectItem>
                                                <SelectItem value="WHATSAPP-BUSINESS">API oficial · Meta</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    )}

                    {step === 1 && isBaileys && <div className="flex items-start gap-3 rounded-xl border bg-muted/30 p-4"><Checkbox id="review-advanced" checked={reviewAdvanced} onCheckedChange={checked => setReviewAdvanced(checked === true)} /><div><Label htmlFor="review-advanced">Revisar opções avançadas antes de conectar</Label><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Ajustes de leitura, histórico, chamadas e proxy, se você precisar.</p></div></div>}

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
            </div>
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
                        {isTelegramOnly ? 'Conectar bot' : 'Conectar número'}
                    </Button>
                )}
            </DialogFooter>
        </form >
    )
}

export function EditInstanceDialog({ instance, onSave }: { instance: EvolutionInstance, onSave: () => void }) {
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
            <DialogContent className={cn(workspaceStyles.surface, whatsappStyles.dialog)}>
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
                            {isTelegram ? <Send className="text-sky-500" /> : instance.status === 'pending' ? <Loader2 className="animate-spin text-yellow-500" /> : <FaWhatsapp className={instance.status === 'connected' ? 'text-green-500' : 'text-red-500'} />}
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

function InstanceRow({
    initialInstance,
    onMutate,
    onStatusChange,
    canManageWebhooks,
    workspaceId,
}: {
    initialInstance: Omit<EvolutionInstance, 'status' | 'qrCode'>,
    onMutate: () => void,
    onStatusChange: (instanceId: string, status: EvolutionInstance['status']) => void,
    canManageWebhooks: boolean,
    workspaceId: string,
}) {
    const { toast } = useToast();
    const [instance, setInstance] = useState<EvolutionInstance>({ ...initialInstance, status: 'disconnected' });
    const [isToggling, setIsToggling] = useState(false);
    const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);

    const checkStatus = useCallback(async () => {
        try {
            const result = await checkInstanceStatus(instance.instance_name);
            setInstance((current) => ({ ...current, ...result }));
            setLastCheckedAt(new Date());
        } catch (error) {
            console.error('[InstanceRow] Falha ao atualizar status:', error);
        }
    }, [instance.instance_name]);

    useEffect(() => {
        checkStatus();
        const intervalId = setInterval(checkStatus, instance.status === 'pending' ? 3000 : 15000);
        return () => clearInterval(intervalId);
    }, [checkStatus, instance.status]);

    useEffect(() => {
        onStatusChange(instance.id, instance.status);
    }, [instance.id, instance.status, onStatusChange]);

    const handleConnect = async () => {
        setIsToggling(true);
        try {
            const result = await connectInstance(instance.instance_name);
            setInstance((current) => ({ ...current, ...result }));
        } finally {
            setIsToggling(false);
        }
    };

    const handleDisconnect = async () => {
        setIsToggling(true);
        try {
            await disconnectInstance(instance.instance_name);
            await checkStatus();
        } finally {
            setIsToggling(false);
        }
    };

    const handleRestart = async () => {
        toast({ title: 'Reiniciando conexão', description: `A instância ${instance.display_name} será reconectada em instantes.` });
        const result = await restartInstance(instance.instance_name);
        if (result.error) {
            toast({ title: 'Erro ao reiniciar', description: result.error, variant: 'destructive' });
            return;
        }
        setTimeout(checkStatus, 3000);
    };

    const handleDelete = async () => {
        const result = await deleteEvolutionApiInstance(instance.id);
        if (result.error) {
            toast({ title: 'Erro ao excluir', description: result.error, variant: 'destructive' });
            return;
        }
        toast({ title: 'Instância excluída', description: `${instance.display_name} foi removida.` });
        onMutate();
    };

    const isTelegram = instance.type === 'telegram';
    const typeLabel = instance.type === 'wa_cloud'
        ? 'Cloud API (Oficial)'
        : isTelegram
            ? 'Telegram Bot'
            : 'Baileys (Não Oficial)';
    const numberLabel = instance.display_phone_number || instance.phone_number_id
        || (isTelegram && instance.telegram_bot_username ? `@${instance.telegram_bot_username}` : instance.instance_name);
    const secondaryNumberLabel = instance.type === 'wa_cloud'
        ? instance.waba_name || instance.waba_id || instance.verified_name || instance.business_name
        : null;
    const statusLabel = instance.status === 'connected' ? 'Conectada' : instance.status === 'pending' ? 'Pendente' : 'Desconectada';
    const statusDescription = instance.status === 'connected'
        ? isTelegram ? 'Webhook ativo' : 'Sessão WhatsApp conectada'
        : instance.status === 'pending'
            ? 'Aguardando leitura do QR Code'
            : isTelegram ? 'Webhook pausado' : 'Conexão indisponível';
    const lastCheckedLabel = lastCheckedAt
        ? lastCheckedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        : 'Verificando...';

    return (
        <div className="border-b last:border-b-0">
            <div className="grid min-h-[88px] grid-cols-1 items-center gap-3 px-5 py-4 md:grid-cols-[1.25fr_1fr_1.15fr_.9fr_1fr_auto] md:gap-5 md:px-6">
                <div className="flex min-w-0 items-center gap-3">
                    <div className={cn(
                        'flex h-10 w-10 shrink-0 items-center justify-center rounded-full border',
                        instance.status === 'connected' && 'border-emerald-200 bg-emerald-50 text-emerald-700',
                        instance.status === 'pending' && 'border-amber-200 bg-amber-50 text-amber-700',
                        instance.status === 'disconnected' && 'border-red-200 bg-red-50 text-red-600',
                    )}>
                        {isTelegram ? <Send className="h-5 w-5" /> : instance.status === 'pending' ? <Loader2 className="h-5 w-5 animate-spin" /> : <FaWhatsapp className="h-5 w-5" />}
                    </div>
                    <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">{instance.display_name}</p>
                        <p className="truncate text-xs text-muted-foreground">{instance.instance_name}</p>
                    </div>
                </div>

                <div>
                    <Badge variant="secondary" className={cn('gap-1.5 border font-medium', instance.type === 'wa_cloud' && 'border-emerald-200 bg-emerald-50 text-emerald-700')}>
                        {instance.type === 'wa_cloud' && <FaMeta aria-hidden="true" className="h-3.5 w-3.5 text-[#0866ff]" />}
                        {typeLabel}
                    </Badge>
                </div>

                <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{numberLabel}</p>
                    {secondaryNumberLabel && <p className="truncate text-xs text-muted-foreground">{secondaryNumberLabel}</p>}
                </div>

                <div>
                    <div className={cn(
                        'flex items-center gap-2 text-sm font-medium',
                        instance.status === 'connected' && 'text-emerald-700',
                        instance.status === 'pending' && 'text-amber-700',
                        instance.status === 'disconnected' && 'text-red-600',
                    )}>
                        <span className={cn('h-2 w-2 shrink-0 rounded-full', instance.status === 'connected' ? 'bg-emerald-500' : instance.status === 'pending' ? 'bg-amber-500' : 'bg-red-500')} />
                        {statusLabel}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{statusDescription}</p>
                </div>

                <div>
                    <p className="text-sm font-medium">{lastCheckedLabel}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Status atualizado</p>
                </div>

                <div className="flex items-center justify-end gap-2">
                    {instance.status !== 'connected' ? (
                        <Button size="sm" onClick={handleConnect} disabled={isToggling || instance.status === 'pending'}>
                            {isToggling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Power className="mr-2 h-4 w-4" />}
                            {isTelegram ? 'Ativar' : 'Conectar'}
                        </Button>
                    ) : (
                        <Button size="sm" variant="outline" onClick={checkStatus}>
                            <RefreshCw className="mr-2 h-4 w-4" /> Atualizar
                        </Button>
                    )}

                    <AlertDialog>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" size="icon" aria-label={`Ações de ${instance.display_name}`}><MoreVertical className="h-4 w-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                {instance.type === 'baileys' && <EditInstanceDialog instance={instance} onSave={onMutate} />}
                                {instance.status === 'connected' && (
                                    <>
                                        <DropdownMenuItem onClick={handleRestart}><RefreshCw className="mr-2 h-4 w-4" />Reiniciar conexão</DropdownMenuItem>
                                        <DropdownMenuItem onClick={handleDisconnect}><PowerOff className="mr-2 h-4 w-4" />{isTelegram ? 'Pausar webhook' : 'Desconectar'}</DropdownMenuItem>
                                    </>
                                )}
                                <DropdownMenuSeparator />
                                <AlertDialogTrigger asChild>
                                    <DropdownMenuItem className="w-full justify-start text-destructive hover:text-destructive" onSelect={(event) => event.preventDefault()}>
                                        <Trash2 className="mr-2 h-4 w-4" />Excluir
                                    </DropdownMenuItem>
                                </AlertDialogTrigger>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Excluir instância?</AlertDialogTitle>
                                <AlertDialogDescription>Esta ação é irreversível e removerá permanentemente a instância <span className="font-bold">{instance.display_name}</span>.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                <AlertDialogAction onClick={handleDelete}>Excluir</AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </div>
            </div>

            {!isTelegram && canManageWebhooks && (
                <EvolutionWebhookPanel instance={initialInstance} workspaceId={workspaceId} />
            )}

            {instance.status === 'pending' && instance.qrCode && !isTelegram && (
                <div className="flex items-center gap-5 border-t bg-muted/30 px-6 py-4">
                    <Image src={instance.qrCode} alt="QR Code para conectar o WhatsApp" width={112} height={112} />
                    <div>
                        <p className="font-semibold">Escaneie o QR Code</p>
                        <p className="mt-1 max-w-md text-sm text-muted-foreground">Abra o WhatsApp no celular, acesse Aparelhos conectados e escaneie o código para concluir.</p>
                    </div>
                </div>
            )}
        </div>
    );
}

export default function EvolutionApiPage({ channelMode = 'whatsapp' }: { channelMode?: ChannelMode }) {
    const { toast } = useToast();
    const user = useCurrentUser();
    const [instances, setInstances] = useState<Omit<EvolutionInstance, 'status' | 'qrCode'>[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [initialQrCode, setInitialQrCode] = useState<string | undefined>();
    const [limitStatus, setLimitStatus] = useState<{ reached: boolean, current: number, max: number, plan: string } | null>(null);
    const [instanceSearch, setInstanceSearch] = useState('');
    const [instanceStatuses, setInstanceStatuses] = useState<Record<string, EvolutionInstance['status']>>({});
    const [canManageWebhooks, setCanManageWebhooks] = useState(false);
    const isTelegramView = channelMode === 'telegram';

    const handleStatusChange = useCallback((instanceId: string, status: EvolutionInstance['status']) => {
        setInstanceStatuses((current) => current[instanceId] === status ? current : { ...current, [instanceId]: status });
    }, []);

    const fetchData = useCallback(async () => {
        if (!user?.activeWorkspaceId) return;
        setLoading(true);
        try {
            const result = await getEvolutionApiInstances(user.activeWorkspaceId);
            setCanManageWebhooks(result.canManageWebhooks === true);
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
    const filteredInstances = visibleInstances.filter((instance) => {
        const query = instanceSearch.trim().toLowerCase();
        if (!query) return true;
        return [instance.display_name, instance.instance_name, instance.display_phone_number, instance.verified_name]
            .filter(Boolean)
            .some((value) => value!.toLowerCase().includes(query));
    });
    const cloudApiInstances = visibleInstances.filter((instance) => instance.type === 'wa_cloud');
    const connectedCount = visibleInstances.filter((instance) => instanceStatuses[instance.id] === 'connected').length;
    const disconnectedCount = Math.max(visibleInstances.length - connectedCount, 0);
    const healthPercentage = visibleInstances.length > 0 ? Math.round((connectedCount / visibleInstances.length) * 100) : 0;
    const pageTitle = isTelegramView ? 'Telegram Bot' : 'WhatsApp';
    const pageDescription = isTelegramView
        ? 'Gerencie bots do Telegram com webhook automatico e inbox dedicado.'
        : 'Conecte e gerencie suas instâncias de WhatsApp e templates de mensagem.';
    const primaryActionLabel = isTelegramView ? 'Adicionar Bot' : 'Conectar número';
    const emptyTitle = isTelegramView ? 'Nenhum bot conectado' : 'Nenhuma instancia criada';
    const emptyDescription = isTelegramView
        ? 'Clique em "Adicionar Bot" para conectar seu primeiro bot do Telegram.'
        : 'Clique em "Criar Instancia" para conectar seu primeiro canal.';

    return (
        <div className="flex flex-col flex-1 h-full">
            <header className="flex flex-shrink-0 items-center justify-between border-b bg-background px-5 py-5 sm:px-7">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight sm:text-[28px]">{pageTitle}</h1>
                    <p className="mt-1 text-sm text-muted-foreground sm:text-base">{pageDescription}</p>
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
                            <Button className="h-10 px-4 font-semibold shadow-sm">
                                <PlusCircle className="mr-2 h-4 w-4" />
                                {primaryActionLabel}
                            </Button>
                        </DialogTrigger>
                    )}
                    <DialogContent className="max-w-3xl">
                        <DialogTitle className="sr-only">{isTelegramView ? 'Adicionar bot Telegram' : 'Conectar novo número'}</DialogTitle>
                        <DialogDescription className="sr-only">{isTelegramView ? 'Cadastre um bot do Telegram com Evolution Channel.' : 'Escolha a melhor forma de conectar seu WhatsApp.'}</DialogDescription>
                        <AddInstanceForm workspaceId={user.activeWorkspaceId!} onSuccess={handleSuccess} onClose={() => setIsModalOpen(false)} channelMode={channelMode} />
                    </DialogContent>
                </Dialog>
            </header>
            <main className="flex-1 space-y-5 overflow-y-auto bg-[#f8fafc] p-4 sm:p-6">
                {!isTelegramView && (
                    <section aria-label="Resumo das conexões" className="grid grid-cols-2 overflow-hidden rounded-xl border bg-background lg:grid-cols-5">
                        {[
                            { label: 'Conectadas', value: connectedCount, detail: `de ${visibleInstances.length}`, icon: MessageCircle, tone: 'text-emerald-700 bg-emerald-50 border-emerald-100' },
                            { label: 'Desconectadas', value: disconnectedCount, detail: `de ${visibleInstances.length}`, icon: PowerOff, tone: 'text-slate-600 bg-slate-50 border-slate-200' },
                            { label: 'Saúde geral', value: `${healthPercentage}%`, detail: visibleInstances.length ? 'das instâncias' : 'sem instâncias', icon: CheckCircle2, tone: 'text-emerald-700 bg-emerald-50 border-emerald-100' },
                            { label: 'Sincronizadas', value: connectedCount, detail: 'nas últimas 24h', icon: Activity, tone: 'text-slate-600 bg-slate-50 border-slate-200' },
                            { label: 'Última atualização', value: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }), detail: 'Atualizado agora', icon: Clock3, tone: 'text-slate-600 bg-slate-50 border-slate-200' },
                        ].map((stat) => (
                            <div key={stat.label} className="flex min-h-[104px] items-center gap-3 border-b border-r p-4 last:border-r-0 lg:border-b-0">
                                <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-full border', stat.tone)}>
                                    <stat.icon className="h-5 w-5" />
                                </div>
                                <div className="min-w-0">
                                    <p className="truncate text-xs font-medium text-muted-foreground">{stat.label}</p>
                                    <p className="mt-0.5 text-xl font-semibold tracking-tight text-foreground">{stat.value}</p>
                                    <p className="truncate text-xs text-muted-foreground">{stat.detail}</p>
                                </div>
                            </div>
                        ))}
                    </section>
                )}

                <section className="overflow-hidden rounded-xl border bg-background">
                    <div className="flex flex-col gap-4 border-b px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                        <div>
                            <h2 className="text-base font-semibold">{isTelegramView ? 'Seus bots' : 'Suas instâncias'}</h2>
                            <p className="mt-1 text-sm text-muted-foreground">Monitore o status de conexão e gerencie seus canais.</p>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="relative min-w-0 flex-1 sm:w-72 sm:flex-none">
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                    value={instanceSearch}
                                    onChange={(event) => setInstanceSearch(event.target.value)}
                                    placeholder={isTelegramView ? 'Buscar bot...' : 'Buscar instância...'}
                                    className="h-10 pl-9"
                                    aria-label={isTelegramView ? 'Buscar bot' : 'Buscar instância'}
                                />
                            </div>
                            <Button variant="outline" onClick={fetchData} disabled={loading} className="h-10">
                                <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} /> Atualizar
                            </Button>
                        </div>
                    </div>

                    <div className="hidden grid-cols-[1.25fr_1fr_1.15fr_.9fr_1fr_auto] gap-5 border-b bg-muted/20 px-6 py-3 text-xs font-medium text-muted-foreground md:grid">
                        <span>Nome da instância</span>
                        <span>Tipo de conexão</span>
                        <span>Número</span>
                        <span>Status</span>
                        <span>Última verificação</span>
                        <span className="pr-12 text-right">Ações</span>
                    </div>

                    {loading ? (
                        <div className="space-y-1 p-4">
                            <Skeleton className="h-20 w-full" />
                            <Skeleton className="h-20 w-full" />
                        </div>
                    ) : visibleInstances.length === 0 ? (
                        <div className="px-6 py-12 text-center">
                            <MessageSquare className="mx-auto h-10 w-10 text-muted-foreground" />
                            <h3 className="mt-4 text-base font-semibold">{emptyTitle}</h3>
                            <p className="mt-2 text-sm text-muted-foreground">{emptyDescription}</p>
                            <Button className="mt-5" onClick={() => setIsModalOpen(true)}><PlusCircle className="mr-2 h-4 w-4" />{primaryActionLabel}</Button>
                        </div>
                    ) : filteredInstances.length === 0 ? (
                        <div className="px-6 py-10 text-center text-sm text-muted-foreground">Nenhuma instância corresponde à sua busca.</div>
                    ) : (
                        filteredInstances.map((instance) => (
                            <InstanceRow key={instance.id} initialInstance={instance} onMutate={fetchData} onStatusChange={handleStatusChange} canManageWebhooks={canManageWebhooks} workspaceId={user.activeWorkspaceId!} />
                        ))
                    )}
                </section>

                {cloudApiInstances.length > 0 && user.activeWorkspaceId && (
                    <TemplateManager instances={cloudApiInstances} />
                )}
            </main>
        </div>
    );
}
