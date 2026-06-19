'use client';

import React, { useMemo, useState, useEffect, useCallback } from "react";
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { getContacts } from '@/actions/crm';
import { findWhatsappTemplates, getEvolutionApiInstances } from '@/actions/evolution-api';
import { getTelegramInstances as fetchTelegramInstances } from '@/actions/telegram';
import { listMetaChannels as fetchMetaChannels } from '@/actions/meta-channels';
import { createCampaign } from '@/actions/campaigns';
import type { CampaignChannel, CampaignTemplate, Contact as ContactType, EvolutionInstance, MetaChannel, TelegramBotInstance, User } from '@/lib/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// ---------------------------------------------------------
// Constantes e utilitários
// ---------------------------------------------------------
const PLACEHOLDER = "{{nome}}";
const CHANNEL_OPTIONS: Array<{ value: CampaignChannel; label: string; shortLabel: string }> = [
  { value: 'whatsapp_baileys', label: 'WhatsApp conectado', shortLabel: 'WA' },
  { value: 'whatsapp_cloud', label: 'WhatsApp Cloud API', shortLabel: 'WA' },
  { value: 'telegram', label: 'Telegram', shortLabel: 'TG' },
  { value: 'messenger', label: 'Messenger (Facebook)', shortLabel: 'FB' },
  { value: 'instagram', label: 'Instagram Direct', shortLabel: 'IG' },
];

type WhatsappTemplateOption = CampaignTemplate & {
  id?: string;
  status?: string;
  category?: string;
};

type CampaignDestination = {
  id: string;
  label: string;
};

async function loadCampaignChannels(workspaceId: string) {
  const [whatsappRes, telegramRes, messengerChannels, instagramChannels] = await Promise.all([
    getEvolutionApiInstances(workspaceId),
    fetchTelegramInstances(workspaceId),
    fetchMetaChannels(workspaceId, 'messenger'),
    fetchMetaChannels(workspaceId, 'instagram'),
  ]);

  return {
    whatsappRes,
    telegramRes,
    activeMetaChannels: [...messengerChannels, ...instagramChannels].filter(channel => channel.status === 'active'),
  };
}

function templatePreview(template: WhatsappTemplateOption | null) {
  const body = template?.components?.find((component: any) => component.type?.toUpperCase() === 'BODY');
  return (body?.text || (template ? `[Template: ${template.name}]` : '')).replace(/\{\{\d+\}\}/g, PLACEHOLDER);
}

function applyPlaceholder(msg: string, value: string) {
  if (!msg) return "";
  return msg.split(PLACEHOLDER).join(value);
}

// ---------------------------------------------------------
// Ícones inline
// ---------------------------------------------------------
const Icon = {
  Users: (props: any) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  FileUp: (props: any) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M12 12v6" />
      <path d="m15 15-3-3-3 3" />
    </svg>
  ),
  Search: (props: any) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  ),
  ChevronDown: (props: any) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  ),
  ArrowLeft: (props: any) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  ),
  Send: (props: any) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" />
      <path d="m21.854 2.147-10.94 10.939" />
    </svg>
  ),
  Sparkles: (props: any) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M5 3v4M3 5h4" />
      <path d="M19 17v4M17 19h4" />
      <path d="M11 11l2 2-2 2-2-2 2-2z" />
    </svg>
  ),
  Check: (props: any) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  ),
  Upload: (props: any) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5-5 5 5" />
      <path d="M12 15V3" />
    </svg>
  ),
  Loader2: (props: any) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
  )
};

function cx(...classes: any[]) {
  return classes.filter(Boolean).join(" ");
}

// ---------------------------------------------------------
// Componentes básicos
// ---------------------------------------------------------
function Card({ className, children }: { className?: string, children: React.ReactNode }) {
  return <div className={cx("rounded-xl border bg-card text-card-foreground shadow-sm", className)}>{children}</div>;
}
function CardHeader({ className, children }: { className?: string, children: React.ReactNode }) {
  return <div className={cx("flex flex-col space-y-1.5 p-6", className)}>{children}</div>;
}
function CardContent({ className, children }: { className?: string, children: React.ReactNode }) {
  return <div className={cx("p-6 pt-0", className)}>{children}</div>;
}
function Button({ className, children, variant = "default", disabled, ...props }: { className?: string, children: React.ReactNode, variant?: 'default' | 'secondary' | 'ghost', disabled?: boolean, [key: string]: any }) {
  const base = "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 h-10 px-4 py-2";
  const map: Record<string, string> = {
    default: "bg-primary text-primary-foreground hover:bg-primary/90",
    secondary: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
    ghost: "hover:bg-accent/60",
  };
  return (
    <button className={cx(base, map[variant], className)} disabled={disabled} {...props}>
      {children}
    </button>
  );
}

