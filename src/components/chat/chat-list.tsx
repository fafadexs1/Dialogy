'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Image from 'next/image';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { PlusCircle, File, Video, Mic, Image as ImageIcon, Users, Loader2, Filter, MessageSquare, MapPin, RefreshCw, Megaphone, Check, UserCheck, PencilLine, User as UserIcon, ChevronsUpDown, AlertTriangle, ListTodo, CheckCircle2, Bot, Brain, MessageSquareQuote, Search, Send, CircleCheck, LayoutTemplate, MessageCircle, Hash, X, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn, formatMessageTime } from '@/lib/utils';
import { badgeColorStyle } from '@/lib/color-contrast';
import { resolveClientMediaUrl } from '@/lib/storage-url';
import { Virtuoso } from 'react-virtuoso';
import { useInboxStore } from '@/hooks/use-inbox-store';
import { getInboxChatsSnapshotAction } from '@/actions/chats';
import { AgentProfileSheet } from '@/components/team/agent-profile-sheet';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { type Chat, type OnlineAgent, type User, type Message, EvolutionInstance, type TelegramBotInstance, type Team, type AutopilotConfig } from '@/lib/types';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { usePresence } from '@/hooks/use-online-status';
import { FaWhatsapp, FaInstagram, FaFacebookMessenger, FaTelegram } from 'react-icons/fa6';
import { Badge } from '../ui/badge';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from '../ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../ui/select';
import { Textarea } from '../ui/textarea';
import { startNewConversation } from '@/actions/messages';
import { closeMultipleChatsAction, toggleMultipleChatsAutopilotAction } from '@/actions/chats';
import { guardedAssignChat, guardedCloseChat } from '@/actions/chat-guards';
import { toast } from '@/hooks/use-toast';
import { getEvolutionApiInstances } from '@/actions/evolution-api';
import { getTelegramInstances } from '@/actions/telegram';
import { buildChatProtocol } from '@/lib/utils';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { getTeams } from '@/actions/teams';
import { getWorkspaceUsers } from '@/actions/crm';
import { getChatPlatformLabel, resolveChatPlatform } from '@/lib/chat-platform';
import { isMarketingMessage, matchesChatTeamFilter } from './chat-list-visibility';
import { isChatVisibleForOwnership, isOwnershipScopedChat } from '@/lib/inbox-ownership';
import { formatInboxCount, getInboxPaginationScope, hasMoreChatsInScope, isChatInInboxQueueScope, isInboxAssignmentFilterTab, resolveInboxStatusFilterForTab, scopeInboxListFilters, type InboxListFilters } from '@/lib/inbox-pagination';
import { sanitizeNationalPhoneInput } from '@/lib/phone-input';

import { SearchDetailsDialog } from './search-details-dialog';
import { InboxSearchInput } from './inbox-search-input';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { usePremiumWheelScroller } from '@/hooks/use-premium-wheel-scroller';

const MAX_VISIBLE_ONLINE_AGENTS = 5;
const PRIORITY_REEVALUATION_INTERVAL_MS = 60_000;

