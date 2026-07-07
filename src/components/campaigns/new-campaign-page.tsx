'use client';

import React, { useMemo, useState, useEffect, useCallback } from "react";
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { getContacts, getSegments } from '@/actions/crm';
import { findWhatsappTemplates, getEvolutionApiInstances } from '@/actions/evolution-api';
import { getTelegramInstances as fetchTelegramInstances } from '@/actions/telegram';
import { listMetaChannels as fetchMetaChannels } from '@/actions/meta-channels';
import { createCampaign } from '@/actions/campaigns';
import { parseCampaignContactsCsv } from '@/lib/campaigns/csv-import';
import { renderCampaignMessage } from '@/lib/campaigns/personalization';
import { uploadFileToStorage } from '@/lib/supabase/storage';
import type { CampaignChannel, CampaignMediaAttachment, CampaignScheduleConfig, CampaignTemplate, Contact as ContactType, EvolutionInstance, MetaChannel, Segment, TelegramBotInstance, User } from '@/lib/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CalendarClock, Clock3, Gauge, ImageIcon, ListFilter, Music2, ShieldCheck, X } from 'lucide-react';

// ---------------------------------------------------------
// Constantes e utilitários
// ---------------------------------------------------------
const PLACEHOLDER = "{{nome}}";
const FIRST_NAME_PLACEHOLDER = "{{primeiro_nome}}";
const GREETING_PLACEHOLDER = "{{Sauda\u00e7\u00e3o}}";
const PREVIEW_CONTACT_NAME = "Maria Silva";
const CHANNEL_OPTIONS: Array<{ value: CampaignChannel; label: string; shortLabel: string }> = [
  { value: 'whatsapp_baileys', label: 'WhatsApp conectado', shortLabel: 'WA' },
  { value: 'whatsapp_cloud', label: 'WhatsApp Cloud API', shortLabel: 'WA' },
  { value: 'telegram', label: 'Telegram', shortLabel: 'TG' },
  { value: 'messenger', label: 'Messenger (Facebook)', shortLabel: 'FB' },
  { value: 'instagram', label: 'Instagram Direct', shortLabel: 'IG' },
];
const WEEKDAYS = [
  { value: 1, label: 'Seg' },
  { value: 2, label: 'Ter' },
  { value: 3, label: 'Qua' },
  { value: 4, label: 'Qui' },
  { value: 5, label: 'Sex' },
  { value: 6, label: 'Sab' },
  { value: 0, label: 'Dom' },
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

type CsvImportSummary = {
  fileName: string;
  imported: number;
  invalidRows: number;
  duplicateRows: number;
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

function applyPlaceholder(msg: string) {
  return renderCampaignMessage(msg, {
    contactName: PREVIEW_CONTACT_NAME,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo',
  });
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

function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
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
  { id: "boasvindas", label: "Boas-vindas", text: `${GREETING_PLACEHOLDER}, ${FIRST_NAME_PLACEHOLDER}! 👋 Bem-vindo(a)! Eu sou do time de atendimento. Posso te ajudar em algo agora?` },
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
  const [mediaAttachment, setMediaAttachment] = useState<CampaignMediaAttachment | null>(null);
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const [csvImportSummary, setCsvImportSummary] = useState<CsvImportSummary | null>(null);
  const [scheduleMode, setScheduleMode] = useState<CampaignScheduleConfig['mode']>('immediate');
  const [scheduleEndAt, setScheduleEndAt] = useState('');
  const [windowStart, setWindowStart] = useState('09:00');
  const [windowEnd, setWindowEnd] = useState('18:00');
  const [allowedWeekdays, setAllowedWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [intervalMode, setIntervalMode] = useState<CampaignScheduleConfig['intervalMode']>('fixed');
  const [intervalSeconds, setIntervalSeconds] = useState(30);
  const [minIntervalSeconds, setMinIntervalSeconds] = useState(20);
  const [maxIntervalSeconds, setMaxIntervalSeconds] = useState(60);
  const [dailyLimit, setDailyLimit] = useState(250);
  const [autoPauseFailureRate, setAutoPauseFailureRate] = useState(20);
  const [consentConfirmed, setConsentConfirmed] = useState(false);

  // Data states
  const [crmContacts, setCrmContacts] = useState<ContactType[]>([]);
  const [visibleCrmContacts, setVisibleCrmContacts] = useState<ContactType[]>([]);
  const [csvContacts, setCsvContacts] = useState<ContactType[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [segmentPreviewContacts, setSegmentPreviewContacts] = useState<ContactType[]>([]);
  const [segmentTotal, setSegmentTotal] = useState(0);
  const [instances, setInstances] = useState<Omit<EvolutionInstance, 'status' | 'qrCode'>[]>([]);
  const [telegramInstances, setTelegramInstances] = useState<Omit<TelegramBotInstance, 'status'>[]>([]);
  const [metaChannels, setMetaChannels] = useState<MetaChannel[]>([]);
  const [whatsappTemplates, setWhatsappTemplates] = useState<WhatsappTemplateOption[]>([]);
  const [selectedTemplateName, setSelectedTemplateName] = useState<string | null>(null);

  // Loading states
  const [loadingCrm, setLoadingCrm] = useState(true);
  const [loadingSegmentAudience, setLoadingSegmentAudience] = useState(false);
  const [loadingInstances, setLoadingInstances] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [selectedCrmIds, setSelectedCrmIds] = useState<Set<string>>(() => new Set<string>());
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<Set<string>>(() => new Set<string>());

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

    getSegments(user.activeWorkspaceId)
      .then(result => {
        setSegments(result.segments || []);
        if (result.error) {
          toast({ title: 'Erro ao carregar listas', description: result.error, variant: 'destructive' });
        }
      })
      .catch((error) => {
        console.error('[NEW_CAMPAIGN] Falha ao buscar listas', error);
        toast({ title: 'Erro ao carregar listas', description: 'Não foi possível buscar as listas do CRM.', variant: 'destructive' });
      });

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

  useEffect(() => {
    if (!user?.activeWorkspaceId || selectedSegmentIds.size === 0) {
      setSegmentPreviewContacts([]);
      setSegmentTotal(0);
      setLoadingSegmentAudience(false);
      return;
    }

    let ignored = false;
    setLoadingSegmentAudience(true);
    getContacts(user.activeWorkspaceId, {
      segmentIds: [...selectedSegmentIds],
      limit: 50,
    })
      .then(result => {
        if (ignored) return;
        setSegmentPreviewContacts(result.contacts || []);
        setSegmentTotal(result.total);
        if (result.error) {
          toast({ title: 'Erro ao carregar público', description: result.error, variant: 'destructive' });
        }
      })
      .catch((error) => {
        if (ignored) return;
        console.error('[NEW_CAMPAIGN] Falha ao resolver listas', error);
        toast({ title: 'Erro ao carregar público', description: 'Não foi possível calcular os contatos das listas.', variant: 'destructive' });
      })
      .finally(() => {
        if (!ignored) setLoadingSegmentAudience(false);
      });

    return () => {
      ignored = true;
    };
  }, [selectedSegmentIds, toast, user?.activeWorkspaceId]);

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
    if (deliveryChannel !== 'whatsapp_baileys') {
      setMediaAttachment(null);
    }
    if (deliveryChannel !== 'whatsapp_baileys' && deliveryChannel !== 'whatsapp_cloud') {
      setTab('crm');
      setCsvContacts([]);
      setCsvImportSummary(null);
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

  const selectedCount = selectedCrmIds.size + segmentTotal + csvContacts.length;
  const customScheduleIsValid = scheduleMode === 'immediate' || Boolean(
    scheduleEndAt
    && windowStart < windowEnd
    && allowedWeekdays.length > 0
    && (intervalMode === 'fixed'
      ? intervalSeconds >= 2
      : minIntervalSeconds >= 2 && maxIntervalSeconds >= minIntervalSeconds)
  );
  const canProceed = Boolean(
    campaignMessage.trim()
    && destinationId
    && selectedCount > 0
    && consentConfirmed
    && customScheduleIsValid
    && !isUploadingMedia
    && (deliveryChannel !== 'whatsapp_cloud' || selectedTemplate)
  );

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

  function toggleSegment(segmentId: string) {
    setSelectedSegmentIds(prev => {
      const next = new Set(prev);
      next.has(segmentId) ? next.delete(segmentId) : next.add(segmentId);
      return next;
    });
  }

  async function importCsvFile(file: File) {
    if (!user?.activeWorkspaceId) return;
    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith('.csv') && file.type && !file.type.includes('csv')) {
      toast({ title: 'Arquivo invalido', description: 'Selecione um arquivo CSV.', variant: 'destructive' });
      return;
    }

    try {
      const text = await file.text();
      const parsed = parseCampaignContactsCsv(text);

      if (parsed.contacts.length === 0) {
        toast({
          title: 'Nenhum contato importado',
          description: parsed.errors[0] || 'Confira se o CSV possui uma coluna de telefone ou WhatsApp.',
          variant: 'destructive',
        });
        return;
      }

      setCsvContacts(parsed.contacts.map(contact => ({
        id: contact.id,
        workspace_id: user.activeWorkspaceId!,
        name: contact.name,
        phone: contact.phone,
        phone_number_jid: contact.phone_number_jid,
      } as ContactType)));
      setCsvImportSummary({
        fileName: file.name,
        imported: parsed.contacts.length,
        invalidRows: parsed.invalidRows,
        duplicateRows: parsed.duplicateRows,
      });
      setTab('csv');

      toast({
        title: 'CSV importado',
        description: `${parsed.contacts.length} contato(s) pronto(s) para o disparo.`,
      });
    } catch (error) {
      console.error('[NEW_CAMPAIGN] Falha ao importar CSV', error);
      toast({ title: 'Erro ao importar CSV', description: 'Nao foi possivel ler este arquivo.', variant: 'destructive' });
    }
  }

  function handleCsvInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      void importCsvFile(file);
    }
    e.target.value = '';
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    void importCsvFile(file);
  }

  async function handleMediaInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !user?.activeWorkspaceId) return;

    const type = file.type.startsWith('image/') ? 'image' : file.type.startsWith('audio/') ? 'audio' : null;
    if (!type) {
      toast({ title: 'Arquivo invalido', description: 'Selecione uma imagem ou um audio.', variant: 'destructive' });
      return;
    }

    const maxSizeMb = type === 'image' ? 16 : 32;
    if (file.size > maxSizeMb * 1024 * 1024) {
      toast({ title: 'Arquivo muito grande', description: `O limite para ${type === 'image' ? 'imagem' : 'audio'} e ${maxSizeMb} MB.`, variant: 'destructive' });
      return;
    }

    setIsUploadingMedia(true);
    try {
      const extension = file.name.split('.').pop()?.replace(/[^a-z0-9]/gi, '').toLowerCase() || (type === 'image' ? 'jpg' : 'mp3');
      const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
      const storagePath = `campaign-media/${user.activeWorkspaceId}/${uniqueName}`;
      const { publicUrl, error } = await uploadFileToStorage(file, 'temp-media', storagePath);

      if (error || !publicUrl) {
        throw new Error(error || 'Upload sem URL publica.');
      }

      setMediaAttachment({
        type,
        url: publicUrl,
        mimetype: file.type || (type === 'image' ? 'image/jpeg' : 'audio/mpeg'),
        filename: file.name,
        storageBucket: 'temp-media',
        storagePath,
      });
      toast({ title: 'Anexo adicionado', description: `${file.name} sera enviado na campanha.` });
    } catch (error) {
      console.error('[NEW_CAMPAIGN] Falha ao subir midia da campanha', error);
      toast({ title: 'Erro ao enviar anexo', description: error instanceof Error ? error.message : 'Nao foi possivel subir o arquivo.', variant: 'destructive' });
    } finally {
      setIsUploadingMedia(false);
    }
  }

  async function handleSendCampaign() {
    if (!user?.activeWorkspaceId || !destinationId || !campaignMessage || selectedCount === 0) {
      toast({ title: 'Dados Incompletos', description: 'Selecione o canal, a conta de envio e pelo menos um contato.', variant: 'destructive' });
      return;
    };
    if (!consentConfirmed) {
      toast({ title: 'Consentimento necessario', description: 'Confirme que os destinatarios autorizaram o recebimento da campanha.', variant: 'destructive' });
      return;
    }
    if (!customScheduleIsValid) {
      toast({ title: 'Agendamento incompleto', description: 'Revise a data limite, os dias, a janela e os intervalos.', variant: 'destructive' });
      return;
    }
    setIsSubmitting(true);

    const selectedFromCrm = crmContacts
      .filter((c) => selectedCrmIds.has(c.id))
      .map((c) => ({ id: `crm-${c.id}`, name: c.name, phone_number_jid: c.phone_number_jid }));

    const allContactsToSend = [...selectedFromCrm, ...csvContacts.map(c => ({ ...c, id: `csv-${c.id}` }))];
    const scheduleConfig: CampaignScheduleConfig = {
      mode: scheduleMode,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo',
      endAt: scheduleMode === 'custom' ? new Date(scheduleEndAt).toISOString() : undefined,
      windowStart,
      windowEnd,
      allowedWeekdays,
      intervalMode,
      intervalSeconds,
      minIntervalSeconds,
      maxIntervalSeconds,
      dailyLimit: scheduleMode === 'custom' ? dailyLimit : null,
      maxAttempts: 3,
      autoPauseFailureRate,
      autoPauseMinAttempts: 20,
      consentConfirmed,
    };

    const result = await createCampaign(user.activeWorkspaceId, {
      channel: deliveryChannel,
      instanceName: deliveryChannel === 'messenger' || deliveryChannel === 'instagram' ? undefined : destinationId,
      metaChannelId: deliveryChannel === 'messenger' || deliveryChannel === 'instagram' ? destinationId : undefined,
      template: selectedTemplate,
    }, campaignMessage, allContactsToSend, [...selectedSegmentIds], scheduleConfig, mediaAttachment);

    if (result.error) {
      toast({ title: 'Erro ao criar campanha', description: result.error, variant: 'destructive' });
    } else {
      toast({
        title: scheduleMode === 'immediate' ? 'Campanha colocada na fila!' : 'Campanha agendada!',
        description: 'Os destinatários ficaram persistidos e o worker retomará o envio após reinícios.',
      });
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
            <li className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-foreground/70 text-xs">3</span><span>Entrega</span></li>
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
                    placeholder={`Digite sua mensagem aqui... Use ${PLACEHOLDER}, ${FIRST_NAME_PLACEHOLDER} ou ${GREETING_PLACEHOLDER}.`}
                  />
                  <div className="flex items-center justify-between text-xs">
                    <p className="text-muted-foreground">
                      Variaveis: <code className="rounded bg-muted px-1">{PLACEHOLDER}</code>, <code className="rounded bg-muted px-1">{FIRST_NAME_PLACEHOLDER}</code>, <code className="rounded bg-muted px-1">{GREETING_PLACEHOLDER}</code>
                    </p>
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
                {deliveryChannel === 'whatsapp_baileys' && (
                  <div className="space-y-3 mt-6 rounded-xl border bg-muted/20 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium leading-none">Anexo opcional</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Adicione uma imagem ou um audio ao disparo. Imagens usam a mensagem como legenda.
                        </p>
                      </div>
                      {mediaAttachment && (
                        <button
                          type="button"
                          onClick={() => setMediaAttachment(null)}
                          className="rounded-full p-1 text-muted-foreground hover:bg-background hover:text-foreground"
                          aria-label="Remover anexo"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>

                    {mediaAttachment ? (
                      <div className="flex items-center gap-3 rounded-lg border bg-background p-3">
                        {mediaAttachment.type === 'image' ? (
                          <div className="h-16 w-16 overflow-hidden rounded-md border bg-muted">
                            <img src={mediaAttachment.url} alt={mediaAttachment.filename} className="h-full w-full object-cover" />
                          </div>
                        ) : (
                          <div className="flex h-16 w-16 items-center justify-center rounded-md border bg-muted">
                            <Music2 className="h-7 w-7 text-muted-foreground" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{mediaAttachment.filename}</p>
                          <p className="text-xs text-muted-foreground">
                            {mediaAttachment.type === 'image' ? 'Imagem' : 'Audio'} pronto para envio
                          </p>
                        </div>
                      </div>
                    ) : (
                      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed bg-background px-4 py-4 text-sm font-medium transition-colors hover:bg-accent/60">
                        {isUploadingMedia ? <Icon.Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
                        {isUploadingMedia ? 'Enviando anexo...' : 'Selecionar imagem ou audio'}
                        <input
                          type="file"
                          accept="image/*,audio/*"
                          className="hidden"
                          disabled={isUploadingMedia}
                          onChange={handleMediaInputChange}
                        />
                      </label>
                    )}
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
                  <div role="tablist" aria-orientation="horizontal" className="grid w-full grid-cols-3 min-h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground">
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
                      aria-selected={tab === "lists"}
                      className={cx(
                        "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium transition-all",
                        tab === "lists" ? "bg-background text-foreground shadow-sm" : ""
                      )}
                      onClick={() => setTab("lists")}
                    >
                      <ListFilter className="mr-2 h-4 w-4" /> Listas ({selectedSegmentIds.size})
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

                  {tab === "lists" && (
                    <div className="mt-4 space-y-3">
                      {segments.length === 0 ? (
                        <div className="flex h-40 flex-col items-center justify-center rounded-md border border-dashed text-center">
                          <ListFilter className="mb-2 h-6 w-6 text-muted-foreground" />
                          <p className="text-sm font-medium">Nenhuma lista personalizada criada</p>
                          <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                            Crie listas inteligentes no CRM para reutilizá-las como público de campanha.
                          </p>
                          <Button className="mt-3" variant="secondary" onClick={() => router.push('/crm')}>
                            Ir para o CRM
                          </Button>
                        </div>
                      ) : (
                        <>
                          <div className="overflow-hidden rounded-md border">
                            <ul className="max-h-52 divide-y overflow-y-auto">
                              {segments.map(segment => (
                                <li key={segment.id}>
                                  <label className="flex cursor-pointer items-center gap-3 p-3 hover:bg-accent/60">
                                    <input
                                      type="checkbox"
                                      checked={selectedSegmentIds.has(segment.id)}
                                      onChange={() => toggleSegment(segment.id)}
                                      className="h-4 w-4 rounded border-primary"
                                    />
                                    <ListFilter className="h-4 w-4 text-muted-foreground" />
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate text-sm font-medium">{segment.name}</span>
                                      {segment.description && (
                                        <span className="block truncate text-xs text-muted-foreground">{segment.description}</span>
                                      )}
                                    </span>
                                    {selectedSegmentIds.has(segment.id) && <Icon.Check className="h-4 w-4 text-primary" />}
                                  </label>
                                </li>
                              ))}
                            </ul>
                          </div>

                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>
                              {selectedSegmentIds.size === 0
                                ? 'Selecione uma ou mais listas.'
                                : `${segmentTotal} contato(s) único(s) nas listas selecionadas.`}
                            </span>
                            {loadingSegmentAudience && <Icon.Loader2 className="h-4 w-4 animate-spin" />}
                          </div>

                          {selectedSegmentIds.size > 0 && segmentPreviewContacts.length > 0 && (
                            <div className="overflow-hidden rounded-md border">
                              <div className="border-b bg-muted/40 px-3 py-2 text-xs font-medium">Prévia do público</div>
                              <ul className="max-h-40 divide-y overflow-y-auto">
                                {segmentPreviewContacts.map(contact => (
                                  <li key={contact.id} className="flex items-center gap-3 p-2">
                                    <Avatar name={contact.name} />
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-sm font-medium">{contact.name}</p>
                                      <p className="truncate text-xs text-muted-foreground">{contact.phone_number_jid || contact.phone || contact.email}</p>
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </>
                      )}
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
                          accept=".csv,text/csv"
                          aria-label="Selecionar arquivo CSV"
                          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                          onChange={handleCsvInputChange}
                        />
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">Após importar, detectaremos as colunas <code>nome</code> e <code>telefone</code>.</p>
                      {csvImportSummary && (
                        <div className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs">
                          <p className="font-medium text-emerald-700">
                            {csvImportSummary.imported} contato(s) importado(s) de {csvImportSummary.fileName}
                          </p>
                          {(csvImportSummary.invalidRows > 0 || csvImportSummary.duplicateRows > 0) && (
                            <p className="mt-1 text-muted-foreground">
                              {csvImportSummary.invalidRows > 0 ? `${csvImportSummary.invalidRows} linha(s) sem telefone valido. ` : ''}
                              {csvImportSummary.duplicateRows > 0 ? `${csvImportSummary.duplicateRows} duplicata(s) ignorada(s).` : ''}
                            </p>
                          )}
                        </div>
                      )}
                      {csvContacts.length > 0 && (
                        <div className="mt-3 overflow-hidden rounded-md border">
                          <div className="border-b bg-muted/40 px-3 py-2 text-xs font-medium">Prévia do CSV</div>
                          <ul className="max-h-44 divide-y overflow-y-auto">
                            {csvContacts.slice(0, 20).map(contact => (
                              <li key={contact.id} className="flex items-center gap-3 p-2">
                                <Avatar name={contact.name} />
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-medium">{contact.name}</p>
                                  <p className="truncate text-xs text-muted-foreground">{contact.phone_number_jid}</p>
                                </div>
                              </li>
                            ))}
                          </ul>
                          {csvContacts.length > 20 && (
                            <div className="border-t px-3 py-2 text-xs text-muted-foreground">
                              Mostrando 20 de {csvContacts.length} contatos.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <CalendarClock className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-semibold leading-none tracking-tight">3. Entrega da campanha</h3>
                    <p className="mt-1 text-sm text-muted-foreground">Defina quando e em que ritmo a fila persistente será processada.</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setScheduleMode('immediate')}
                      className={cx(
                        "rounded-xl border p-4 text-left transition-colors",
                        scheduleMode === 'immediate' ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50"
                      )}
                    >
                      <div className="mb-2 flex items-center gap-2 font-semibold">
                        <Icon.Send className="h-4 w-4" />
                        Enviar imediatamente
                      </div>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Começa assim que o worker encontrar a campanha e distribui os envios com segurança.
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setScheduleMode('custom')}
                      className={cx(
                        "rounded-xl border p-4 text-left transition-colors",
                        scheduleMode === 'custom' ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50"
                      )}
                    >
                      <div className="mb-2 flex items-center gap-2 font-semibold">
                        <CalendarClock className="h-4 w-4" />
                        Envio customizado
                      </div>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Distribui os destinatários até uma data limite, respeitando dias, horários e volume diário.
                      </p>
                    </button>
                  </div>

                  {scheduleMode === 'custom' && (
                    <div className="space-y-5 rounded-xl border bg-muted/20 p-4">
                      <div className="grid gap-4 sm:grid-cols-3">
                        <div className="space-y-2 sm:col-span-1">
                          <label htmlFor="schedule-end-at" className="text-sm font-medium">Enviar até</label>
                          <Input
                            id="schedule-end-at"
                            type="datetime-local"
                            value={scheduleEndAt}
                            onChange={(event) => setScheduleEndAt(event.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <label htmlFor="window-start" className="text-sm font-medium">Início da janela</label>
                          <Input
                            id="window-start"
                            type="time"
                            value={windowStart}
                            onChange={(event) => setWindowStart(event.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <label htmlFor="window-end" className="text-sm font-medium">Fim da janela</label>
                          <Input
                            id="window-end"
                            type="time"
                            value={windowEnd}
                            onChange={(event) => setWindowEnd(event.target.value)}
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium">Dias permitidos</label>
                        <div className="flex flex-wrap gap-2">
                          {WEEKDAYS.map(day => {
                            const active = allowedWeekdays.includes(day.value);
                            return (
                              <button
                                key={day.value}
                                type="button"
                                aria-pressed={active}
                                onClick={() => setAllowedWeekdays(current =>
                                  active ? current.filter(value => value !== day.value) : [...current, day.value]
                                )}
                                className={cx(
                                  "h-9 min-w-11 rounded-md border px-3 text-sm font-medium transition-colors",
                                  active ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
                                )}
                              >
                                {day.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <Clock3 className="h-4 w-4 text-muted-foreground" />
                          <label className="text-sm font-medium">Intervalo entre envios</label>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <button
                            type="button"
                            onClick={() => setIntervalMode('fixed')}
                            className={cx(
                              "rounded-lg border px-3 py-2 text-sm font-medium",
                              intervalMode === 'fixed' ? "border-primary bg-primary/5 text-primary" : "bg-background"
                            )}
                          >
                            Intervalo fixo
                          </button>
                          <button
                            type="button"
                            onClick={() => setIntervalMode('variable')}
                            className={cx(
                              "rounded-lg border px-3 py-2 text-sm font-medium",
                              intervalMode === 'variable' ? "border-primary bg-primary/5 text-primary" : "bg-background"
                            )}
                          >
                            Intervalo variável
                          </button>
                        </div>
                        {intervalMode === 'fixed' ? (
                          <div className="space-y-2">
                            <label htmlFor="fixed-interval" className="text-xs text-muted-foreground">Segundos entre cada destinatário</label>
                            <Input
                              id="fixed-interval"
                              type="number"
                              min={2}
                              max={86400}
                              value={intervalSeconds}
                              onChange={(event) => setIntervalSeconds(Math.max(2, Number(event.target.value) || 2))}
                            />
                          </div>
                        ) : (
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-2">
                              <label htmlFor="min-interval" className="text-xs text-muted-foreground">Mínimo em segundos</label>
                              <Input
                                id="min-interval"
                                type="number"
                                min={2}
                                value={minIntervalSeconds}
                                onChange={(event) => setMinIntervalSeconds(Math.max(2, Number(event.target.value) || 2))}
                              />
                            </div>
                            <div className="space-y-2">
                              <label htmlFor="max-interval" className="text-xs text-muted-foreground">Máximo em segundos</label>
                              <Input
                                id="max-interval"
                                type="number"
                                min={minIntervalSeconds}
                                value={maxIntervalSeconds}
                                onChange={(event) => setMaxIntervalSeconds(Math.max(minIntervalSeconds, Number(event.target.value) || minIntervalSeconds))}
                              />
                            </div>
                          </div>
                        )}
                        <p className="text-xs text-muted-foreground">
                          No modo variável, a distribuição é determinística e auditável para suavizar a carga do worker.
                        </p>
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <label htmlFor="daily-limit" className="flex items-center gap-2 text-sm font-medium">
                            <Gauge className="h-4 w-4 text-muted-foreground" />
                            Limite diário
                          </label>
                          <Input
                            id="daily-limit"
                            type="number"
                            min={1}
                            max={100000}
                            value={dailyLimit}
                            onChange={(event) => setDailyLimit(Math.max(1, Number(event.target.value) || 1))}
                          />
                        </div>
                        <div className="space-y-2">
                          <label htmlFor="failure-rate" className="flex items-center gap-2 text-sm font-medium">
                            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                            Pausar com falhas em
                          </label>
                          <div className="relative">
                            <Input
                              id="failure-rate"
                              type="number"
                              min={1}
                              max={100}
                              value={autoPauseFailureRate}
                              onChange={(event) => setAutoPauseFailureRate(Math.min(100, Math.max(1, Number(event.target.value) || 1)))}
                              className="pr-9"
                            />
                            <span className="pointer-events-none absolute right-3 top-2.5 text-sm text-muted-foreground">%</span>
                          </div>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        A pausa automática começa a avaliar após 20 tentativas e protege os envios restantes.
                      </p>
                    </div>
                  )}

                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
                    <input
                      type="checkbox"
                      checked={consentConfirmed}
                      onChange={(event) => setConsentConfirmed(event.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-primary"
                    />
                    <span>
                      <span className="flex items-center gap-2 text-sm font-semibold">
                        <ShieldCheck className="h-4 w-4 text-emerald-600" />
                        Confirmo o consentimento dos destinatários
                      </span>
                      <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                        Contatos marcados como opt-out serão removidos automaticamente antes do agendamento.
                      </span>
                    </span>
                  </label>
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
                    {mediaAttachment && (
                      <div className="max-w-[85%] overflow-hidden rounded-2xl rounded-tl-sm bg-emerald-600 text-white shadow">
                        {mediaAttachment.type === 'image' ? (
                          <img src={mediaAttachment.url} alt={mediaAttachment.filename} className="max-h-48 w-full object-cover" />
                        ) : (
                          <div className="flex items-center gap-2 px-3 py-3 text-sm">
                            <Music2 className="h-4 w-4" />
                            <span className="truncate">{mediaAttachment.filename}</span>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-emerald-600 text-white px-3 py-2 text-sm shadow">
                      {preview.message ? applyPlaceholder(preview.message) : "Sua mensagem aparecerá aqui..."}
                    </div>
                    <p className="text-[10px] text-muted-foreground">Previa com {PREVIEW_CONTACT_NAME}, primeiro nome e saudacao atual.</p>
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
              {isSubmitting ? 'Criando fila...' : 'Criar campanha'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