function Textarea({ id, value, onChange, placeholder }: { id: string, value: string, onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void, placeholder: string }) {
  return (
    <textarea
      id={id}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      rows={6}
      className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 min-h-[120px]"
    />
  );
}

function Input({ id, value, onChange, placeholder, className, ...props }: { id?: string, value: string, onChange: (e: React.ChangeEvent<HTMLInputElement>) => void, placeholder: string, className?: string }) {
  return (
    <input
      id={id}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      {...props}
      className={cx(
        "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
    />
  );
}

// Avatar com iniciais
function Avatar({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground/80">
      {initials}
    </div>
  );
}

const TEMPLATES = [
  { id: "promo", label: "Promo relâmpago", text: `Olá ${PLACEHOLDER}! ⚡️ Só hoje temos 20% OFF em toda a loja. Responda *SIM* para receber o cupom.` },
  { id: "boasvindas", label: "Boas-vindas", text: `Oi ${PLACEHOLDER} 👋 Bem-vindo(a)! Eu sou do time de atendimento. Posso te ajudar em algo agora?` },
  { id: "cobranca", label: "Cobrança amigável", text: `Olá ${PLACEHOLDER}, tudo bem? Notamos um pagamento pendente. Precisa de ajuda para concluir?` },
];


// ---------------------------------------------------------
// Página principal
// ---------------------------------------------------------
export default function NewCampaignPageClient({ user }: { user: User | null }) {
  const router = useRouter();
  const { toast } = useToast();

  const [tab, setTab] = useState("crm");
  const [message, setMessage] = useState("");
  const [deliveryChannel, setDeliveryChannel] = useState<CampaignChannel>('whatsapp_baileys');
  const [destinationId, setDestinationId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const maxChars = 1000;

  // Data states
  const [crmContacts, setCrmContacts] = useState<ContactType[]>([]);
  const [visibleCrmContacts, setVisibleCrmContacts] = useState<ContactType[]>([]);
  const [csvContacts, setCsvContacts] = useState<ContactType[]>([]);
  const [instances, setInstances] = useState<Omit<EvolutionInstance, 'status' | 'qrCode'>[]>([]);
  const [telegramInstances, setTelegramInstances] = useState<Omit<TelegramBotInstance, 'status'>[]>([]);
  const [metaChannels, setMetaChannels] = useState<MetaChannel[]>([]);
  const [whatsappTemplates, setWhatsappTemplates] = useState<WhatsappTemplateOption[]>([]);
  const [selectedTemplateName, setSelectedTemplateName] = useState<string | null>(null);

  // Loading states
  const [loadingCrm, setLoadingCrm] = useState(true);
  const [loadingInstances, setLoadingInstances] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [selectedCrmIds, setSelectedCrmIds] = useState<Set<string>>(() => new Set<string>());

  // Fetch initial data
  useEffect(() => {
    if (!user?.activeWorkspaceId) return;

    setLoadingInstances(true);
    loadCampaignChannels(user.activeWorkspaceId)
      .then(({ whatsappRes, telegramRes, activeMetaChannels }) => {
        if (whatsappRes.error) {
          toast({ title: 'Erro ao carregar inst\u00e2ncias', description: whatsappRes.error, variant: 'destructive' });
        }
        if (telegramRes.error) {
          toast({ title: 'Erro ao carregar Telegram', description: telegramRes.error, variant: 'destructive' });
        }
        setInstances(whatsappRes.instances || []);
        setTelegramInstances(telegramRes.instances || []);
        setMetaChannels(activeMetaChannels);
      })
      .catch((error) => {
        console.error('[NEW_CAMPAIGN] Falha ao buscar canais', error);
        toast({ title: 'Erro ao carregar canais', description: 'N\u00e3o foi poss\u00edvel buscar os canais conectados.', variant: 'destructive' });
      })
      .finally(() => setLoadingInstances(false));

  }, [user?.activeWorkspaceId, toast]);

  useEffect(() => {
    if (!user?.activeWorkspaceId) return;

    let ignored = false;
    const timeoutId = window.setTimeout(() => {
      setLoadingCrm(true);
      getContacts(user.activeWorkspaceId!, { search: query.trim() || undefined, limit: 50 })
        .then(res => {
          if (ignored) return;
          const results = res.contacts || [];
          setVisibleCrmContacts(results);
          setCrmContacts(prev => {
            const contactsById = new Map(prev.map(contact => [contact.id, contact]));
            results.forEach(contact => contactsById.set(contact.id, contact));
            return [...contactsById.values()];
          });
          if (res.error) {
            toast({ title: 'Erro ao buscar contatos', description: res.error, variant: 'destructive' });
          }
        })
        .catch((error) => {
          if (ignored) return;
          console.error('[NEW_CAMPAIGN] Falha ao pesquisar contatos', error);
          toast({ title: 'Erro ao buscar contatos', description: 'Não foi possível pesquisar os contatos.', variant: 'destructive' });
        })
        .finally(() => {
          if (!ignored) setLoadingCrm(false);
        });
    }, 250);

    return () => {
      ignored = true;
      window.clearTimeout(timeoutId);
    };
  }, [query, toast, user?.activeWorkspaceId]);

  const channelDestinations = useMemo<CampaignDestination[]>(() => {
    if (deliveryChannel === 'whatsapp_baileys') {
      return instances.filter(instance => instance.type === 'baileys').map(instance => ({ id: instance.instance_name, label: instance.display_name || instance.instance_name }));
    }
    if (deliveryChannel === 'whatsapp_cloud') {
      return instances.filter(instance => instance.type === 'wa_cloud').map(instance => ({ id: instance.instance_name, label: instance.display_name || instance.instance_name }));
    }
    if (deliveryChannel === 'telegram') {
      return telegramInstances.map(instance => ({ id: instance.instance_name, label: instance.display_name || instance.instance_name }));
    }
    return metaChannels
      .filter(channel => channel.type === deliveryChannel)
      .map(channel => ({ id: channel.id, label: channel.name || channel.external_page_id || channel.id }));
  }, [deliveryChannel, instances, metaChannels, telegramInstances]);

  const selectedTemplate = whatsappTemplates.find(template => template.name === selectedTemplateName) || null;
  const campaignMessage = deliveryChannel === 'whatsapp_cloud' ? templatePreview(selectedTemplate) : message;
  const preview = useMemo(() => {
    const channel = CHANNEL_OPTIONS.find(option => option.value === deliveryChannel) ?? CHANNEL_OPTIONS[0];
    const destinationLabel = channelDestinations.find(destination => destination.id === destinationId)?.label || channel.label;

    return {
      channel,
      destinationLabel,
      message: campaignMessage,
    };
  }, [campaignMessage, channelDestinations, deliveryChannel, destinationId]);

  useEffect(() => {
    setDestinationId(null);
    setSelectedTemplateName(null);
    setWhatsappTemplates([]);
    if (deliveryChannel !== 'whatsapp_baileys' && deliveryChannel !== 'whatsapp_cloud') {
      setTab('crm');
      setCsvContacts([]);
    }
  }, [deliveryChannel]);

  useEffect(() => {
    if (deliveryChannel !== 'whatsapp_cloud' || !destinationId) {
      setWhatsappTemplates([]);
      setSelectedTemplateName(null);
      return;
    }

    findWhatsappTemplates(destinationId).then(result => {
      if (result.error) {
        toast({ title: 'Erro ao carregar templates', description: result.error, variant: 'destructive' });
        setWhatsappTemplates([]);
        return;
      }
      setWhatsappTemplates(
        (result.templates || []).filter((template: WhatsappTemplateOption) => template.status === 'APPROVED')
      );
    });
  }, [deliveryChannel, destinationId, toast]);


  const filteredCrmContacts = visibleCrmContacts;

  const selectedCount = selectedCrmIds.size + csvContacts.length;
  const canProceed = Boolean(campaignMessage.trim() && destinationId && selectedCount > 0 && (deliveryChannel !== 'whatsapp_cloud' || selectedTemplate));

  function toggleSelect(id: string) {
    setSelectedCrmIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedCrmIds((prev) => {
      const next = new Set(prev);
      const allVisibleSelected = filteredCrmContacts.length > 0 && filteredCrmContacts.every(contact => next.has(contact.id));
      filteredCrmContacts.forEach(contact => {
        if (allVisibleSelected) {
          next.delete(contact.id);
        } else {
          next.add(contact.id);
        }
      });
      return next;
    });
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    // For now, we just add a fake contact to show it works
    // In a real app, you would parse the CSV here.
    const newItem = { id: `csv-${Date.now()}`, name: file.name.replace(/\.[^.]+$/, ""), phone_number_jid: `55${Math.floor(Math.random() * 999999999)}@s.whatsapp.net` } as ContactType;
    setCsvContacts((prev) => [...prev, newItem]);
    setTab('csv');
  }

  async function handleSendCampaign() {
    if (!user?.activeWorkspaceId || !destinationId || !campaignMessage || selectedCount === 0) {
      toast({ title: 'Dados Incompletos', description: 'Selecione o canal, a conta de envio e pelo menos um contato.', variant: 'destructive' });
      return;
    };
    setIsSubmitting(true);

    const selectedFromCrm = crmContacts
      .filter((c) => selectedCrmIds.has(c.id))
      .map((c) => ({ id: `crm-${c.id}`, name: c.name, phone_number_jid: c.phone_number_jid }));

    const allContactsToSend = [...selectedFromCrm, ...csvContacts.map(c => ({ ...c, id: `csv-${c.id}` }))];

    const result = await createCampaign(user.activeWorkspaceId, {
      channel: deliveryChannel,
      instanceName: deliveryChannel === 'messenger' || deliveryChannel === 'instagram' ? undefined : destinationId,
      metaChannelId: deliveryChannel === 'messenger' || deliveryChannel === 'instagram' ? destinationId : undefined,
      template: selectedTemplate,
    }, campaignMessage, allContactsToSend);

    if (result.error) {
      toast({ title: 'Erro ao criar campanha', description: result.error, variant: 'destructive' });
    } else {
      toast({ title: 'Campanha criada e em andamento!', description: 'O envio foi iniciado em segundo plano. Você será redirecionado.' });
      router.push('/campaigns');
    }
    setIsSubmitting(false);
  }

  const remaining = maxChars - message.length;
  const remainingClass = remaining < 0 ? "text-red-600" : remaining < 50 ? "text-amber-600" : "text-muted-foreground";

  // Se não houver usuário, mostramos loading, mas isso não deve acontecer devido ao redirect no server component
  // No entanto, para evitar erro de hooks, NÃO retornamos antes dos hooks.
  // Os hooks já foram chamados acima.

  if (!user) {
    return (
      <div className="flex items-center justify-center h-full">
        <Icon.Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="flex min-h-dvh shrink-0 flex-col bg-muted/50">
      {/* Header com gradiente e stepper */}
      <header className="border-b bg-background/70 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-5 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Nova Campanha</h1>
            <p className="text-sm text-muted-foreground">Defina a mensagem e o público em um único lugar.</p>
          </div>
          <ol className="hidden sm:flex items-center gap-2 text-sm">
            <li className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">1</span><span>Mensagem</span></li>
            <span className="h-px w-8 bg-border" />
            <li className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-foreground/70 text-xs">2</span><span>Público</span></li>
            <span className="h-px w-8 bg-border" />
            <li className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-foreground/70 text-xs">3</span><span>Revisão</span></li>
          </ol>
        </div>
      </header>

      {/* Conteúdo */}
      <main className="flex-1 px-4 sm:px-6 py-6">
        <div className="mx-auto max-w-6xl grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Coluna esquerda (form) */}
          <div className="lg:col-span-2 space-y-6">
            {/* Seção 1: Mensagem e canal */}
            <Card>
              <CardHeader>
                <h3 className="text-2xl font-semibold leading-none tracking-tight">1. Mensagem e Canal</h3>
                <p className="text-sm text-muted-foreground">Escolha o canal conectado e defina o conteúdo da campanha.</p>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 mb-6">
                  <label htmlFor="channel" className="text-sm font-medium leading-none">Canal de envio</label>
                  <Select onValueChange={(value) => setDeliveryChannel(value as CampaignChannel)} value={deliveryChannel}>
                    <SelectTrigger id="channel">
                      <SelectValue placeholder="Selecione o canal" />
                    </SelectTrigger>
                    <SelectContent>
                      {CHANNEL_OPTIONS.map((channel) => (
                        <SelectItem key={channel.value} value={channel.value}>{channel.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {deliveryChannel !== 'whatsapp_cloud' && (
                <div className="space-y-2">
                  <label htmlFor="message" className="text-sm font-medium leading-none">Mensagem da Campanha</label>
                  <Textarea
                    id="message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder={`Digite sua mensagem aqui... Use ${PLACEHOLDER} para personalizar com o nome do contato.`}
                  />
                  <div className="flex items-center justify-between text-xs">
                    <p className="text-muted-foreground">A variável <code className="rounded bg-muted px-1">{PLACEHOLDER}</code> será substituída.</p>
                    <span className={cx("tabular-nums", remainingClass)}>{remaining}</span>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-2">
                    {TEMPLATES.map((t) => (
                      <Button key={t.id} type="button" variant="secondary" onClick={() => setMessage(t.text)}>
                        <Icon.Sparkles className="h-4 w-4" /> {t.label}
                      </Button>
                    ))}
                  </div>
                </div>
                )}
                <div className="space-y-2 mt-6">
                  <label htmlFor="instance" className="text-sm font-medium leading-none">Conta de envio</label>
                  <Select onValueChange={setDestinationId} value={destinationId || undefined}>
                    <SelectTrigger id="instance">
                      <SelectValue placeholder="Selecione uma conta conectada" />
                    </SelectTrigger>
                    <SelectContent>
                      {loadingInstances ? <div className="p-4 text-center text-sm">Carregando...</div> :
                        channelDestinations.map((destination) => (
                          <SelectItem key={destination.id} value={destination.id}>{destination.label}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                {deliveryChannel === 'whatsapp_cloud' && destinationId && (
                  <div className="space-y-2 mt-6">
                    <label htmlFor="template" className="text-sm font-medium leading-none">Template aprovado da Meta</label>
                    <Select onValueChange={setSelectedTemplateName} value={selectedTemplateName || undefined}>
                      <SelectTrigger id="template">
                        <SelectValue placeholder="Selecione o template para o disparo" />
                      </SelectTrigger>
                      <SelectContent>
                        {whatsappTemplates.length === 0 ? (
                          <div className="p-4 text-center text-sm text-muted-foreground">Nenhum template aprovado encontrado.</div>
                        ) : whatsappTemplates.map((template) => (
                          <SelectItem key={template.name} value={template.name}>
                            {template.name} ({template.language})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">No WhatsApp Cloud, campanhas usam o template aprovado selecionado acima.</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Seção 2: Público */}
            <Card>
              <CardHeader>
                <h3 className="text-2xl font-semibold leading-none tracking-tight">2. Público</h3>
                <p className="text-sm text-muted-foreground">Selecione os contatos que receberão esta campanha.</p>
              </CardHeader>
              <CardContent>
                {(deliveryChannel === 'messenger' || deliveryChannel === 'instagram') && (
                  <p className="mb-4 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                    Apenas contatos que já possuem conversa neste canal Meta poderão receber a campanha.
                  </p>
                )}
                {deliveryChannel === 'telegram' && (
                  <p className="mb-4 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                    Apenas contatos que já iniciaram conversa com o bot Telegram poderão receber a campanha.
                  </p>
                )}
                <div className="w-full">
                  <div role="tablist" aria-orientation="horizontal" className="grid w-full grid-cols-2 h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground">
                    <button
                      role="tab"
                      aria-selected={tab === "crm"}
                      className={cx(
                        "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium transition-all",
                        tab === "crm" ? "bg-background text-foreground shadow-sm" : ""
                      )}
                      onClick={() => setTab("crm")}
                    >
                      <Icon.Users className="mr-2 h-4 w-4" /> Selecionar do CRM ({selectedCrmIds.size})
                    </button>
                    <button
                      role="tab"
                      aria-selected={tab === "csv"}
                      disabled={!deliveryChannel.startsWith('whatsapp')}
                      className={cx(
                        "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50",
                        tab === "csv" ? "bg-background text-foreground shadow-sm" : ""
                      )}
                      onClick={() => deliveryChannel.startsWith('whatsapp') && setTab("csv")}
                    >
                      <Icon.FileUp className="mr-2 h-4 w-4" /> Importar Arquivo ({csvContacts.length})
                    </button>
                  </div>

                  {tab === "crm" && (
                    <div className="mt-4 space-y-3">
                      <div className="relative">
                        <Icon.Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                          aria-label="Buscar contato"
                          placeholder="Buscar contato..."
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          className="pl-8"
                        />
                      </div>
                      <div className="flex items-center gap-3 p-2 border-b">
                        <input
                          id="select-all"
                          type="checkbox"
                          checked={filteredCrmContacts.length > 0 && filteredCrmContacts.every(contact => selectedCrmIds.has(contact.id))}
                          onChange={toggleSelectAll}
                          className="h-4 w-4 rounded border-primary"
                        />
                        <label htmlFor="select-all" className="text-sm font-medium">Selecionar todos</label>
                        <div className="ml-auto text-xs text-muted-foreground">{filteredCrmContacts.length} contato(s) exibido(s)</div>
                      </div>

                      <div className="relative overflow-hidden h-64 rounded-md border">
                        <div className="h-full w-full overflow-y-auto">
                          {loadingCrm ? <div className="flex h-full items-center justify-center"><Icon.Loader2 className="h-6 w-6 animate-spin" /></div> :
                            filteredCrmContacts.length === 0 ? (
                              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Nenhum contato encontrado.</div>
                            ) : (
                              <ul className="divide-y">
                                {filteredCrmContacts.map((c) => (
                                  <li key={c.id} className="flex items-center gap-3 p-2 hover:bg-accent/60">
                                    <input
                                      type="checkbox"
                                      checked={selectedCrmIds.has(c.id)}
                                      onChange={() => toggleSelect(c.id)}
                                      className="h-4 w-4 rounded border-primary"
                                      aria-label={`Selecionar ${c.name}`}
                                    />
                                    <Avatar name={c.name} />
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-medium truncate">{c.name}</p>
                                      <p className="text-xs text-muted-foreground truncate">{c.phone_number_jid}</p>
                                    </div>
                                    {selectedCrmIds.has(c.id) && <Icon.Check className="h-4 w-4 text-primary" />}
                                  </li>
                                ))}
                              </ul>
                            )}
                        </div>
                      </div>
                    </div>
                  )}

                  {tab === "csv" && deliveryChannel.startsWith('whatsapp') && (
                    <div className="mt-4">
                      <div
                        onDragOver={(e) => {
                          e.preventDefault();
                          setDragActive(true);
                        }}
                        onDragLeave={() => setDragActive(false)}
                        onDrop={handleDrop}
                        className={cx(
                          "relative overflow-hidden flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl p-8 text-center",
                          dragActive ? "border-primary bg-primary/5" : "border-border"
                        )}
                        role="region"
                        aria-label="Área para soltar arquivo CSV"
                      >
                        <Icon.Upload className="h-6 w-6" />
                        <p className="text-sm">Arraste e solte seu arquivo CSV aqui</p>
                        <p className="text-xs text-muted-foreground">Ou clique para selecionar</p>
                        <input
                          type="file"
                          accept=".csv"
                          aria-label="Selecionar arquivo CSV"
                          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                        />
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">Após importar, detectaremos as colunas <code>nome</code> e <code>telefone</code>.</p>
                      {csvContacts.length > 0 &&
                        <div className="mt-2 text-xs text-green-600 font-medium">{csvContacts.length} contatos importados do arquivo.</div>
                      }
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Coluna direita (pré-visualização) */}
          <div className="lg:col-span-1">
            <Card className="sticky top-6">
              <CardHeader>
                <h3 className="text-xl font-semibold">Pré-visualização</h3>
                <p className="text-sm text-muted-foreground">Veja o conteúdo que será enviado no canal selecionado.</p>
              </CardHeader>
              <CardContent>
                <div className="mx-auto w-full max-w-sm rounded-2xl border bg-background p-4">
                  <div className="flex items-center gap-3 pb-3 border-b">
                    <div className="h-9 w-9 rounded-full bg-emerald-500/15 flex items-center justify-center text-emerald-700 text-xs font-bold">{preview.channel.shortLabel}</div>
                    <div>
                      <p className="text-sm font-semibold">{preview.destinationLabel}</p>
                      <p className="text-xs text-muted-foreground">online agora</p>
                    </div>
                  </div>
                  <div className="mt-3 space-y-2">
                    <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-emerald-600 text-white px-3 py-2 text-sm shadow">
                      {preview.message ? applyPlaceholder(preview.message, "Maria") : "Sua mensagem aparecerá aqui..."}
                    </div>
                    <p className="text-[10px] text-muted-foreground">Prévia com {PLACEHOLDER} → "Maria"</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      {/* Footer fixo */}
      <div className="sticky bottom-0 z-10">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 pb-6">
          <div className="rounded-xl border bg-background/80 backdrop-blur p-4 shadow-lg flex items-center justify-between">
            <Button variant="secondary" onClick={() => router.push('/campaigns')}>
              <Icon.ArrowLeft /> Cancelar
            </Button>
            <div className="text-center font-semibold text-primary">{selectedCount} destinatário(s)</div>
            <Button disabled={!canProceed || isSubmitting} onClick={handleSendCampaign}>
              {isSubmitting ? <Icon.Loader2 className="animate-spin" /> : <Icon.Send />}
              {isSubmitting ? 'Enviando...' : 'Revisar e Enviar Campanha'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