// --- Start New Conversation Dialog ---
function NewConversationDialog({ workspaceId, onActionSuccess, trigger }: { workspaceId: string, onActionSuccess: () => void, trigger?: React.ReactNode }) {
  const dialogAnimationId = React.useId();
  const [isOpen, setIsOpen] = useState(false);
  const [instances, setInstances] = useState<Array<
    Omit<EvolutionInstance, 'status' | 'qrCode'> |
    Omit<TelegramBotInstance, 'status'>
  >>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [countryCode, setCountryCode] = useState('55');
  const [templateSearch, setTemplateSearch] = useState('');
  const [freeMessage, setFreeMessage] = useState('');

  const [selectedInstanceName, setSelectedInstanceName] = useState('');
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTemplateName, setSelectedTemplateName] = useState('');
  const [templateVariables, setTemplateVariables] = useState<Record<string, string>>({});
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const prefersReducedMotion = useReducedMotion();

  // Helper to find selected instance object
  const selectedInstance = useMemo(() => instances.find(i => i.instance_name === selectedInstanceName), [instances, selectedInstanceName]);
  const isCloud = selectedInstance?.type === 'wa_cloud';
  const isTelegram = selectedInstance?.type === 'telegram';

  // Helper to find selected template object
  const selectedTemplate = useMemo(() => templates.find(t => t.name === selectedTemplateName), [templates, selectedTemplateName]);

  // Parse variables from template body
  const variableKeys = useMemo(() => {
    if (!selectedTemplate) return [];
    const bodyComponent = selectedTemplate.components.find((c: any) => c.type === 'BODY');
    if (!bodyComponent || !bodyComponent.text) return [];

    // Match {{1}}, {{2}}, etc.
    const matches = bodyComponent.text.match(/\{\{\d+\}\}/g);
    if (!matches) return [];

    // Extract numbers and sort unique
    const uniqueNumbers = Array.from(new Set(matches.map((m: string) => parseInt(m.replace(/\{|\}/g, ''), 10)))) as number[];
    return uniqueNumbers.sort((a, b) => a - b).map(n => n.toString());
  }, [selectedTemplate]);

  const normalizedPhoneNumber = useMemo(
    () => isTelegram ? phoneNumber.trim() : `${countryCode}${phoneNumber.replace(/\D/g, '')}`,
    [countryCode, isTelegram, phoneNumber]
  );
  const isRecipientValid = isTelegram
    ? normalizedPhoneNumber.length >= 3
    : normalizedPhoneNumber.length >= 10 && normalizedPhoneNumber.length <= 15;
  const filteredTemplates = useMemo(() => {
    const query = templateSearch.trim().toLocaleLowerCase('pt-BR');
    if (!query) return templates;
    return templates.filter((template: any) => {
      const body = template.components?.find((component: any) => component.type === 'BODY')?.text || '';
      return `${template.name || ''} ${body}`.toLocaleLowerCase('pt-BR').includes(query);
    });
  }, [templateSearch, templates]);
  const selectedTemplateBody = useMemo(
    () => selectedTemplate?.components?.find((component: any) => component.type === 'BODY')?.text || '',
    [selectedTemplate]
  );
  const renderedTemplatePreview = useMemo(() => {
    let preview = selectedTemplateBody;
    variableKeys.forEach((key) => {
      preview = preview.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), templateVariables[key]?.trim() || `{{${key}}}`);
    });
    return preview;
  }, [selectedTemplateBody, templateVariables, variableKeys]);
  const areTemplateVariablesComplete = variableKeys.every(key => Boolean(templateVariables[key]?.trim()));
  const canSubmit = Boolean(selectedInstanceName)
    && isRecipientValid
    && (isCloud ? Boolean(selectedTemplate && areTemplateVariablesComplete) : Boolean(freeMessage.trim()));

  useEffect(() => {
    if (isOpen && workspaceId) {
      setIsLoading(true);
      Promise.all([
        getEvolutionApiInstances(workspaceId),
        getTelegramInstances(workspaceId),
      ])
        .then(([whatsappRes, telegramRes]) => {
          if (whatsappRes.error) {
            toast({ title: 'Erro ao carregar instâncias', description: whatsappRes.error, variant: 'destructive' });
            setInstances([]);
            return;
          }
          if (telegramRes.error) {
            toast({ title: 'Erro ao carregar bots', description: telegramRes.error, variant: 'destructive' });
            setInstances([]);
            return;
          }
          setInstances([...(whatsappRes.instances || []), ...(telegramRes.instances || [])]);
        })
        .catch((error) => {
          console.error('[CHAT_LIST] Falha ao buscar instâncias', error);
          toast({ title: 'Erro ao carregar instâncias', description: 'Não foi possível buscar as instâncias de mensageria.', variant: 'destructive' });
          setInstances([]);
        })
        .finally(() => setIsLoading(false));
    }
  }, [isOpen, workspaceId]);

  // Fetch templates when Cloud instance is selected
  useEffect(() => {
    if (isCloud && selectedInstanceName) {
      setLoadingTemplates(true);
      // We need to import findWhatsappTemplates. Assuming it's available or need to add import.
      import('@/actions/evolution-api').then(({ findWhatsappTemplates }) => {
        findWhatsappTemplates(selectedInstanceName)
          .then(res => {
            if (res.templates) {
              setTemplates(res.templates.filter((t: any) => t.status === 'APPROVED'));
            } else {
              setTemplates([]);
            }
          })
          .catch(err => {
            console.error('Failed to fetch templates', err);
            setTemplates([]);
          })
          .finally(() => setLoadingTemplates(false));
      });
    } else {
      setTemplates([]);
      setSelectedTemplateName('');
      setTemplateVariables({});
    }
  }, [isCloud, selectedInstanceName]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canSubmit) {
      toast({
        title: 'Revise os dados da conversa',
        description: !selectedInstanceName
          ? 'Selecione uma instância de envio.'
          : !isRecipientValid
            ? 'Informe um destinatário válido.'
            : !isCloud && !freeMessage.trim()
              ? 'Escreva a primeira mensagem do atendimento.'
              : 'Selecione um template e preencha suas variáveis.',
        variant: 'destructive'
      });
      return;
    }
    setIsSubmitting(true);
    const formData = new FormData(e.currentTarget);
    const message = formData.get('message') as string;

    let templatePayload = undefined;

    if (isCloud && selectedTemplate) {
      // Construct template payload
      // We only support BODY variables for now as per requirement "user fills {{1}}"
      const parameters = variableKeys.map(key => ({
        type: 'text',
        text: templateVariables[key] || ''
      }));

      // Render the template body with substituted variables
      const bodyText = selectedTemplate.components.find((c: any) => c.type === 'BODY')?.text || '';
      let renderedContent = bodyText;
      variableKeys.forEach((key) => {
        const value = templateVariables[key] || '';
        renderedContent = renderedContent.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
      });

      templatePayload = {
        name: selectedTemplate.name,
        language: selectedTemplate.language,
        components: [
          {
            type: 'body',
            parameters
          }
        ],
        renderedContent: renderedContent || `[Template: ${selectedTemplate.name}]`
      };
    }

    const result = await startNewConversation({
      workspaceId,
      instanceName: selectedInstanceName,
      phoneNumber: normalizedPhoneNumber,
      message: templatePayload ? `[Template: ${selectedTemplate.name}]` : message, // Fallback message for UI if needed
      tabId: null,
      template: templatePayload
    });

    if (result.success) {
      toast({ title: 'Mensagem Enviada!', description: 'A conversa foi iniciada e aparecerá na sua lista.' });
      setIsOpen(false);
      onActionSuccess();
      setPhoneNumber('');
      setTemplateVariables({});
      setSelectedTemplateName('');
      setTemplateSearch('');
      setFreeMessage('');
      // Keep instance selected
    } else {
      toast({ title: 'Erro ao Enviar', description: result.error, variant: 'destructive' });
    }
    setIsSubmitting(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      setIsOpen(open);
      if (!open) {
        setTemplateSearch('');
      }
    }}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="icon">
            <PlusCircle className="h-5 w-5" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="flex max-h-[92dvh] w-[calc(100vw-24px)] max-w-[1120px] flex-col gap-0 overflow-hidden rounded-[22px] border-slate-200 bg-white p-0 text-slate-950 shadow-[0_32px_90px_-35px_rgba(15,23,42,0.65)] sm:max-w-[1120px] dark:border-white/10 dark:bg-[#09090b] dark:text-white">
        <DialogHeader className="shrink-0 border-b border-slate-200 px-6 py-5 pr-14 text-left dark:border-white/10">
          <DialogTitle className="text-xl font-semibold tracking-[-0.02em]">Nova conversa</DialogTitle>
          <DialogDescription className="text-sm text-slate-500 dark:text-zinc-400">
            Escolha o destino e prepare a primeira mensagem do atendimento.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[300px_minmax(0,1fr)] lg:overflow-hidden">
            <section className="border-b border-slate-200 bg-slate-50/60 p-5 lg:overflow-y-auto lg:border-b-0 lg:border-r dark:border-white/10 dark:bg-white/[0.025]">
              <div className="mb-5 flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
                  <Hash className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">Destino</h3>
                  <p className="text-xs text-slate-500 dark:text-zinc-500">Canal e destinatário</p>
                </div>
              </div>
              <div className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="instanceName" className="text-xs font-semibold text-slate-600 dark:text-zinc-300">Instância</Label>
                  <Select name="instanceName" required value={selectedInstanceName} onValueChange={(value) => {
                    setSelectedInstanceName(value);
                    setSelectedTemplateName('');
                    setTemplateVariables({});
                    setTemplateSearch('');
                  }}>
                    <SelectTrigger id="instanceName" className="h-auto min-h-14 rounded-xl border-slate-200 bg-white px-3 text-left shadow-sm transition-all duration-200 focus:ring-2 focus:ring-blue-500/25 dark:border-white/10 dark:bg-white/[0.04]">
                      <SelectValue placeholder={isLoading ? 'Carregando instâncias...' : 'Selecione uma instância'} />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border-slate-200 dark:border-white/10">
                      {isLoading ? (
                        <div className="flex items-center justify-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando...</div>
                      ) : instances.length === 0 ? (
                        <div className="p-4 text-center text-sm text-muted-foreground">Nenhuma instância disponível.</div>
                      ) : instances.map((instance) => (
                        <SelectItem key={instance.id} value={instance.instance_name} className="rounded-lg py-2.5 focus:bg-blue-50 dark:focus:bg-blue-500/10">
                          <span className="flex items-center gap-2">
                            {instance.type === 'telegram' ? <FaTelegram className="h-4 w-4 text-sky-500" /> : <FaWhatsapp className="h-4 w-4 text-emerald-500" />}
                            <span>{instance.display_name}</span>
                            {instance.type === 'wa_cloud' && <span className="text-[10px] text-blue-600 dark:text-blue-300">Cloud API</span>}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <AnimatePresence initial={false}>
                    {selectedInstance && (
                      <motion.div initial={prefersReducedMotion ? false : { opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="flex items-center gap-2 px-1 text-[11px] text-slate-500 dark:text-zinc-500">
                        <span className="h-2 w-2 rounded-full bg-emerald-500" />
                        <span>{isTelegram ? 'Telegram' : isCloud ? 'WhatsApp Cloud API' : 'WhatsApp conectado'}</span>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phoneNumber" className="text-xs font-semibold text-slate-600 dark:text-zinc-300">{isTelegram ? 'Chat ID' : 'Número'}</Label>
                  <div className={cn(
                    "flex min-h-12 overflow-hidden rounded-xl border bg-white shadow-sm transition-all duration-300 focus-within:ring-2 dark:bg-white/[0.04]",
                    isRecipientValid ? "border-emerald-400 focus-within:ring-emerald-500/15 dark:border-emerald-500/60" : "border-slate-200 focus-within:border-blue-500 focus-within:ring-blue-500/15 dark:border-white/10"
                  )}>
                    {!isTelegram && (
                      <Select value={countryCode} onValueChange={(value) => {
                        setCountryCode(value);
                        setPhoneNumber(current => sanitizeNationalPhoneInput(current, value));
                      }}>
                        <SelectTrigger aria-label="Código do país" className="h-12 w-[92px] shrink-0 rounded-none border-0 border-r border-slate-200 bg-slate-50 px-2 shadow-none focus:ring-0 dark:border-white/10 dark:bg-white/[0.04]"><SelectValue /></SelectTrigger>
                        <SelectContent className="rounded-xl">
                          <SelectItem value="55">BR +55</SelectItem>
                          <SelectItem value="1">US +1</SelectItem>
                          <SelectItem value="351">PT +351</SelectItem>
                          <SelectItem value="34">ES +34</SelectItem>
                          <SelectItem value="52">MX +52</SelectItem>
                          <SelectItem value="54">AR +54</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                    <Input
                      id="phoneNumber"
                      name="phoneNumber"
                      inputMode={isTelegram ? 'text' : 'numeric'}
                      autoComplete="tel"
                      placeholder={isTelegram ? '123456789' : '11 99999 8888'}
                      required
                      value={phoneNumber}
                      onChange={(event) => setPhoneNumber(isTelegram ? event.target.value : sanitizeNationalPhoneInput(event.target.value, countryCode))}
                      className="h-12 min-w-0 flex-1 rounded-none border-0 bg-transparent px-3 text-[14px] font-medium tracking-tight tabular-nums shadow-none focus-visible:ring-0"
                    />
                    <AnimatePresence initial={false}>
                      {isRecipientValid && (
                        <motion.span initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.65 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.65 }} className="flex w-11 items-center justify-center text-emerald-500" aria-label="Destinatário válido">
                          <CircleCheck className="h-5 w-5" />
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </div>
                  <p className={cn("flex min-h-4 items-center gap-1.5 text-[11px] transition-colors", isRecipientValid ? "text-emerald-600 dark:text-emerald-400" : "text-slate-500 dark:text-zinc-500")}>
                    {isRecipientValid && <Check className="h-3 w-3" />}
                    {isTelegram ? isRecipientValid ? 'Chat ID pronto para envio' : 'Use o ID de um chat que já conversou com o bot.' : isRecipientValid ? 'Número válido para WhatsApp' : 'Digite o DDD e o número, sem símbolos.'}
                  </p>
                </div>
                <motion.div layout className={cn(
                  "rounded-xl border p-3 transition-colors duration-300",
                  canSubmit ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200" : "border-slate-200 bg-white text-slate-600 dark:border-white/10 dark:bg-white/[0.03] dark:text-zinc-400"
                )}>
                  <div className="flex items-start gap-2.5">
                    {canSubmit ? <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" /> : <MessageCircle className="mt-0.5 h-4 w-4 shrink-0" />}
                    <div>
                      <p className="text-xs font-semibold">{canSubmit ? 'Tudo pronto para enviar' : 'Prepare o destino'}</p>
                      <p className="mt-1 text-[11px] leading-relaxed opacity-75">{selectedInstanceName ? `${isTelegram ? 'Telegram' : 'WhatsApp'}${isRecipientValid ? ` • ${normalizedPhoneNumber}` : ''}` : 'Selecione uma instância para continuar.'}</p>
                    </div>
                  </div>
                </motion.div>
              </div>
            </section>

            <section className="min-w-0 p-5 lg:overflow-y-auto lg:p-6">
              <div className="mx-auto mb-5 grid w-full max-w-sm grid-cols-2 rounded-xl bg-slate-100 p-1 dark:bg-white/[0.05]" aria-label="Tipo de mensagem">
                <div className={cn("flex h-9 items-center justify-center gap-2 rounded-lg text-xs font-semibold transition-all duration-300", !isCloud ? "bg-white text-blue-700 shadow-sm dark:bg-white/10 dark:text-blue-300" : "text-slate-400 dark:text-zinc-500")}><MessageSquare className="h-4 w-4" /> Mensagem livre</div>
                <div className={cn("flex h-9 items-center justify-center gap-2 rounded-lg text-xs font-semibold transition-all duration-300", isCloud ? "bg-white text-blue-700 shadow-sm dark:bg-white/10 dark:text-blue-300" : "text-slate-400 dark:text-zinc-500")}><LayoutTemplate className="h-4 w-4" /> Template</div>
              </div>
              <AnimatePresence mode="wait" initial={false}>
                {isCloud ? (
                  <motion.div key="template-workspace" initial={prefersReducedMotion ? false : { opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: prefersReducedMotion ? 0 : 0.24 }} className="grid min-w-0 gap-6 xl:grid-cols-[minmax(250px,0.9fr)_minmax(310px,1.1fr)]">
                    <div className="min-w-0 space-y-3 xl:border-r xl:border-slate-200 xl:pr-6 dark:xl:border-white/10">
                      <div><h3 className="text-sm font-semibold">Templates aprovados</h3><p className="mt-0.5 text-xs text-slate-500 dark:text-zinc-500">Escolha a mensagem inicial.</p></div>
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <Input value={templateSearch} onChange={(event) => setTemplateSearch(event.target.value)} placeholder="Buscar por nome" aria-label="Buscar template aprovado" className="h-10 rounded-xl border-slate-200 bg-white pl-9 shadow-none dark:border-white/10 dark:bg-white/[0.03]" />
                      </div>
                      <div className="max-h-[min(58dvh,560px)] space-y-2 overflow-y-auto pr-1 scrollbar-thin">
                        {loadingTemplates ? (
                          <div className="flex min-h-36 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando templates...</div>
                        ) : filteredTemplates.length === 0 ? (
                          <div className="flex min-h-36 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 px-4 text-center dark:border-white/10">
                            <LayoutTemplate className="mb-2 h-5 w-5 text-slate-400" /><p className="text-sm font-medium">Nenhum template encontrado</p><p className="mt-1 text-xs text-muted-foreground">Tente outro termo ou confira os templates aprovados.</p>
                          </div>
                        ) : filteredTemplates.map((template: any) => {
                          const templateBody = template.components?.find((component: any) => component.type === 'BODY')?.text || '';
                          const isSelected = selectedTemplateName === template.name;
                          return (
                            <motion.button
                              layout
                              type="button"
                              key={template.name}
                              aria-pressed={isSelected}
                              whileTap={prefersReducedMotion ? undefined : { scale: 0.985 }}
                              onClick={() => { setSelectedTemplateName(template.name); setTemplateVariables({}); }}
                              className={cn(
                                "group relative w-full overflow-hidden rounded-xl border p-3 text-left transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30",
                                isSelected ? "border-blue-500 bg-blue-50/80 shadow-[0_8px_25px_-18px_rgba(37,99,235,0.8)] dark:border-blue-400/60 dark:bg-blue-500/10" : "border-slate-200 bg-white hover:border-blue-300 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.025] dark:hover:border-blue-500/30 dark:hover:bg-white/[0.05]"
                              )}
                            >
                              {isSelected && <motion.span layoutId={`${dialogAnimationId}-selected-template-accent`} className="absolute inset-y-0 left-0 w-1 bg-blue-600 dark:bg-blue-400" />}
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-900 dark:text-white">{template.name}</p><p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-slate-500 dark:text-zinc-500">{templateBody || 'Template sem prévia de texto.'}</p></div>
                                <span className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-all", isSelected ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 text-transparent dark:border-white/15")}><Check className="h-3 w-3" /></span>
                              </div>
                              <div className="mt-2 flex items-center gap-1.5">
                                <Badge variant="secondary" className="h-5 rounded-full border-0 bg-emerald-50 px-2 text-[9px] font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">{template.category || 'Utilidade'}</Badge>
                                <span className="text-[9px] uppercase tracking-wide text-slate-400">{template.language || 'pt_BR'}</span>
                              </div>
                            </motion.button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="min-w-0 space-y-5">
                      <div><h3 className="text-sm font-semibold">Prévia</h3><p className="mt-0.5 text-xs text-slate-500 dark:text-zinc-500">Confira exatamente o que será enviado.</p></div>
                      <div className="rounded-2xl bg-[#f2eee7] p-4 dark:bg-[#151713]">
                        <AnimatePresence mode="wait" initial={false}>
                          {selectedTemplate ? (
                            <motion.div key={selectedTemplate.name} initial={prefersReducedMotion ? false : { opacity: 0, y: 8, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -5 }} className="ml-auto max-w-[92%] rounded-xl rounded-tr-sm bg-white p-3.5 text-sm leading-relaxed text-slate-800 shadow-sm dark:bg-[#202c33] dark:text-zinc-100">
                              <p className="whitespace-pre-wrap">{renderedTemplatePreview}</p><p className="mt-2 text-right text-[9px] text-slate-400">prévia</p>
                            </motion.div>
                          ) : (
                            <motion.div key="empty-preview" className="flex min-h-28 flex-col items-center justify-center text-center text-slate-500 dark:text-zinc-500"><MessageSquareQuote className="mb-2 h-5 w-5" /><p className="text-xs">Selecione um template para visualizar a mensagem.</p></motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                      <AnimatePresence initial={false}>
                        {selectedTemplate && (
                          <motion.div initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="space-y-3">
                            <div className="flex items-center justify-between gap-3">
                              <div><h3 className="text-sm font-semibold">Variáveis</h3><p className="mt-0.5 text-xs text-slate-500 dark:text-zinc-500">Personalize os campos do template.</p></div>
                              {variableKeys.length > 0 && <Badge variant="secondary" className="rounded-full text-[10px]">{variableKeys.length} campos</Badge>}
                            </div>
                            {variableKeys.length === 0 ? (
                              <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300"><CircleCheck className="h-4 w-4" /> Este template não precisa de personalização.</div>
                            ) : (
                              <div className="space-y-3">
                                {variableKeys.map((key, index) => {
                                  const value = templateVariables[key] || '';
                                  return (
                                    <motion.div key={key} initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: prefersReducedMotion ? 0 : index * 0.04 }} className="space-y-1.5">
                                      <div className="flex items-center justify-between gap-2"><Label htmlFor={`var-${key}`} className="text-xs font-medium">Variável {`{{${key}}}`}</Label>{value.trim() && <Check className="h-3.5 w-3.5 text-emerald-500" />}</div>
                                      <Input id={`var-${key}`} value={value} onChange={(event) => setTemplateVariables(previous => ({ ...previous, [key]: event.target.value }))} placeholder={`Valor para {{${key}}}`} required className="h-10 rounded-xl border-slate-200 bg-white shadow-none transition-all focus-visible:ring-blue-500/20 dark:border-white/10 dark:bg-white/[0.03]" />
                                    </motion.div>
                                  );
                                })}
                              </div>
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div key="free-message" initial={prefersReducedMotion ? false : { opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} transition={{ duration: prefersReducedMotion ? 0 : 0.22 }} className="mx-auto max-w-2xl space-y-3">
                    <div><h3 className="text-sm font-semibold">Mensagem livre</h3><p className="mt-0.5 text-xs text-slate-500 dark:text-zinc-500">Escreva a primeira mensagem do atendimento.</p></div>
                    <Textarea id="message" name="message" value={freeMessage} onChange={(event) => setFreeMessage(event.target.value)} placeholder="Olá! Gostaria de falar sobre..." required className="min-h-[240px] resize-none rounded-2xl border-slate-200 bg-white p-4 text-sm leading-relaxed shadow-none transition-all focus-visible:ring-blue-500/20 dark:border-white/10 dark:bg-white/[0.03]" />
                    <p className="text-xs text-slate-500 dark:text-zinc-500">A conversa será criada assim que a mensagem for enviada.</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </section>
          </div>
          <div className="flex shrink-0 flex-col gap-3 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-white/10 dark:bg-[#09090b]">
            <div className="flex min-w-0 items-center gap-2 text-xs text-slate-500 dark:text-zinc-500">
              <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full", canSubmit ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300" : "bg-slate-100 text-slate-400 dark:bg-white/5")}>
                {canSubmit ? <Check className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}
              </span>
              <span className="truncate">{canSubmit ? `${isTelegram ? 'Telegram' : 'WhatsApp'} • ${normalizedPhoneNumber}${isCloud && selectedTemplate ? ` • ${selectedTemplate.name}` : ''}` : 'Preencha os dados obrigatórios para iniciar a conversa.'}</span>
            </div>
            <div className="flex items-center justify-end gap-2">
              <DialogClose asChild><Button type="button" variant="ghost" className="rounded-xl px-4 text-slate-500 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white">Cancelar</Button></DialogClose>
              <motion.div whileTap={prefersReducedMotion || !canSubmit ? undefined : { scale: 0.96 }}>
                <Button type="submit" disabled={isSubmitting || !canSubmit} className="h-11 rounded-xl bg-blue-600 px-5 text-white shadow-[0_12px_30px_-16px_rgba(37,99,235,0.9)] transition-all duration-200 hover:bg-blue-700 disabled:shadow-none">
                  {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />} Iniciar conversa
                </Button>
              </motion.div>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface AgentTooltipContentProps {
  agent: OnlineAgent;
}

const AgentTooltipContent: React.FC<AgentTooltipContentProps> = ({ agent }) => {
  const [onlineSince, setOnlineSince] = React.useState('');

  React.useEffect(() => {
    if (agent.joined_at) {
      const updateOnlineTime = () => {
        const distance = formatDistanceToNow(new Date(agent.joined_at), { addSuffix: true, locale: ptBR });
        setOnlineSince(distance);
      };
      updateOnlineTime();
      const interval = setInterval(updateOnlineTime, 60000);
      return () => clearInterval(interval);
    }
  }, [agent.joined_at]);

  return (
    <div className="flex flex-col gap-1">
      <p className="font-semibold">{agent.user.name}</p>
      {onlineSince ? (
        <p className="text-xs text-muted-foreground">Online {onlineSince}</p>
      ) : (
        <p className="text-xs text-muted-foreground">Carregando...</p>
      )}
    </div>
  );
};

interface LastMessagePreviewProps {
  message: Message;
  currentUser?: User | null;
  showSender?: boolean;
}

const isMessageOutgoing = (message: Message): boolean => Boolean(
  message.from_me ||
  message.direction === 'outgoing' ||
  message.sender?.type === 'user' ||
  message.sender?.type === 'system_agent'
);

const isIncomingCustomerMessage = (message: Message): boolean => (
  message.type !== 'system' && !isMessageOutgoing(message)
);

const LastMessagePreview: React.FC<LastMessagePreviewProps> = ({ message, currentUser, showSender = false }) => {
  const { latitude, longitude, address, locationName } = message.metadata || {};
  const isLocation = typeof latitude === 'number' && typeof longitude === 'number' || message.type === 'location';
  const isMedia = message.metadata?.mediaUrl || message.metadata?.thumbnail;
  const senderName = typeof message.sender?.name === 'string' ? message.sender.name.trim() : '';
  const senderId = typeof message.sender?.id === 'string' ? message.sender.id : undefined;
  const isFromCurrentUser = Boolean(
    currentUser &&
    (
      (senderId && senderId === currentUser.id) ||
      (senderName && senderName.toLowerCase() === currentUser.name.trim().toLowerCase())
    )
  );
  const isOutgoing = isMessageOutgoing(message);

  const senderMeta = (() => {
    if (message.type === 'system') {
      return {
        label: 'Sistema',
        tone: 'text-slate-400 dark:text-zinc-400',
        icon: <MessageSquare className="h-3 w-3" />
      };
    }

    if (message.sender?.type === 'system_agent') {
      return {
        label: 'Agente',
        tone: 'text-violet-600',
        icon: <MessageSquare className="h-3 w-3" />
      };
    }

    if (isOutgoing) {
      const shortName = senderName ? senderName.split(' ')[0] : '';
      return {
        label: isFromCurrentUser || !shortName ? 'Você' : shortName,
        tone: 'text-blue-600',
        icon: <UserCheck className="h-3 w-3" />
      };
    }

    return {
      label: 'Cliente',
      tone: 'text-slate-500 dark:text-zinc-400',
      icon: <UserIcon className="h-3 w-3" />
    };
  })();

  const getIcon = () => {
    if (message.type === 'system') return null;
    if (isLocation) return <MapPin className="h-4 w-4 flex-shrink-0" />;
    if (!isMedia) return null;
    const mimetype = message.metadata?.mimetype || '';
    if (mimetype.startsWith('image/')) return <ImageIcon className="h-4 w-4 flex-shrink-0" />;
    if (mimetype.startsWith('video/')) return <Video className="h-4 w-4 flex-shrink-0" />;
    if (mimetype.startsWith('audio/')) return <Mic className="h-4 w-4 flex-shrink-0" />;
    return <File className="h-4 w-4 flex-shrink-0" />;
  };

  const getTextContent = () => {
    let text = '';
    if (message.type === 'system') text = message.content;
    else if (isLocation) {
      const coords = typeof latitude === 'number' && typeof longitude === 'number'
        ? `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`
        : null;
      text = address || locationName || (coords ? `Localização: ${coords}` : 'Localização');
    }
    else if (!isMedia && message.content) text = message.content;
    else if (isMedia && message.content && message.content.length > 0) text = message.content;
    else {
      const mimetype = message.metadata?.mimetype || '';
      if (mimetype.startsWith('image/')) text = 'Foto';
      else if (mimetype.startsWith('video/')) text = 'Vídeo';
      else if (mimetype.startsWith('audio/')) text = 'Mensagem de voz';
      else if (mimetype.includes('pdf')) text = 'Documento PDF';
      else if (message.metadata?.fileName) text = message.metadata.fileName;
      else text = 'Arquivo';
    }

    const charLimit = 35;
    if (text && text.length > charLimit) return text.substring(0, charLimit) + '...';
    return text;
  };

  return (
    <div className="flex items-center gap-1.5 overflow-hidden text-[12px] leading-[18px] text-slate-500 dark:text-zinc-400">
      <div className="flex-shrink-0 mt-0.5">
        {message.metadata?.thumbnail && typeof message.metadata.thumbnail === 'string' ? (
          <div className="relative">
            <img
              src={resolveClientMediaUrl(message.metadata.thumbnail, { kind: 'image' })}
              alt="Preview"
              className="h-5 w-5 object-cover rounded-sm"
            />
            {(message.type === 'video' || message.metadata?.mimetype?.startsWith('video/')) && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/20 rounded-sm">
                <Video className="h-3 w-3 text-white/90" />
              </div>
            )}
          </div>
        ) : (
          getIcon()
        )}
      </div>
      {showSender && (
        <span className={cn("inline-flex items-center gap-1 flex-shrink-0 text-[11px] font-semibold", senderMeta.tone)}>
          {senderMeta.icon}
          {senderMeta.label}:
        </span>
      )}
      <p className="truncate">{getTextContent()}</p>
    </div>
  );
};

interface ChatListItemProps {
  chat: Chat;
  isSelected: boolean;
  onSelect: (chat: Chat | null) => void;
  onUpdate: () => void;
  currentUser: User | null;
  showMarketing: boolean;
  isForwarding?: boolean;
  isSelectedForForwarding?: boolean;
  onToggleForwardSelection?: (chatId: string) => void;
  isBulkMode?: boolean;
  isSelectedForBulk?: boolean;
  onToggleBulkSelection?: (chatId: string) => void;
  onAssign?: (chat: Chat) => Promise<void> | void;
  onPrefetch?: (chatId: string) => void;
  priorityNow: number;
}


const getDraftPreviewText = (draft: string): string => {
  if (!draft) return '';

  return draft
    .replace(/<\/(div|p)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&nbsp;/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const ChatListItem: React.FC<ChatListItemProps> = ({ chat, isSelected, onSelect, onUpdate, currentUser, showMarketing, isForwarding, isSelectedForForwarding, onToggleForwardSelection, onToggleBulkSelection, isBulkMode, isSelectedForBulk, onAssign, onPrefetch, priorityNow }) => {
  const isMarketingChat = useMemo(() => {
    const hasMarketingMessage = chat.messages?.some((m: any) => isMarketingMessage(m as Message)) ?? false;
    // Hide marketing badge if chat is assigned to an agent OR is in 'atendimentos'/'encerrados'
    const isHandedOff = !!chat.agentId || chat.status === 'atendimentos' || chat.status === 'encerrados';
    return hasMarketingMessage && !isHandedOff;
  }, [chat.messages, chat.agentId, chat.status]);
  const visibleMessages = React.useMemo(() => {
    if (!chat.messages) return [];
    if (showMarketing) return chat.messages;
    return chat.messages.filter(m => !isMarketingMessage(m));
  }, [chat.messages, showMarketing]);
  const removeChat = useInboxStore(state => state.removeChat);
  const draft = useInboxStore(state => state.drafts[chat.id]);
  const draftPreview = useMemo(() => getDraftPreviewText(draft || ''), [draft]);
  const hasDraft = draftPreview.length > 0;
  const lastMessage = visibleMessages[visibleMessages.length - 1] || chat.messages?.[chat.messages.length - 1];
  const [isClosing, setIsClosing] = useState(false);
  const canQuickClose = chat.status !== 'atendimentos' && chat.status !== 'encerrados';
  const canAssign = chat.status === 'gerais';
  const isAssignedToIntelligentAgent = chat.assignedSystemAgent?.type === 'intelligent_attendant';
  const statusLabel = chat.status === 'encerrados' ? 'Fechado' : chat.status === 'atendimentos' ? 'Em atendimento' : 'Fila';
  const statusTone = chat.status === 'encerrados'
    ? 'border-slate-200 bg-slate-50 text-slate-500 dark:border-white/10 dark:bg-white/[0.05] dark:text-zinc-300'
    : chat.status === 'atendimentos'
      ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
      : 'border-blue-100 bg-blue-50 text-blue-700';
  const hasTag = Boolean(chat.tag);
  const tagLabel = hasTag ? chat.tag : 'Sem tag';
  // Sem cor utilizavel o chip cai para o estilo neutro do tema. Antes o fundo
  // caia para branco a 10% com texto branco: no tema claro a etiqueta
  // simplesmente sumia.
  const teamBadgeStyle = useMemo(() => badgeColorStyle(chat.teamColor), [chat.teamColor]);
  const tagBadgeStyle = useMemo(
    () => (hasTag ? badgeColorStyle(chat.color) : null),
    [hasTag, chat.color]
  );
  const classificationTags = (chat.tags || []).filter(
    (classificationTag) => !chat.team_id || !classificationTag.team_ids?.includes(chat.team_id)
  );
  const classificationTitle = classificationTags.map((tag) => tag.label).join(', ');
  const unreadCount = chat.unreadCount ?? 0;
  const hasUnread = unreadCount > 0;

  // SLA Calculation
  const isWaiting = chat.status === 'atendimentos' && lastMessage && isIncomingCustomerMessage(lastMessage);
  const waitingMinutes = isWaiting && lastMessage
    ? (priorityNow - new Date(lastMessage.createdAt || lastMessage.timestamp).getTime()) / 60000
    : 0;

  const slaStatus = isWaiting && waitingMinutes > 30
    ? 'danger'
    : isWaiting && waitingMinutes > 15
      ? 'warning'
      : null;
  const waitingMinutesRounded = Math.max(1, Math.floor(waitingMinutes));

  const handleSelect = (e?: React.MouseEvent) => {
    if (isBulkMode && onToggleBulkSelection) {
      e?.preventDefault();
      onToggleBulkSelection(chat.id);
      return;
    }
    if (isForwarding && onToggleForwardSelection) {
      e?.preventDefault();
      onToggleForwardSelection(chat.id);
      return;
    }
    onSelect(chat);
  };

  const handleQuickClose = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isClosing) return;

    // Select null if selected (to clear panel)
    if (isSelected) {
      onSelect(null);
    }

    // Optimistic UI: Remove immediately from store
    setIsClosing(true);
    removeChat(chat.id);
    toast({ title: 'Atendimento encerrado' });

    // Async server call
    const result = await guardedCloseChat(chat.id, null, null, false);

    if (!result.success) {
      // Revert/Fix if failed
      toast({ title: 'Erro ao encerrar', description: result.error, variant: 'destructive' });
      onUpdate(); // Re-sync data to restore chat
    }
  };

  const handleAssign = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onAssign) {
      await onAssign(chat);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleSelect();
    }
  };

  const prefetchTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = () => {
    if (!onPrefetch) return;
    if (prefetchTimeoutRef.current) clearTimeout(prefetchTimeoutRef.current);
    prefetchTimeoutRef.current = setTimeout(() => {
      onPrefetch(chat.id);
      prefetchTimeoutRef.current = null;
    }, 200);
  };

  const handleMouseLeave = () => {
    if (prefetchTimeoutRef.current) {
      clearTimeout(prefetchTimeoutRef.current);
      prefetchTimeoutRef.current = null;
    }
  };

  useEffect(() => () => {
    if (prefetchTimeoutRef.current) clearTimeout(prefetchTimeoutRef.current);
  }, []);

  return (
    <div
      className={cn(
        "group relative flex min-h-[84px] cursor-pointer items-start gap-2.5 overflow-hidden rounded-xl border px-3 py-2 transition-[background-color,border-color,box-shadow,transform] duration-150 active:scale-[0.995] motion-reduce:transform-none motion-reduce:transition-none",
        "border-transparent bg-card",
        "hover:border-slate-200 hover:bg-slate-50 dark:border-white/[0.06] dark:bg-white/[0.025] dark:hover:border-white/10 dark:hover:bg-white/[0.055]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30",
        isSelected && !isForwarding && !isBulkMode
          ? "border-blue-100 bg-blue-50/90 shadow-[0_8px_24px_-22px_rgba(37,99,235,0.9)] dark:border-blue-400/25 dark:bg-blue-500/10"
          : hasUnread
            ? "bg-blue-50/35 dark:bg-blue-500/[0.06]"
            : "",
        (isForwarding && isSelectedForForwarding) || (isBulkMode && isSelectedForBulk) ? "border-blue-200 bg-blue-50 dark:border-blue-400/30 dark:bg-blue-500/10" : "",
      )}
      onClick={handleSelect}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="option"
      aria-selected={isSelected}
      aria-label={`Conversa com ${chat.contact?.name || 'Desconhecido'}; ${statusLabel}`}
    >
      <div className={cn(
        "absolute inset-y-2 left-0 w-0.5 origin-center rounded-r-full bg-blue-600 transition-[opacity,transform] duration-200 motion-reduce:transition-none",
        isSelected && !isForwarding && !isBulkMode ? "scale-y-100 opacity-100" : "scale-y-50 opacity-0"
      )} />

      {/* Bulk Mode Checkbox */}
      {isBulkMode && (
        <div className={cn(
          "h-5 w-5 rounded-md border-2 flex items-center justify-center transition-all flex-shrink-0 mt-1",
          isSelectedForBulk ? "bg-primary border-primary" : "border-muted-foreground/30 group-hover:border-muted-foreground/50"
        )}>
          {isSelectedForBulk && <Check className="h-3 w-3 text-primary-foreground" />}
        </div>
      )}

      {/* Forwarding Checkbox */}
      {isForwarding && (
        <div className={cn(
          "h-5 w-5 rounded-full border-2 flex items-center justify-center transition-all flex-shrink-0 mt-1",
          isSelectedForForwarding ? "bg-primary border-primary" : "border-muted-foreground/30 group-hover:border-muted-foreground/50"
        )}>
          {isSelectedForForwarding && <Check className="h-3 w-3 text-primary-foreground" />}
        </div>
      )}

      <div className="relative mt-0.5 flex-shrink-0">
        <Avatar className={cn(
          "h-10 w-10 border shadow-sm transition-colors",
          isSelected ? "border-blue-300" : "border-slate-200 dark:border-white/10",
          hasUnread && !isSelected ? "border-blue-300" : ""
        )}>
          <AvatarImage fallbackOnBlank src={chat.contact?.avatar_url || undefined} alt={chat.contact?.name || 'Contato'} data-ai-hint="person" />
          <AvatarFallback className="bg-muted text-muted-foreground">{(chat.contact?.name || '?').charAt(0)}</AvatarFallback>
        </Avatar>
        {(() => {
          const platform = resolveChatPlatform(chat);

          let icon = <FaWhatsapp size={10} />;
          let bg = 'bg-green-500';
          let label = getChatPlatformLabel(platform);

          if (platform === 'instagram') {
            icon = <FaInstagram size={10} />;
            bg = 'bg-gradient-to-tr from-purple-500 via-pink-500 to-yellow-500';
          } else if (platform === 'messenger') {
            icon = <FaFacebookMessenger size={10} />;
            bg = 'bg-blue-500';
          } else if (platform === 'telegram') {
            icon = <FaTelegram size={10} />;
            bg = 'bg-sky-500';
          } else if (platform === 'webchat') {
            icon = <MessageCircle size={10} />;
            bg = 'bg-blue-600';
          }

          return (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className={`absolute -bottom-0.5 -right-0.5 flex h-[17px] w-[17px] items-center justify-center rounded-full border-2 border-white text-white shadow-sm ${bg}`}>
                    {icon}
                  </div>
                </TooltipTrigger>
                <TooltipContent className="bg-popover border-border text-popover-foreground">
                  <p>Canal: {label}</p>
                  {chat.instance_name && <p>Instância: {chat.instance_name}</p>}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        })()}
        {isMarketingChat && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="absolute -left-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-card bg-orange-500 text-white shadow-sm">
                  <Megaphone size={10} />
                </div>
              </TooltipTrigger>
              <TooltipContent className="bg-popover border-border text-popover-foreground">
                <p>Campanha de Marketing</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {chat.adAttribution && !isMarketingChat && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="absolute -left-1 -top-1 flex h-[17px] w-[17px] items-center justify-center rounded-full border-2 border-card bg-white shadow-sm dark:bg-zinc-900">
                  <Image
                    src="/icons/google-ads.svg"
                    alt=""
                    width={9}
                    height={9}
                    className="h-[9px] w-[9px]"
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent className="bg-popover border-border text-popover-foreground">
                <p className="font-medium">Veio de anúncio do Google Ads</p>
                {chat.adAttribution.campaign && <p>Campanha: {chat.adAttribution.campaign}</p>}
                {!chat.adAttribution.campaign && chat.adAttribution.campaignId && (
                  <p>Campanha: {chat.adAttribution.campaignId}</p>
                )}
                <p className="text-muted-foreground">
                  {chat.adAttribution.confidence === 'deterministic'
                    ? 'Confirmado pelo código de rastreio'
                    : 'Inferido pelo clique recente'}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center justify-between gap-2 min-w-0 flex-nowrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 min-w-0 flex-nowrap">
              <span className={cn(
                "h-2 w-2 flex-shrink-0 rounded-full",
                chat.status === 'encerrados' ? "bg-slate-500" : chat.status === 'atendimentos' ? "bg-emerald-400" : "bg-blue-400",
                hasUnread && "bg-blue-500"
              )} />
              <p className={cn("max-w-[78%] truncate whitespace-nowrap text-[13.5px] font-semibold tracking-tight text-slate-900 dark:text-zinc-100 min-[1280px]:max-w-[64%]", hasUnread && "font-bold")} title={chat.contact?.name}>
                {chat.contact?.name || 'Carregando...'}
              </p>
              <Badge className={cn("hidden flex-shrink-0 border px-1.5 py-0 text-[8px] font-semibold uppercase tracking-wide min-[1280px]:inline-flex", statusTone)}>
                  {statusLabel}
              </Badge>
              {isAssignedToIntelligentAgent && (
                <Badge className="flex-shrink-0 border-violet-100 bg-violet-50 px-1.5 py-0 text-[9px] text-violet-600" title={`Atendido por IA: ${chat.assignedSystemAgent?.name || 'Atendente Inteligente'}`}>
                  <Bot className="mr-1 h-3 w-3" />
                  IA
                </Badge>
              )}
            </div>
          </div>
          <div className="flex flex-shrink-0 flex-nowrap items-center justify-end gap-1.5">
            {(canAssign || canQuickClose) && !isForwarding && !isBulkMode && (
            <div className="absolute right-2 top-2 z-20 flex flex-nowrap items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 dark:border-white/10 dark:bg-zinc-950">
              {canAssign && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 rounded-md text-slate-500 hover:bg-blue-50 hover:text-blue-600 dark:text-zinc-400 dark:hover:bg-blue-500/10 dark:hover:text-blue-300"
                        aria-label="Assumir conversa"
                        onClick={handleAssign}
                      >
                        <UserCheck className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Assumir</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            {canQuickClose && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 rounded-md text-slate-500 hover:bg-red-50 hover:text-red-600 dark:text-zinc-400 dark:hover:bg-red-500/10 dark:hover:text-red-300"
                      onClick={handleQuickClose}
                      disabled={isClosing}
                    >
                      {isClosing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Encerrar sem abrir</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            </div>
            )}
            {slaStatus && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className={cn(
                        "flex h-5 w-5 items-center justify-center flex-shrink-0",
                        slaStatus === 'danger' ? "text-red-500" : "text-amber-500"
                      )}
                      aria-label={slaStatus === 'danger' ? 'SLA estourado' : 'SLA em alerta'}
                    >
                      <AlertTriangle className="h-3.5 w-3.5" />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{slaStatus === 'danger' ? 'SLA estourado' : 'SLA em alerta'}</p>
                    <p>Aguardando resposta ha {waitingMinutesRounded} min</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {lastMessage && (
              <p className="flex-shrink-0 whitespace-nowrap text-[10px] font-medium text-slate-400 dark:text-zinc-500">
                {formatMessageTime(lastMessage.createdAt || lastMessage.timestamp, currentUser?.activeWorkspaceTimezone || 'America/Sao_Paulo')}
              </p>
            )}
          </div>
        </div>

        <div className="flex min-h-[15px] flex-nowrap items-center gap-1.5 overflow-hidden">
          {chat.status === 'atendimentos' && chat.teamName ? (
            <Badge
              style={teamBadgeStyle ?? undefined}
              className={cn(
                "flex max-w-[55%] flex-shrink items-center gap-1 truncate border px-1.5 py-0 text-[9px] font-medium",
                teamBadgeStyle ? "shadow-sm" : NEUTRAL_BADGE_CLASS
              )}
              title={chat.teamName}
            >
              <Users className="h-3 w-3" />
              {chat.teamName}
            </Badge>
          ) : (
            <Badge
              style={tagBadgeStyle ?? undefined}
              className={cn(
                "max-w-[55%] flex-shrink truncate border px-1.5 py-0 text-[9px]",
                tagBadgeStyle ? "shadow-sm" : NEUTRAL_BADGE_CLASS
              )}
              title={hasTag ? chat.tag : 'Sem tag'}
            >
              {tagLabel}
            </Badge>
          )}
          {isMarketingChat && (
            <Badge
              variant="secondary"
              className="flex flex-shrink-0 items-center gap-1 border-orange-100 bg-orange-50 px-1.5 py-0 text-[9px] font-medium text-orange-600"
            >
              <Megaphone className="h-3 w-3" />
              Marketing
            </Badge>
          )}
          {classificationTags.length > 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="flex min-w-0 items-center gap-1"
                    aria-label={`${classificationTags.length} etiquetas: ${classificationTitle}`}
                  >
                    {classificationTags.slice(0, 2).map((tag) => (
                      <span
                        key={tag.id}
                        className="flex h-[18px] max-w-[78px] shrink items-center gap-1 truncate rounded-full border px-1.5 text-[9px] font-medium text-slate-600 dark:text-zinc-300"
                        style={{ borderColor: `${tag.color}30`, backgroundColor: `${tag.color}0d` }}
                      >
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
                        <span className="truncate">{tag.label}</span>
                      </span>
                    ))}
                    {classificationTags.length > 2 && (
                      <span className="flex h-[18px] shrink-0 items-center rounded-md bg-slate-100 px-1.5 text-[9px] font-semibold text-slate-500 dark:bg-white/[0.06] dark:text-zinc-400">
                        +{classificationTags.length - 2}
                      </span>
                    )}
                  </span>
                </TooltipTrigger>
                <TooltipContent>{classificationTitle}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>

        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="flex-1 min-w-0">
            {hasDraft ? (
              <p className="flex items-center gap-1 truncate text-[12px] font-medium text-amber-600">
                <PencilLine className="h-3 w-3" />
                <span className="font-bold">[Rascunho]:</span> {draftPreview}
              </p>
            ) : (
              lastMessage ? <LastMessagePreview message={lastMessage} currentUser={currentUser} showSender={chat.status === 'atendimentos'} /> : <div className="h-[18px]" />
            )}
          </div>
          {(() => {
            const unread = unreadCount;
            if (unread <= 0) return null;
            return (
              <Badge className="h-[18px] min-w-[18px] flex-shrink-0 justify-center rounded-full border-0 bg-blue-600 px-1 text-[9px] font-bold text-white">
                {unread > 99 ? '99+' : unread}
              </Badge>
            );
          })()}
        </div>
      </div>
    </div>
  );
};

type ChatPriorityGroupId = 'risk' | 'waiting' | 'recent';

const CHAT_PRIORITY_GROUPS: Record<ChatPriorityGroupId, { label: string; tone: string; countTone: string }> = {
  risk: {
    label: 'Em risco',
    tone: 'text-red-600',
    countTone: 'bg-red-50 text-red-600 ring-red-100',
  },
  waiting: {
    label: 'Aguardando',
    tone: 'text-amber-600',
    countTone: 'bg-amber-50 text-amber-700 ring-amber-100',
  },
  recent: {
    label: 'Recentes',
    tone: 'text-slate-600 dark:text-zinc-400',
    countTone: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-white/[0.06] dark:text-zinc-300 dark:ring-white/10',
  },
};

const getChatPriorityGroup = (chat: Chat, now = Date.now()): ChatPriorityGroupId => {
  if (chat.status === 'encerrados') return 'recent';

  const messages = chat.messages || [];
  const lastMessage = messages[messages.length - 1];
  const waitingForAgent = Boolean(
    chat.status === 'atendimentos' &&
    lastMessage &&
    isIncomingCustomerMessage(lastMessage)
  );
  const lastMessageTime = lastMessage
    ? new Date(lastMessage.createdAt || lastMessage.timestamp).getTime()
    : 0;
  const waitingMinutes = waitingForAgent && Number.isFinite(lastMessageTime)
    ? (now - lastMessageTime) / 60000
    : 0;

  if (waitingForAgent && waitingMinutes > 15) return 'risk';
  if (waitingForAgent || (chat.unreadCount ?? 0) > 0) return 'waiting';
  return 'recent';
};

const NEUTRAL_BADGE_CLASS = 'border-border/70 bg-muted/40 text-muted-foreground';

const getChatItemKey = (_index: number, chat: Chat) => chat.id;

const MemoizedChatListItem = React.memo(ChatListItem);

interface ChatListProps {
  chats: Chat[];
  selectedChat: Chat | null;
  setSelectedChat: (chat: Chat | null) => void;
  currentUser: User;
  onUpdate: () => void;
  ownershipFilter?: 'mine' | 'everyone';
  onOwnershipFilterChange?: (filter: 'mine' | 'everyone') => void;
  isForwarding?: boolean;
  selectedForwardingChatIds?: Set<string>;
  onToggleForwardSelection?: (chatId: string) => void;
  onSelectAllForwarding?: (chatIds: string[]) => void;
  onConfirmForward?: () => void;
  onCancelForward?: () => void;
  onPrefetch?: (chatId: string) => void;
  className?: string;
  loadMore?: (options?: { statuses?: Chat['status'][], ownership?: 'mine' | 'everyone', filters?: InboxListFilters }) => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  bottomPadding?: number;
}

type ChatListTabId = 'robo' | 'gerais' | 'atendimentos' | 'encerrados';


export default function ChatList({ chats, selectedChat, setSelectedChat, currentUser, onUpdate, ownershipFilter: controlledOwnershipFilter, onOwnershipFilterChange, isForwarding, selectedForwardingChatIds, onToggleForwardSelection, onSelectAllForwarding, onConfirmForward, onCancelForward, onPrefetch, className, loadMore, hasMore, isLoadingMore, bottomPadding }: ChatListProps) {
  const { onlineAgents, isOffline } = usePresence();
  const [selectedAgent, setSelectedAgent] = useState<OnlineAgent['user'] | null>(null);
  const visibleOnlineAgents = useMemo(
    () => onlineAgents.slice(0, MAX_VISIBLE_ONLINE_AGENTS),
    [onlineAgents]
  );
  const hiddenOnlineAgents = useMemo(
    () => onlineAgents.slice(MAX_VISIBLE_ONLINE_AGENTS),
    [onlineAgents]
  );
  const [searchTerm, setSearchTerm] = useState('');
  const [submittedSearchQuery, setSubmittedSearchQuery] = useState('');
  const debouncedSearchTerm = useDebouncedValue(searchTerm, 300);
  const [isSearchDialogOpen, setIsSearchDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ChatListTabId>('gerais');
  const [priorityNow, setPriorityNow] = useState(() => Date.now());
  const [uncontrolledOwnershipFilter, setUncontrolledOwnershipFilter] = useState<'mine' | 'everyone'>('mine');
  const ownershipFilter = controlledOwnershipFilter ?? uncontrolledOwnershipFilter;
  const updateOwnershipFilter = useCallback((next: 'mine' | 'everyone') => {
    if (controlledOwnershipFilter === undefined) {
      setUncontrolledOwnershipFilter(next);
    }
    onOwnershipFilterChange?.(next);
  }, [controlledOwnershipFilter, onOwnershipFilterChange]);
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'closed'>('all');
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [showUnassignedOnly, setShowUnassignedOnly] = useState(false);
  const [showMarketing, setShowMarketing] = useState(false);
  const [isFiltering, setIsFiltering] = useState(false);

  const selectInboxTab = useCallback((tab: ChatListTabId) => {
    setActiveTab(tab);
    // A aba já define o status principal. Não deixe um filtro global
    // contraditório tornar a aba recém-selecionada vazia.
    setStatusFilter((current) => resolveInboxStatusFilterForTab(tab, current));
  }, []);

  const [teams, setTeams] = useState<Team[]>([]);
  const [isLoadingTeams, setIsLoadingTeams] = useState(false);
  const [teamFilter, setTeamFilter] = useState<string[]>([]);
  const [isTeamFilterOpen, setIsTeamFilterOpen] = useState(false);
  const [teamSearchTerm, setTeamSearchTerm] = useState('');
  const [workspaceUsers, setWorkspaceUsers] = useState<User[]>([]);
  const [isLoadingWorkspaceUsers, setIsLoadingWorkspaceUsers] = useState(false);
  const [responsibleFilter, setResponsibleFilter] = useState<string | null>(null);
  const [isResponsibleFilterOpen, setIsResponsibleFilterOpen] = useState(false);
  const [responsibleSearchTerm, setResponsibleSearchTerm] = useState('');

  const hasMoreChats = useInboxStore((state) => state.hasMoreChats);
  const inboxCounts = useInboxStore((state) => state.inboxCounts);
  const chatPagination = useInboxStore((state) => state.chatPagination);
  const replaceChatsForStatus = useInboxStore((state) => state.replaceChatsForStatus);
  const replaceChatsForQueueScope = useInboxStore((state) => state.replaceChatsForQueueScope);
  const setInboxCounts = useInboxStore((state) => state.setInboxCounts);
  const setChatPagination = useInboxStore((state) => state.setChatPagination);

  const filterRequestSeqRef = React.useRef(0);

  const [isBulkMode, setIsBulkMode] = useState(false);
  const [bulkAction, setBulkAction] = useState<'close' | 'agent' | null>(null);
  const [selectedBulkChats, setSelectedBulkChats] = useState<Set<string>>(new Set());
  const [isBulkDialogOpen, setIsBulkDialogOpen] = useState(false);
  const [bulkMessage, setBulkMessage] = useState('');
  const [isBulkSubmitting, setIsBulkSubmitting] = useState(false);
  const [autopilotAgents, setAutopilotAgents] = useState<AutopilotConfig[]>([]);
  const [selectedBulkAgentId, setSelectedBulkAgentId] = useState<string>('');
  const [isAgentBulkConfigOpen, setIsAgentBulkConfigOpen] = useState(false);
  const [bulkAgentStatus, setBulkAgentStatus] = useState(true);
  const [bulkAgentMode, setBulkAgentMode] = useState<'suggest' | 'auto'>('suggest');

  useEffect(() => {
    const refreshPriorityClock = () => setPriorityNow(Date.now());
    const intervalId = window.setInterval(refreshPriorityClock, PRIORITY_REEVALUATION_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshPriorityClock();
    };

    window.addEventListener('focus', refreshPriorityClock);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refreshPriorityClock);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const handleSubmitSearch = useCallback(() => {
    const query = searchTerm.trim();
    if (!query) return;

    setSubmittedSearchQuery(query);
    setIsSearchDialogOpen(true);
    setSearchTerm('');
  }, [searchTerm]);

  // Assign Confirmation State
  const [chatToAssign, setChatToAssign] = useState<Chat | null>(null);

  const toggleBulkMode = (action: 'close' | 'agent' = 'close') => {
    if (isBulkMode && bulkAction === action) {
      setIsBulkMode(false);
      setBulkAction(null);
      setSelectedBulkChats(new Set());
    } else if (action === 'agent') {
      setIsAgentBulkConfigOpen(true);
    } else {
      setIsBulkMode(true);
      setBulkAction(action);
      setSelectedBulkChats(new Set());
    }
  };

  const handleToggleBulkSelection = useCallback((chatId: string) => {
    setSelectedBulkChats((current) => {
      const next = new Set(current);
      if (next.has(chatId)) next.delete(chatId);
      else next.add(chatId);
      return next;
    });
  }, []);

  const handleSelectAllBulk = () => {
    if (filteredChats.length === 0) return;
    const allIds = filteredChats.map(c => c.id);
    const allSelected = allIds.every(id => selectedBulkChats.has(id));

    if (allSelected) {
      setSelectedBulkChats(new Set());
    } else {
      setSelectedBulkChats(new Set(allIds));
    }
  };

  const toggleTeamSelection = useCallback((teamId: string) => {
    if (ownershipFilter !== 'everyone') {
      updateOwnershipFilter('everyone');
    }
    setTeamFilter((prev) => {
      return prev.includes(teamId)
        ? prev.filter((id) => id !== teamId)
        : [...prev, teamId];
    });
  }, [ownershipFilter, updateOwnershipFilter]);

  const selectResponsible = useCallback((userId: string | null) => {
    setResponsibleFilter(userId);
    if (userId) {
      setShowUnassignedOnly(false);
      if (ownershipFilter !== 'everyone') updateOwnershipFilter('everyone');
    }
    setIsResponsibleFilterOpen(false);
    setResponsibleSearchTerm('');
  }, [ownershipFilter, updateOwnershipFilter]);

  const clearAdvancedFilters = useCallback(() => {
    setTeamFilter([]);
    setResponsibleFilter(null);
    setStatusFilter('all');
    setShowUnassignedOnly(false);
    setShowMarketing(false);
  }, []);

  const handleBulkSubmit = async () => {
    if (selectedBulkChats.size === 0) return;
    setIsBulkSubmitting(true);

    const chatIds = Array.from(selectedBulkChats);
    let successCount = 0;

    for (const chatId of chatIds) {
      try {
        const result = await closeMultipleChatsAction([chatId], bulkMessage);
        if (result.success) {
          successCount++;
        }
      } catch (err) {
        console.error(`Falha ao encerrar chat ${chatId}`, err);
      }
    }

    if (successCount > 0) {
      toast({ title: `Concluído`, description: `${successCount} atendimentos foram encerrados.` });
      setIsBulkDialogOpen(false);
      setBulkMessage('');
      setSelectedBulkChats(new Set());
      setIsBulkMode(false);
      onUpdate();
    } else {
      toast({ title: 'Erro', description: 'Não foi possível encerrar os atendimentos selecionados.', variant: 'destructive' });
    }

    setIsBulkSubmitting(false);
  };

  const handleBulkAgentToggle = async () => {
    if (selectedBulkChats.size === 0) return;
    if (bulkAgentStatus && !selectedBulkAgentId) {
      toast({ title: 'Selecione um Agente', description: 'Você precisa escolher um agente para ativar.', variant: 'destructive' });
      return;
    }

    setIsBulkSubmitting(true);
    const chatIds = Array.from(selectedBulkChats);

    try {
      const result = await toggleMultipleChatsAutopilotAction(
        chatIds, 
        bulkAgentStatus, 
        selectedBulkAgentId || null,
        bulkAgentStatus ? bulkAgentMode : 'off'
      );
      if (result.success) {
        toast({ 
          title: bulkAgentStatus ? 'Agentes Ativados' : 'Agentes Desativados', 
          description: `${chatIds.length} conversas foram atualizadas.` 
        });
        setSelectedBulkChats(new Set());
        setIsBulkMode(false);
        setBulkAction(null);
        onUpdate();
      } else {
        toast({ title: 'Erro', description: result.error || 'Falha ao atualizar agentes.', variant: 'destructive' });
      }
    } catch (err) {
      console.error('Erro bulk agent:', err);
      toast({ title: 'Erro crítico', description: 'Ocorreu um erro ao processar a ação em massa.', variant: 'destructive' });
    } finally {
      setIsBulkSubmitting(false);
    }
  };

  const handleAssignChat = useCallback((chat: Chat) => {
    setChatToAssign(chat);
  }, []);

  const confirmAssignChat = async () => {
    if (!chatToAssign) return;
    const result = await guardedAssignChat(chatToAssign.id);

    if (result.success) {
      toast({ title: 'Assumiu atendimento', description: `${chatToAssign.contact.name} agora está com você.` });
      if ((result as any).chat) {
        useInboxStore.getState().upsertChats([(result as any).chat]);
      }
      onUpdate();
    } else {
      toast({ title: 'Não foi possível assumir', description: result.error || 'Erro desconhecido', variant: 'destructive' });
    }
    setChatToAssign(null);
  };

  useEffect(() => {
    if (currentUser.activeWorkspaceId) {
      setIsLoadingTeams(true);
      getTeams(currentUser.activeWorkspaceId)
        .then((res) => {
          if (res.teams) {
            setTeams(res.teams);
          }
        })
        .finally(() => setIsLoadingTeams(false));

      setIsLoadingWorkspaceUsers(true);
      getWorkspaceUsers(currentUser.activeWorkspaceId)
        .then((res) => {
          if (res.users) setWorkspaceUsers(res.users);
        })
        .finally(() => setIsLoadingWorkspaceUsers(false));

      // Fetch autopilot agents
      import('@/actions/autopilot').then(({ getAutopilotConfig }) => {
        getAutopilotConfig(currentUser.activeWorkspaceId!)
          .then((res: any) => {
            if (res.agents) {
              setAutopilotAgents(res.agents);
              const primary = res.agents.find((a: any) => a.is_primary) || res.agents[0];
              if (primary) setSelectedBulkAgentId(primary.id);
            }
          });
      });
    }
  }, [currentUser.activeWorkspaceId]);

  const activeStatus: Chat['status'] = activeTab === 'encerrados'
    ? 'encerrados'
    : activeTab === 'atendimentos'
      ? 'atendimentos'
      : 'gerais';
  const serverFilters = useMemo<InboxListFilters>(() => scopeInboxListFilters(activeTab, {
    teamIds: teamFilter,
    responsibleId: responsibleFilter,
    onlyUnread,
    unassignedOnly: showUnassignedOnly,
    // Esta opção controla apenas o preview. Uma troca de aba nunca deve remover
    // o atendimento inteiro por a última mensagem ser de marketing.
    includeMarketing: true,
  }), [activeTab, onlyUnread, responsibleFilter, showUnassignedOnly, teamFilter]);

  useEffect(() => {
    const fetchFilteredChats = async () => {
      if (!currentUser.activeWorkspaceId) return;
      const requestSeq = ++filterRequestSeqRef.current;
      setIsFiltering(true);
      try {
        const data = await getInboxChatsSnapshotAction({
          workspaceId: currentUser.activeWorkspaceId,
          status: activeStatus,
          ownership: ownershipFilter,
          filters: serverFilters,
        });

        if (requestSeq !== filterRequestSeqRef.current) {
          return;
        }

        if (!data.success) {
          toast({ title: 'Erro ao filtrar', description: data.error, variant: 'destructive' });
        } else {
          if (activeStatus === 'gerais' && serverFilters.queueScope) {
            replaceChatsForQueueScope(serverFilters.queueScope, data.chats);
          } else {
            replaceChatsForStatus(activeStatus, data.chats);
          }
          if (data.counts) setInboxCounts(data.counts);
          if (data.pagination) setChatPagination(activeTab, data.pagination);
        }
      } catch (err) {
        if (requestSeq !== filterRequestSeqRef.current) {
          return;
        }
        console.error(err);
        toast({ title: 'Erro ao filtrar', description: 'Falha ao buscar conversas.', variant: 'destructive' });
      } finally {
        if (requestSeq === filterRequestSeqRef.current) {
          setIsFiltering(false);
        }
      }
    };

    fetchFilteredChats();
  }, [
    activeStatus,
    activeTab,
    currentUser.activeWorkspaceId,
    ownershipFilter,
    replaceChatsForQueueScope,
    replaceChatsForStatus,
    serverFilters,
    setChatPagination,
    setInboxCounts,
  ]);

  const sortedChats = useMemo(() => {
    const sorted = [...chats].sort((a, b) => {
      const msgsA = a.messages || [];
      const msgsB = b.messages || [];
      const timeA = msgsA.length > 0 ? new Date(msgsA[msgsA.length - 1].createdAt).getTime() : (a.updatedAt ? new Date(a.updatedAt).getTime() : 0);
      const timeB = msgsB.length > 0 ? new Date(msgsB[msgsB.length - 1].createdAt).getTime() : (b.updatedAt ? new Date(b.updatedAt).getTime() : 0);
      return timeB - timeA;
    });

    const queueChats = sorted.filter((c) => c.status === 'gerais');
    const robo = queueChats.filter((c) => isChatInInboxQueueScope(c, 'robo'));
    const fila = queueChats.filter((c) => isChatInInboxQueueScope(c, 'fila'));
    const atendimentos = sorted.filter((c) => c.status === 'atendimentos');
    const encerrados = sorted.filter((c) => c.status === 'encerrados');

    return { robo, fila, atendimentos, encerrados };
  }, [chats]);

  const tabs = useMemo(() => [
    { id: 'robo', label: 'Robô', shortLabel: 'Robô', icon: Bot, data: sortedChats.robo },
    { id: 'gerais', label: 'Fila', shortLabel: 'Fila', icon: ListTodo, data: sortedChats.fila },
    { id: 'atendimentos', label: 'Atendendo', shortLabel: 'Atend.', icon: MessageSquare, data: sortedChats.atendimentos },
    { id: 'encerrados', label: 'Encerrados', shortLabel: 'Encerr.', icon: CheckCircle2, data: sortedChats.encerrados }
  ] as const, [sortedChats]);

  const filteredChatsByTab = useMemo(() => {
    const query = debouncedSearchTerm.trim().toLocaleLowerCase('pt-BR');

    const matchesControls = (chat: Chat) => {
      const messages = chat.messages || [];
      let matchesMessageContent = false;

      for (const message of messages) {
        if (!showMarketing && isMarketingMessage(message)) continue;
        if (query && !matchesMessageContent && (message.content || '').toLocaleLowerCase('pt-BR').includes(query)) {
          matchesMessageContent = true;
        }
      }

      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'open' ? chat.status !== 'encerrados' : chat.status === 'encerrados');

      const chatAgentId = chat.agent?.id || chat.agentId;
      const chatSystemAgentId = chat.assigned_system_agent_id || chat.assignedSystemAgent?.id;
      const matchesTeam = matchesChatTeamFilter(chat, teams, teamFilter);

      const matchesOwner = responsibleFilter && isOwnershipScopedChat(chat)
        ? chatAgentId === responsibleFilter
        : isChatVisibleForOwnership(chat, ownershipFilter, currentUser.id);

      const matchesUnread = !onlyUnread || (chat.unreadCount ?? 0) > 0;
      const matchesUnassigned = !showUnassignedOnly || (!chatAgentId && !chatSystemAgentId);
      const matchesAssignmentFilters = !isOwnershipScopedChat(chat)
        || (matchesStatus && matchesOwner && matchesTeam && matchesUnread && matchesUnassigned);
      let matchesSearch = true;

      if (query) {
        const protocol = chat.protocol || buildChatProtocol(chat.id);
        matchesSearch =
          (chat.contact.name || '').toLocaleLowerCase('pt-BR').includes(query) ||
          (chat.contact.phone || '').includes(query) ||
          (protocol || '').toLocaleLowerCase('pt-BR').includes(query) ||
          (chat.id || '').toLocaleLowerCase('pt-BR').includes(query) ||
          matchesMessageContent;
      }

      return matchesAssignmentFilters && matchesSearch;
    };

    return {
      robo: sortedChats.robo.filter(matchesControls),
      gerais: sortedChats.fila.filter(matchesControls),
      atendimentos: sortedChats.atendimentos.filter(matchesControls),
      encerrados: sortedChats.encerrados.filter(matchesControls),
    } satisfies Record<ChatListTabId, Chat[]>;
  }, [
    currentUser.id,
    debouncedSearchTerm,
    onlyUnread,
    ownershipFilter,
    responsibleFilter,
    showMarketing,
    showUnassignedOnly,
    sortedChats,
    statusFilter,
    teamFilter,
    teams,
  ]);

  const filteredChats = filteredChatsByTab[activeTab];
  const isOwnershipFilterVisible = isInboxAssignmentFilterTab(activeTab);
  const loadedTabCounts = useMemo(() => ({
    robo: filteredChatsByTab.robo.length,
    gerais: filteredChatsByTab.gerais.length,
    atendimentos: filteredChatsByTab.atendimentos.length,
    encerrados: filteredChatsByTab.encerrados.length,
  }), [filteredChatsByTab]);

  const hasClientOnlyCountFilters = Boolean(debouncedSearchTerm.trim());
  const tabCounts = useMemo(() => {
    if (!inboxCounts || hasClientOnlyCountFilters) return loadedTabCounts;

    const counts = {
      robo: inboxCounts.robo,
      gerais: inboxCounts.gerais,
      atendimentos: inboxCounts.atendimentos,
      encerrados: inboxCounts.encerrados,
    };

    if (statusFilter === 'open') counts.encerrados = 0;
    if (statusFilter === 'closed') {
      counts.robo = 0;
      counts.gerais = 0;
      counts.atendimentos = 0;
    }

    return counts;
  }, [
    hasClientOnlyCountFilters,
    inboxCounts,
    loadedTabCounts,
    statusFilter,
  ]);

  const { groupedChats, priorityGroupCounts } = useMemo(() => {
    const buckets: Record<ChatPriorityGroupId, Chat[]> = {
      risk: [],
      waiting: [],
      recent: [],
    };

    filteredChats.forEach((chat) => {
      buckets[getChatPriorityGroup(chat, priorityNow)].push(chat);
    });

    return {
      groupedChats: [...buckets.risk, ...buckets.waiting, ...buckets.recent],
      priorityGroupCounts: {
        risk: buckets.risk.length,
        waiting: buckets.waiting.length,
        recent: buckets.recent.length,
      },
    };
  }, [filteredChats, priorityNow]);

  const chatListContentVersion = `${activeTab}:${groupedChats.length}:${groupedChats[0]?.id || 'empty'}:${groupedChats[groupedChats.length - 1]?.id || 'empty'}`;
  const { scrollerRef: premiumWheelScrollerRef } = usePremiumWheelScroller(
    Boolean(isLoadingMore),
    chatListContentVersion
  );

  const areAllForwardingChatsSelected = useMemo(
    () => (
      filteredChats.length > 0 &&
      filteredChats.every((chat) => selectedForwardingChatIds?.has(chat.id))
    ),
    [filteredChats, selectedForwardingChatIds]
  );

  const handleSelectAllForwarding = useCallback(() => {
    onSelectAllForwarding?.(filteredChats.map((chat) => chat.id));
  }, [filteredChats, onSelectAllForwarding]);

  const filteredTeamsBySearch = useMemo(() => {
    const query = teamSearchTerm.trim().toLowerCase();
    if (!query) return teams;
    return teams.filter((team) => team.name.toLowerCase().includes(query));
  }, [teams, teamSearchTerm]);

  const filteredWorkspaceUsers = useMemo(() => {
    const query = responsibleSearchTerm.trim().toLocaleLowerCase('pt-BR');
    if (!query) return workspaceUsers;
    return workspaceUsers.filter((user) =>
      `${user.name || ''} ${user.email || ''}`.toLocaleLowerCase('pt-BR').includes(query)
    );
  }, [responsibleSearchTerm, workspaceUsers]);

  const selectedResponsible = useMemo(
    () => workspaceUsers.find((user) => user.id === responsibleFilter) || null,
    [responsibleFilter, workspaceUsers]
  );

  const selectedTeams = useMemo(
    () => teams.filter((team) => teamFilter.includes(team.id)),
    [teamFilter, teams]
  );

  const advancedFilterCount = isOwnershipFilterVisible
    ? teamFilter.length
      + (responsibleFilter ? 1 : 0)
      + (statusFilter !== 'all' ? 1 : 0)
      + (showUnassignedOnly ? 1 : 0)
      + (showMarketing ? 1 : 0)
    : 0;

  const paginationCounts = inboxCounts ?? loadedTabCounts;
  const paginationScope = getInboxPaginationScope(activeTab, paginationCounts);
  const loadedInPaginationScope = loadedTabCounts[activeTab];
  const canLoadMore = Boolean(loadMore) && !isLoadingMore && !isFiltering && (
    inboxCounts
      ? hasMoreChatsInScope({
        loaded: loadedInPaginationScope,
        total: paginationScope.total,
        paginationHasMore: chatPagination[paginationScope.tab].hasMore,
      })
      : (hasMore ?? hasMoreChats)
  );
  const handleEndReached = useCallback(() => {
    if (!canLoadMore) return;
    loadMore?.({
      statuses: [paginationScope.status],
      ownership: ownershipFilter,
      filters: serverFilters,
    });
  }, [canLoadMore, loadMore, ownershipFilter, paginationScope.status, serverFilters]);

  const virtuosoComponents = useMemo(() => ({
    Header: () => <div className="h-1" />,
    Footer: () => <div style={{ height: (bottomPadding || 0) + 8 }} />,
  }), [bottomPadding]);

  const renderChatItem = useCallback((index: number, chat: Chat) => {
    const groupId: ChatPriorityGroupId = index < priorityGroupCounts.risk
      ? 'risk'
      : index < priorityGroupCounts.risk + priorityGroupCounts.waiting
        ? 'waiting'
        : 'recent';
    const group = CHAT_PRIORITY_GROUPS[groupId];
    const showGroupHeader = index === 0
      || index === priorityGroupCounts.risk
      || index === priorityGroupCounts.risk + priorityGroupCounts.waiting;

    return (
      <div className="px-3 pb-0.5">
        {showGroupHeader && (
          <div className="flex items-center justify-between px-1 pb-1.5 pt-3 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:duration-200">
            <p className={cn("text-[10px] font-bold uppercase tracking-[0.12em]", group.tone)}>
              {group.label}
            </p>
            <span className={cn(
              "flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[9px] font-bold ring-1 ring-inset",
              group.countTone
            )}>
              {priorityGroupCounts[groupId]}
            </span>
          </div>
        )}
        <MemoizedChatListItem
          chat={chat}
          isSelected={selectedChat?.id === chat.id}
          onSelect={setSelectedChat}
          onUpdate={onUpdate}
          currentUser={currentUser}
          showMarketing={showMarketing}
          isForwarding={isForwarding}
          isSelectedForForwarding={selectedForwardingChatIds?.has(chat.id)}
          onToggleForwardSelection={onToggleForwardSelection}
          isBulkMode={isBulkMode}
          isSelectedForBulk={selectedBulkChats.has(chat.id)}
          onToggleBulkSelection={handleToggleBulkSelection}
          onAssign={chat.status === 'gerais' ? handleAssignChat : undefined}
          onPrefetch={onPrefetch}
          priorityNow={priorityNow}
        />
      </div>
    );
  }, [
    currentUser,
    handleAssignChat,
    handleToggleBulkSelection,
    isBulkMode,
    isForwarding,
    onPrefetch,
    onToggleForwardSelection,
    onUpdate,
    priorityGroupCounts,
    priorityNow,
    selectedBulkChats,
    selectedChat?.id,
    selectedForwardingChatIds,
    setSelectedChat,
    showMarketing,
  ]);

  return (
    <div
      className={cn(
        "inbox-chat-list flex h-full w-full shrink-0 flex-col border-r border-slate-200 bg-white transition-none dark:border-white/10 dark:bg-[#050507]",
        "md:w-[clamp(320px,29vw,460px)] md:min-w-[320px] md:max-w-[460px]",
        className
      )}
    >
      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex-shrink-0 space-y-3 border-b border-slate-200 bg-white px-4 pb-3 pt-4 dark:border-white/10 dark:bg-[#050507]">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-slate-950 dark:text-white">Inbox</h2>
            <p className="mt-0.5 text-[11px] font-medium text-slate-400 dark:text-zinc-500">Central de conversas</p>
          </div>
          <div className="flex items-center gap-2">
            {activeTab === 'atendimentos' && !isForwarding && (
              <div className="flex items-center gap-1.5 bg-muted/40 p-1 rounded-lg">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={isBulkMode && bulkAction === 'close' ? "secondary" : "ghost"}
                        size="icon"
                        className={cn(
                          "h-7 w-7 text-muted-foreground transition-[background-color,color,transform] duration-150 hover:bg-muted hover:text-foreground active:scale-90 motion-reduce:transform-none motion-reduce:transition-none",
                          isBulkMode && bulkAction === 'close' && "bg-red-500/20 text-red-600 hover:bg-red-500/30 hover:text-red-700"
                        )}
                        onClick={() => toggleBulkMode('close')}
                      >
                        <Check className="h-[15px] w-[15px]" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {isBulkMode && bulkAction === 'close' ? "Sair da seleção" : "Encerrar em massa"}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={isBulkMode && bulkAction === 'agent' ? "secondary" : "ghost"}
                        size="icon"
                        className={cn(
                          "h-7 w-7 text-muted-foreground transition-[background-color,color,transform] duration-150 hover:bg-muted hover:text-foreground active:scale-90 motion-reduce:transform-none motion-reduce:transition-none",
                          isBulkMode && bulkAction === 'agent' && "bg-blue-500/20 text-blue-600 hover:bg-blue-500/30 hover:text-blue-700"
                        )}
                        onClick={() => toggleBulkMode('agent')}
                      >
                        <Bot className="h-[15px] w-[15px]" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {isBulkMode && bulkAction === 'agent' ? "Sair da seleção" : "Ativar Agente em massa"}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            )}

            {currentUser.activeWorkspaceId && (
              <NewConversationDialog
                workspaceId={currentUser.activeWorkspaceId}
                onActionSuccess={onUpdate}
                trigger={
                  <Button size="sm" className="h-9 rounded-lg border-0 bg-blue-600 px-3 text-white shadow-sm transition-colors hover:bg-blue-700">
                    <PlusCircle className="mr-1.5 h-4 w-4" />
                    Nova
                  </Button>
                }
              />
            )}
          </div>
        </div>
        <div className="grid grid-cols-4 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-white/[0.05]" role="tablist" aria-label="Status das conversas">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const loadedCount = loadedTabCounts[tab.id];
            const totalCount = tabCounts[tab.id];
            const countDescription = loadedCount === totalCount
              ? `${loadedCount.toLocaleString('pt-BR')} conversas carregadas`
              : `${loadedCount.toLocaleString('pt-BR')} de ${totalCount.toLocaleString('pt-BR')} conversas carregadas`;

            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                aria-label={`${tab.label}: ${countDescription}`}
                onClick={() => selectInboxTab(tab.id)}
                className={cn(
                  "relative flex h-9 min-w-0 items-center justify-center gap-1 rounded-lg px-1 text-[10px] font-semibold transition-[background-color,color,box-shadow,transform] duration-200 active:scale-[0.97] motion-reduce:transform-none motion-reduce:transition-none",
                  activeTab === tab.id
                    ? "bg-white text-blue-700 shadow-sm ring-1 ring-slate-200 dark:bg-white/10 dark:text-blue-300 dark:ring-white/10"
                    : "text-slate-500 hover:bg-white/70 hover:text-slate-800 dark:text-zinc-400 dark:hover:bg-white/[0.06] dark:hover:text-zinc-100"
                )}
              >
                <Icon className="hidden h-3 w-3 flex-shrink-0 min-[1400px]:block" />
                <span className="truncate min-[1400px]:hidden">{tab.shortLabel}</span>
                <span className="hidden truncate min-[1400px]:inline">{tab.label}</span>
                <span className={cn(
                  "flex min-w-[16px] flex-shrink-0 items-center justify-center rounded-full px-1 text-[8px] leading-4",
                  activeTab === tab.id ? "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300" : "bg-slate-200 text-slate-600 dark:bg-white/[0.08] dark:text-zinc-400"
                )} title={countDescription}>
                  {formatInboxCount(loadedCount)}
                </span>
              </button>
            );
          })}
        </div>
        <div>
          <InboxSearchInput
            aria-label="Pesquisar conversas"
            placeholder="Pesquisar por nome, telefone ou mensagem..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onEnter={handleSubmitSearch}
            renderFilterTrigger={(filterTriggerClassName) => isOwnershipFilterVisible ? (
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label={advancedFilterCount > 0 ? `Filtros, ${advancedFilterCount} ativos` : 'Filtros'}
                    className={cn(
                      filterTriggerClassName,
                      "relative",
                      advancedFilterCount > 0 && "bg-blue-600 text-white ring-4 ring-blue-500/10 hover:bg-blue-700 hover:text-white dark:bg-blue-500"
                    )}
                  >
                    <Filter className="h-4 w-4" />
                    {advancedFilterCount > 0 && (
                      <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-white bg-slate-950 px-0.5 text-[8px] font-bold leading-none text-white dark:border-[#050507] dark:bg-white dark:text-slate-950">
                        {advancedFilterCount}
                      </span>
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  sideOffset={10}
                  collisionPadding={12}
                  className="inbox-smart-filter max-h-[720px] space-y-5 overflow-x-hidden overflow-y-auto rounded-2xl border-slate-200/80 bg-white/95 p-5 text-slate-950 shadow-[0_24px_80px_-28px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-[#0b0b0f]/95 dark:text-white"
                  style={{
                    width: 'min(380px, calc(100vw - 24px))',
                    maxHeight: 'min(720px, calc(var(--radix-popover-content-available-height) - 4px))',
                  }}
                  onInteractOutside={(event) => {
                    const target = event.target as HTMLElement | null;
                    if (target?.closest('[data-filter-subpopover="true"]')) {
                      event.preventDefault();
                    }
                  }}
                >
                  <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4 dark:border-white/10">
                    <div className="flex gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/20">
                        <SlidersHorizontal className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-sm font-bold tracking-tight">Visão inteligente</p>
                        <p className="mt-0.5 text-[11px] leading-4 text-slate-500 dark:text-zinc-400">Filtros exclusivos de Atendendo e Encerrados.</p>
                      </div>
                    </div>
                    {advancedFilterCount > 0 && (
                      <Button variant="ghost" size="sm" onClick={clearAdvancedFilters} className="h-8 rounded-lg px-2 text-[10px] font-semibold text-slate-500 dark:text-zinc-400">
                        <RotateCcw className="mr-1 h-3 w-3" />
                        Limpar
                      </Button>
                    )}
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <Label className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-zinc-500">Equipes</Label>
                        <p className="mt-1 text-[11px] text-slate-500 dark:text-zinc-400">Uma ou várias, somente nos atendimentos.</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {teamFilter.length > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-[11px] text-muted-foreground hover:text-primary"
                            onClick={() => setTeamFilter([])}
                          >
                            Limpar
                          </Button>
                        )}
                      </div>
                    </div>
                    <Popover
                      open={isTeamFilterOpen}
                      onOpenChange={(open) => {
                        setIsTeamFilterOpen(open);
                        if (!open) setTeamSearchTerm('');
                      }}
                    >
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={isTeamFilterOpen}
                          className="h-11 w-full justify-between rounded-xl border-slate-200 bg-slate-50 text-xs hover:bg-slate-100 hover:text-slate-950 dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-white/[0.08] dark:hover:text-white"
                        >
                          {teamFilter.length > 0
                            ? `${teamFilter.length} equipe${teamFilter.length > 1 ? 's' : ''} selecionada${teamFilter.length > 1 ? 's' : ''}`
                            : "Todas as equipes"}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent
                        className="overflow-x-hidden overflow-y-auto rounded-xl p-0"
                        align="start"
                        collisionPadding={12}
                        data-filter-subpopover="true"
                        style={{
                          width: 'min(340px, calc(100vw - 24px))',
                          maxHeight: 'calc(var(--radix-popover-content-available-height) - 4px)',
                        }}
                      >
                        <div className="border-b border-border p-2">
                          <Input
                            value={teamSearchTerm}
                            onChange={(event) => setTeamSearchTerm(event.target.value)}
                            placeholder="Buscar equipe..."
                            className="h-9"
                          />
                        </div>
                        <ScrollArea className="max-h-[220px]">
                          <div className="p-1">
                            {isLoadingTeams ? (
                              <div className="px-2 py-3 text-sm text-muted-foreground">Carregando equipes...</div>
                            ) : filteredTeamsBySearch.length === 0 ? (
                              <div className="px-2 py-3 text-sm text-muted-foreground">Nenhuma equipe encontrada.</div>
                            ) : (
                              filteredTeamsBySearch.map((team) => (
                                <button
                                  key={team.id}
                                  type="button"
                                  onClick={() => toggleTeamSelection(team.id)}
                                  className={cn(
                                    "w-full flex items-center rounded-sm px-2 py-1.5 text-sm transition-colors cursor-pointer hover:bg-accent hover:text-accent-foreground",
                                    teamFilter.includes(team.id) && "bg-accent/70 text-accent-foreground"
                                  )}
                                >
                                  <Check
                                    className={cn(
                                      "mr-2 h-4 w-4",
                                      teamFilter.includes(team.id) ? "opacity-100" : "opacity-0"
                                    )}
                                  />
                                  <span className="truncate text-left">{team.name}</span>
                                </button>
                              ))
                            )}
                          </div>
                        </ScrollArea>
                      </PopoverContent>
                    </Popover>
                    {selectedTeams.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {selectedTeams.map((team) => (
                          <button key={team.id} type="button" onClick={() => toggleTeamSelection(team.id)} className="inline-flex h-7 items-center gap-1.5 rounded-full bg-blue-50 px-2.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-100 dark:bg-blue-500/10 dark:text-blue-300 dark:hover:bg-blue-500/20">
                            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: team.color || '#2563eb' }} />
                            <span className="max-w-[150px] truncate">{team.name}</span>
                            <X className="h-3 w-3 opacity-60" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-3 border-t border-slate-100 pt-4 dark:border-white/10">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-zinc-500">Responsável</p>
                      <p className="mt-1 text-[11px] text-slate-500 dark:text-zinc-400">Veja apenas as conversas de uma pessoa.</p>
                    </div>
                    <Popover
                      open={isResponsibleFilterOpen}
                      onOpenChange={(open) => {
                        setIsResponsibleFilterOpen(open);
                        if (!open) setResponsibleSearchTerm('');
                      }}
                    >
                      <PopoverTrigger asChild>
                        <button type="button" className={cn(
                          "flex h-11 w-full items-center justify-between rounded-xl border px-3 text-left transition-colors",
                          selectedResponsible
                            ? "border-blue-200 bg-blue-50/70 dark:border-blue-500/20 dark:bg-blue-500/10"
                            : "border-slate-200 bg-slate-50 hover:bg-slate-100 dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-white/[0.08]"
                        )}>
                          <span className="flex min-w-0 items-center gap-2.5">
                            <Avatar className="h-7 w-7 border border-white shadow-sm dark:border-white/10">
                              <AvatarImage src={selectedResponsible?.avatar || selectedResponsible?.avatar_url} />
                              <AvatarFallback className="bg-gradient-to-br from-blue-500 to-indigo-600 text-[9px] font-bold text-white">
                                {selectedResponsible ? selectedResponsible.name?.slice(0, 2).toUpperCase() : <Users className="h-3.5 w-3.5" />}
                              </AvatarFallback>
                            </Avatar>
                            <span className="min-w-0">
                              <span className="block truncate text-xs font-semibold">{selectedResponsible?.name || 'Qualquer responsável'}</span>
                              <span className="block text-[10px] text-slate-500 dark:text-zinc-400">Filtrar usuário</span>
                            </span>
                          </span>
                          <ChevronsUpDown className="h-4 w-4 shrink-0 text-slate-400" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        className="overflow-x-hidden overflow-y-auto rounded-xl p-0"
                        align="start"
                        collisionPadding={12}
                        data-filter-subpopover="true"
                        style={{
                          width: 'min(340px, calc(100vw - 24px))',
                          maxHeight: 'calc(var(--radix-popover-content-available-height) - 4px)',
                        }}
                      >
                        <div className="border-b border-border p-2">
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                            <Input value={responsibleSearchTerm} onChange={(event) => setResponsibleSearchTerm(event.target.value)} placeholder="Buscar responsável..." className="h-9 pl-9" />
                          </div>
                        </div>
                        <ScrollArea className="max-h-[240px]">
                          <div className="p-1.5">
                            <button type="button" onClick={() => selectResponsible(null)} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs hover:bg-accent">
                              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 dark:bg-white/10"><Users className="h-3.5 w-3.5" /></div>
                              <span className="flex-1 font-medium">Qualquer responsável</span>
                              {!responsibleFilter && <Check className="h-4 w-4 text-blue-600" />}
                            </button>
                            {isLoadingWorkspaceUsers ? (
                              <div className="flex items-center gap-2 px-2 py-4 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Carregando pessoas...</div>
                            ) : filteredWorkspaceUsers.length === 0 ? (
                              <div className="px-2 py-4 text-xs text-muted-foreground">Nenhum responsável encontrado.</div>
                            ) : filteredWorkspaceUsers.map((user) => (
                              <button key={user.id} type="button" onClick={() => selectResponsible(user.id)} className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-accent", responsibleFilter === user.id && "bg-blue-50 dark:bg-blue-500/10")}>
                                <Avatar className="h-7 w-7"><AvatarImage src={user.avatar || user.avatar_url} /><AvatarFallback className="text-[9px]">{user.name?.slice(0, 2).toUpperCase()}</AvatarFallback></Avatar>
                                <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{user.name}</span><span className="block truncate text-[10px] text-muted-foreground">{user.email}</span></span>
                                {responsibleFilter === user.id && <Check className="h-4 w-4 text-blue-600" />}
                              </button>
                            ))}
                          </div>
                        </ScrollArea>
                      </PopoverContent>
                    </Popover>
                    {selectedResponsible && (
                      <button type="button" onClick={() => selectResponsible(null)} className="inline-flex h-8 max-w-full items-center gap-2 rounded-full bg-blue-600 px-2.5 pr-2 text-[10px] font-semibold text-white shadow-sm shadow-blue-500/20 hover:bg-blue-700">
                        <Avatar className="h-5 w-5"><AvatarImage src={selectedResponsible.avatar || selectedResponsible.avatar_url} /><AvatarFallback className="bg-white/20 text-[8px] text-white">{selectedResponsible.name?.slice(0, 2).toUpperCase()}</AvatarFallback></Avatar>
                        <span className="truncate">{selectedResponsible.name}</span>
                        <X className="h-3 w-3 opacity-70" />
                      </button>
                    )}
                  </div>

                  <div className="space-y-2.5 border-t border-slate-100 pt-4 dark:border-white/10">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-zinc-500">Escopo das filas</p>
                      <p className="mt-1 text-[11px] text-slate-500 dark:text-zinc-400">Aplique a visão a todas, abertas ou encerradas.</p>
                    </div>
                    <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-white/[0.06]" role="group" aria-label="Status das filas">
                      {([
                        { value: 'all', label: 'Todas' },
                        { value: 'open', label: 'Abertas' },
                        { value: 'closed', label: 'Encerradas' },
                      ] as const).map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={statusFilter === option.value}
                          onClick={() => {
                            setStatusFilter(option.value);
                            if (option.value === 'closed') setActiveTab('encerrados');
                            if (option.value === 'open' && activeTab === 'encerrados') setActiveTab('gerais');
                          }}
                          className={cn(
                            "h-9 rounded-lg text-[10px] font-semibold transition-all",
                            statusFilter === option.value
                              ? "bg-white text-blue-700 shadow-sm ring-1 ring-slate-200 dark:bg-white/10 dark:text-blue-300 dark:ring-white/10"
                              : "text-slate-500 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white"
                          )}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">Somente sem responsável</p>
                        <p className="text-xs text-muted-foreground">Conversas que ainda precisam de atribuição</p>
                      </div>
                      <Switch
                        checked={showUnassignedOnly}
                        onCheckedChange={(checked) => {
                          setShowUnassignedOnly(checked);
                          if (checked) setResponsibleFilter(null);
                        }}
                        className="data-[state=checked]:bg-blue-600"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-foreground">Mostrar mensagens de Marketing</p>
                        <p className="text-xs text-muted-foreground">Altera apenas o preview; a conversa continua na lista</p>
                      </div>
                      <Switch checked={showMarketing} onCheckedChange={setShowMarketing} className="data-[state=checked]:bg-blue-600" />
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            ) : null}
          />
          {isOwnershipFilterVisible && selectedResponsible && (
            <div className="pt-2">
              <button
                type="button"
                onClick={() => selectResponsible(null)}
                title="Remover filtro de responsável"
                className="group inline-flex h-8 max-w-full items-center gap-2 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 px-2.5 pr-2 text-[10px] font-semibold text-white shadow-md shadow-blue-500/15 transition-transform hover:scale-[1.01] active:scale-[0.98] motion-reduce:transform-none"
              >
                <Avatar className="h-5 w-5 border border-white/20">
                  <AvatarImage src={selectedResponsible.avatar || selectedResponsible.avatar_url} />
                  <AvatarFallback className="bg-white/15 text-[8px] text-white">{selectedResponsible.name?.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <span className="truncate">Responsável: {selectedResponsible.name}</span>
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/10 transition-colors group-hover:bg-white/20"><X className="h-3 w-3" /></span>
              </button>
            </div>
          )}
          {/* Quick Filter Chips */}
          {isOwnershipFilterVisible && (
          <div className="flex flex-nowrap items-center gap-1.5 pt-2">
            {isOwnershipFilterVisible && (
              <>
                <Badge
                  variant={ownershipFilter === 'mine' ? 'default' : 'outline'}
                  className={cn(
                    "order-2 flex h-8 min-w-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border-transparent px-2 text-[10.5px] font-semibold leading-none whitespace-nowrap transition-[background-color,color,transform] duration-150 active:scale-[0.96] motion-reduce:transform-none motion-reduce:transition-none",
                    ownershipFilter === 'mine'
                      ? "bg-blue-50 text-blue-700 hover:bg-blue-100"
                      : "bg-slate-50 text-slate-500 hover:bg-slate-100 dark:bg-white/[0.05] dark:text-zinc-400 dark:hover:bg-white/[0.09]"
                  )}
                  onClick={() => {
                    setResponsibleFilter(null);
                    if (ownershipFilter !== 'mine') updateOwnershipFilter('mine');
                  }}
                >
                  <span className="flex w-full items-center justify-center px-2">
                    <span className="inline-flex max-w-full items-center justify-center gap-1">
                      {isFiltering && ownershipFilter === 'mine' ? <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin" /> : null}
                      <span className="block truncate text-center">Atribuídos a mim</span>
                    </span>
                  </span>
                </Badge>
                <Badge
                  variant={ownershipFilter === 'everyone' ? 'default' : 'outline'}
                  className={cn(
                    "order-1 flex h-8 min-w-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border-transparent px-2 text-[10.5px] font-semibold leading-none whitespace-nowrap transition-[background-color,color,transform] duration-150 active:scale-[0.96] motion-reduce:transform-none motion-reduce:transition-none",
                    ownershipFilter === 'everyone'
                      ? "bg-blue-50 text-blue-700 hover:bg-blue-100"
                      : "bg-slate-50 text-slate-500 hover:bg-slate-100 dark:bg-white/[0.05] dark:text-zinc-400 dark:hover:bg-white/[0.09]"
                  )}
                  onClick={() => {
                    setResponsibleFilter(null);
                    if (ownershipFilter !== 'everyone') updateOwnershipFilter('everyone');
                  }}
                >
                  <span className="flex w-full items-center justify-center px-2">
                    <span className="inline-flex max-w-full items-center justify-center gap-1">
                      {isFiltering && ownershipFilter === 'everyone' ? <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin" /> : null}
                      <span className="block truncate text-center">Todos</span>
                    </span>
                  </span>
                </Badge>
                <div className="order-3 h-4 w-px bg-slate-200 dark:bg-white/10" />
              </>
            )}
            <Badge
              variant={onlyUnread ? 'default' : 'outline'}
              className={cn(
                "order-4 flex h-8 cursor-pointer items-center justify-center rounded-full border-transparent px-2.5 text-[10.5px] font-semibold whitespace-nowrap transition-[background-color,color,transform] duration-150 active:scale-[0.96] motion-reduce:transform-none motion-reduce:transition-none",
                onlyUnread
                  ? "bg-amber-50 text-amber-700 hover:bg-amber-100"
                  : "bg-slate-50 text-slate-500 hover:bg-slate-100 dark:bg-white/[0.05] dark:text-zinc-400 dark:hover:bg-white/[0.09]"
              )}
              onClick={() => setOnlyUnread(!onlyUnread)}
              title="Não lidas"
            >
              Não lidas
            </Badge>
            <Badge
              variant={showUnassignedOnly ? 'default' : 'outline'}
              className={cn(
                "hidden",
                showUnassignedOnly
                  ? "bg-emerald-500 hover:bg-emerald-600 text-white border-transparent"
                  : "hover:bg-muted text-muted-foreground"
              )}
              onClick={() => setShowUnassignedOnly(!showUnassignedOnly)}
              title="Sem responsavel"
            >
              Sem responsável
            </Badge>
          </div>
          )}
        </div>
      </div>

      <SearchDetailsDialog
        isOpen={isSearchDialogOpen}
        onOpenChange={setIsSearchDialogOpen}
        searchQuery={submittedSearchQuery}
        chats={chats}
        workspaceId={currentUser.activeWorkspaceId}
        onSelectChat={setSelectedChat}
      />

      <div className="flex flex-shrink-0 items-center gap-3 border-b border-slate-100 bg-white px-4 py-2 dark:border-white/10 dark:bg-[#050507]">
        <h3 className="flex flex-shrink-0 items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-zinc-500">
          Online ({onlineAgents.length})
          {isOffline && (
            <Badge variant="destructive" className="h-4 text-[10px] px-1">
              Offline - Reconectando...
            </Badge>
          )}
        </h3>
          <div className={cn("flex min-w-0 flex-1 flex-nowrap items-center justify-end gap-1.5 overflow-x-hidden overflow-y-visible py-0.5 transition-opacity duration-300", isOffline ? "opacity-50 grayscale pointer-events-none" : "opacity-100")}>
            {onlineAgents.length === 0 ? (
              <div className="flex gap-2">
                <Skeleton className="h-7 w-7 rounded-full" />
                <Skeleton className="h-7 w-7 rounded-full" />
                <Skeleton className="h-7 w-7 rounded-full" />
              </div>
            ) : (
              visibleOnlineAgents.map((agent) => (
                <HoverCard key={agent.user.id}>
                  <HoverCardTrigger asChild>
                    <div
                      className="relative shrink-0 cursor-pointer transition-transform duration-150 hover:-translate-y-0.5 active:scale-90 motion-reduce:transform-none motion-reduce:transition-none"
                      onClick={() => setSelectedAgent(agent.user)}
                    >
                      <Avatar className="h-7 w-7 border border-emerald-400">
                        <AvatarImage fallbackOnBlank src={agent.user.avatar} className="object-cover" />
                        <AvatarFallback className="bg-emerald-900 text-white text-xs font-bold">{agent.user.name.charAt(0)}</AvatarFallback>
                      </Avatar>
                      <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-[#22C05C] border border-background"></span>
                    </div>
                  </HoverCardTrigger>
                  <HoverCardContent className="w-80 p-0 border-border bg-popover text-popover-foreground shadow-2xl rounded-xl overflow-hidden">
                    <div className="relative h-20 bg-gradient-to-r from-green-600/20 to-emerald-900/20 p-4">
                      <div className="absolute inset-0 bg-[url('/grid-pattern.svg')] opacity-10" />
                      <div className="flex items-center gap-3 relative z-10">
                        <Avatar className="h-12 w-12 border-2 border-white/10 shadow-lg">
                          <AvatarImage fallbackOnBlank src={agent.user.avatar} />
                          <AvatarFallback className="bg-green-700 text-white font-bold">{agent.user.name.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-bold text-lg leading-tight">{agent.user.name}</p>
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                            Online agora
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="p-4 space-y-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Cargo</span>
                        {agent.user.is_superadmin ? (
                          <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/20">Admin</Badge>
                        ) : (agent.user.role?.name === 'Owner' || agent.user.role?.name === 'Proprietário') ? (
                          <Badge variant="outline" className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">Proprietário</Badge>
                        ) : (
                          <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">
                            {agent.user.team || agent.user.role?.name || 'Agente'}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Equipe</span>
                        <span className="font-medium text-foreground">{agent.user.team || 'Geral'}</span>
                      </div>
                      <Button
                        size="sm"
                        className="w-full mt-2 bg-green-600 hover:bg-green-500 text-white font-medium"
                        onClick={() => {
                          setSelectedAgent(agent.user);
                        }}
                      >
                        <UserCheck className="w-4 h-4 mr-2" />
                        Ver Perfil / Transferir
                      </Button>
                    </div>
                  </HoverCardContent>
                </HoverCard>
              ))
            )}
            {hiddenOnlineAgents.length > 0 && (
              <HoverCard openDelay={120}>
                <HoverCardTrigger asChild>
                  <button
                    type="button"
                    className="h-7 w-7 min-w-7 flex-shrink-0 rounded-full border border-slate-200 bg-slate-50 text-[10px] font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:border-white/10 dark:bg-white/[0.05] dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white"
                    aria-label={`Mostrar ${hiddenOnlineAgents.length} agentes online adicionais`}
                  >
                    +{hiddenOnlineAgents.length}
                  </button>
                </HoverCardTrigger>
                <HoverCardContent align="end" className="w-64 border-border bg-popover text-popover-foreground">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Outros agentes online
                  </p>
                  <div className="mt-2 max-h-56 overflow-y-auto space-y-1">
                    {hiddenOnlineAgents.map((agent) => (
                      <button
                        key={`extra-online-${agent.user.id}`}
                        type="button"
                        className="w-full rounded-md px-2 py-1.5 hover:bg-muted text-left flex items-center gap-2"
                        onClick={() => setSelectedAgent(agent.user)}
                      >
                        <Avatar className="h-7 w-7 border border-border shrink-0">
                          <AvatarImage fallbackOnBlank src={agent.user.avatar} />
                          <AvatarFallback className="text-[10px]">{agent.user.name.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{agent.user.name}</p>
                          <p className="text-[11px] text-muted-foreground truncate">{agent.user.team || agent.user.role?.name || 'Agente'}</p>
                        </div>
                        <span className="h-2 w-2 rounded-full bg-[#22C05C] shrink-0" />
                      </button>
                    ))}
                  </div>
                </HoverCardContent>
              </HoverCard>
            )}
            {onlineAgents.length === 0 && (
              <p className="text-xs text-muted-foreground italic sr-only">Nenhum agente online</p>
            )}
          </div>
      </div>

      <AgentProfileSheet
        member={selectedAgent}
        isOpen={!!selectedAgent}
        onClose={() => setSelectedAgent(null)}
        isOnline={true}
      />



      {
        isBulkMode && (
          <div className={cn(
            "p-2 border-b border-border flex items-center justify-between animate-in slide-in-from-top-2",
            bulkAction === 'agent' ? "bg-blue-500/10" : "bg-red-500/10"
          )}>
            <div className="flex items-center gap-2 px-2">
              <p className={cn(
                "text-sm font-medium",
                bulkAction === 'agent' ? "text-blue-800" : "text-red-800"
              )}>
                {selectedBulkChats.size} selecionado(s)
              </p>
              <Button variant="link" size="sm" className="h-auto p-0 text-muted-foreground hover:text-foreground" onClick={handleSelectAllBulk}>
                {filteredChats.length > 0 && filteredChats.every(c => selectedBulkChats.has(c.id)) ? "Deselecionar todos" : "Selecionar todos"}
              </Button>
            </div>
            
            <div className="flex items-center gap-2">
              {bulkAction === 'agent' ? (
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 px-2 border-r border-border mr-2">
                    <p className="text-xs font-semibold text-blue-800 uppercase tracking-wider">
                      Modo: {bulkAgentStatus ? (bulkAgentMode === 'auto' ? 'Automático' : 'Sugestão') : 'Desligado'}
                    </p>
                  </div>
                  <Button 
                    size="sm" 
                    className="h-8 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4"
                    disabled={selectedBulkChats.size === 0 || isBulkSubmitting}
                    onClick={handleBulkAgentToggle}
                  >
                    {isBulkSubmitting ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : <CheckCircle2 className="h-3 w-3 mr-2" />}
                    Confirmar Alteração em {selectedBulkChats.size}
                  </Button>
                </div>
              ) : (
                <Dialog open={isBulkDialogOpen} onOpenChange={setIsBulkDialogOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="destructive" className="h-8" disabled={selectedBulkChats.size === 0}>
                      Encerrar Chats
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="bg-background border-border text-foreground sm:max-w-[425px]">
                    <DialogHeader>
                      <DialogTitle>Encerrar {selectedBulkChats.size} Atendimentos</DialogTitle>
                      <DialogDescription className="text-muted-foreground">
                        Você pode enviar uma mensagem final para todos os contatos selecionados antes de encerrar.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                      <Label htmlFor="bulk-message" className="text-foreground mb-2 block">Mensagem de Encerramento (opcional)</Label>
                      <Textarea
                        id="bulk-message"
                        placeholder="Ex: Agradecemos o contato!"
                        className="bg-muted/50 border-border text-foreground min-h-[100px]"
                        value={bulkMessage}
                        onChange={(e) => setBulkMessage(e.target.value)}
                      />
                    </div>
                    <DialogFooter>
                      <Button variant="ghost" onClick={() => setIsBulkDialogOpen(false)} disabled={isBulkSubmitting}>Cancelar</Button>
                      <Button onClick={handleBulkSubmit} disabled={isBulkSubmitting}>
                        {isBulkSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Confirmar Encerramento
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
            </div>
          </div>
        )
      }

      <div className="flex-1 overflow-hidden relative flex flex-col min-h-0 bg-transparent">
        {filteredChats.length > 0 ? (
          <>
            <Virtuoso
              style={{ height: '100%', width: '100%' }}
              data={groupedChats}
              scrollerRef={premiumWheelScrollerRef}
              components={virtuosoComponents}
              computeItemKey={getChatItemKey}
              endReached={handleEndReached}
              itemContent={renderChatItem}
            />
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 px-6 text-center space-y-4">
            {activeTab === 'atendimentos' ? (
              <div className="flex flex-col items-center">
                <div className="relative mb-6">
                  {/* Subtle pulsing background glow */}

                  {/* Floating Container */}
                  <div className="relative z-10 bg-emerald-50 dark:bg-emerald-950 p-5 rounded-full border border-emerald-200 dark:border-emerald-800">
                    <svg className="h-10 w-10 text-emerald-600 dark:text-emerald-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
                      <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
                    </svg>
                  </div>
                </div>

                <h3 className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mb-1">
                  Tudo limpo por aqui!
                </h3>
                <p className="text-sm text-muted-foreground/80 max-w-[240px] mb-6">
                  Bom trabalho. Você não tem atendimentos pendentes no momento.
                </p>

                {currentUser.activeWorkspaceId && (
                  <div className="pt-2 opacity-100 pointer-events-auto">
                    <NewConversationDialog
                      workspaceId={currentUser.activeWorkspaceId}
                      onActionSuccess={onUpdate}
                      trigger={
                        <Button variant="outline" className="gap-2 border-emerald-500/20 hover:bg-emerald-500/10 text-emerald-600 hover:text-emerald-700 rounded-xl shadow-sm transition-all duration-300">
                          <PlusCircle className="h-4 w-4" />
                          Nova Conversa
                        </Button>
                      }
                    />
                  </div>
                )}
              </div>
            ) : (
              <>
                <MessageSquare className="h-12 w-12 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">Nenhuma conversa encontrada nesta seção.</p>
              </>
            )}
          </div>
        )}
      </div>

      {
        isForwarding && (
          <div className="p-4 border-t border-border bg-background border-t-2 shadow-inner">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-foreground font-medium">
                {selectedForwardingChatIds?.size || 0} selecionados
              </span>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto gap-1.5 p-0 text-primary"
                onClick={handleSelectAllForwarding}
                disabled={filteredChats.length === 0 || areAllForwardingChatsSelected}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                {areAllForwardingChatsSelected ? 'Todos selecionados' : 'Enviar para todos'}
              </Button>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 border-input hover:bg-accent hover:text-accent-foreground"
                onClick={onCancelForward}
              >
                Cancelar
              </Button>
              <Button
                className="flex-1 bg-blue-600 hover:bg-blue-500 text-white"
                onClick={onConfirmForward}
                disabled={!selectedForwardingChatIds || selectedForwardingChatIds.size === 0}
              >
                Encaminhar
              </Button>
            </div>
          </div>
        )
      }

      {/* Agent Bulk Configuration Dialog */}
      <Dialog open={isAgentBulkConfigOpen} onOpenChange={setIsAgentBulkConfigOpen}>
        <DialogContent className="bg-background border-border text-foreground max-w-md p-6">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <Bot className="h-5 w-5 text-blue-500" />
              Configurar Agente em Massa
            </DialogTitle>
            <DialogDescription className="text-muted-foreground mt-2">
              Defina as configurações do Agente antes de selecionar as conversas.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-semibold">Status do Agente</Label>
                <p className="text-xs text-muted-foreground">Ativar ou desativar resposta automática</p>
              </div>
              <Switch 
                checked={bulkAgentStatus} 
                onCheckedChange={setBulkAgentStatus}
              />
            </div>

            <Separator className="bg-border/50" />

            <div className="space-y-3">
              <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Agente Responsável</Label>
              <Select 
                value={selectedBulkAgentId || undefined} 
                onValueChange={setSelectedBulkAgentId}
                disabled={!bulkAgentStatus}
              >
                <SelectTrigger className="h-10 bg-background border-border">
                  <SelectValue placeholder="Selecione o agente" />
                </SelectTrigger>
                <SelectContent>
                  {autopilotAgents.map(agent => (
                    <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-3">
              <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Modo de Operação</Label>
              <div className="grid grid-cols-2 gap-3">
                <Button 
                  variant={bulkAgentMode === 'suggest' ? 'secondary' : 'outline'}
                  className={cn(
                    "h-10 text-sm font-medium transition-all duration-200", 
                    bulkAgentMode === 'suggest' && "bg-blue-500/10 text-blue-600 border-blue-200 shadow-sm"
                  )}
                  onClick={() => setBulkAgentMode('suggest')}
                  disabled={!bulkAgentStatus}
                >
                  <MessageSquareQuote className="h-4 w-4 mr-2" />
                  Sugestão
                </Button>
                <Button 
                  variant={bulkAgentMode === 'auto' ? 'secondary' : 'outline'}
                  className={cn(
                    "h-10 text-sm font-medium transition-all duration-200", 
                    bulkAgentMode === 'auto' && "bg-green-500/10 text-green-600 border-green-200 shadow-sm"
                  )}
                  onClick={() => setBulkAgentMode('auto')}
                  disabled={!bulkAgentStatus}
                >
                  <Bot className="h-4 w-4 mr-2" />
                  Automático
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter className="mt-6 flex gap-2">
            <Button variant="ghost" onClick={() => setIsAgentBulkConfigOpen(false)} className="flex-1">
              Cancelar
            </Button>
            <Button 
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-lg shadow-blue-500/20"
              onClick={() => {
                setIsAgentBulkConfigOpen(false);
                setIsBulkMode(true);
                setBulkAction('agent');
                setSelectedBulkChats(new Set());
              }}
              disabled={bulkAgentStatus && !selectedBulkAgentId}
            >
              Prosseguir para Seleção
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!chatToAssign} onOpenChange={(open) => !open && setChatToAssign(null)}>
        <AlertDialogContent className="bg-background border-border text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Assumir este atendimento?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Você será definido como o responsável pela conversa com <strong>{chatToAssign?.contact.name}</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border hover:bg-muted text-foreground">Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmAssignChat} className="bg-blue-600 hover:bg-blue-700 text-white border-0">
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </div>
    </div >
  );
}
