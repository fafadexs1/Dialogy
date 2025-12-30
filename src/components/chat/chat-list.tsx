'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Search, PlusCircle, File, Video, Mic, Image as ImageIcon, Users, Loader2, Filter, MessageSquare, MapPin, RefreshCw, Megaphone, LogOut, Check, UserCheck, BellOff, Tag as TagIcon, PencilLine } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { type Chat, type OnlineAgent, type User, type Message, EvolutionInstance } from '@/lib/types';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { usePresence } from '@/hooks/use-online-status';
import { FaWhatsapp, FaInstagram, FaFacebookMessenger } from 'react-icons/fa6';
import { Badge } from '../ui/badge';
import { TagSelectionDialog } from './tag-selection-dialog';
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
import { closeMultipleChatsAction } from '@/actions/chats';
import { guardedAssignChat, guardedCloseChat } from '@/actions/chat-guards';
import { toast } from '@/hooks/use-toast';
import { getEvolutionApiInstances } from '@/actions/evolution-api';
import { buildChatProtocol } from '@/lib/utils';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';

import { SearchDetailsDialog } from './search-details-dialog';
import { useDebouncedValue } from '@/hooks/use-debounced-value';

// --- Start New Conversation Dialog ---
function NewConversationDialog({ workspaceId, onActionSuccess, trigger }: { workspaceId: string, onActionSuccess: () => void, trigger?: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [instances, setInstances] = useState<Omit<EvolutionInstance, 'status' | 'qrCode'>[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('55');

  const [selectedInstanceName, setSelectedInstanceName] = useState('');
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTemplateName, setSelectedTemplateName] = useState('');
  const [templateVariables, setTemplateVariables] = useState<Record<string, string>>({});
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  // Helper to find selected instance object
  const selectedInstance = useMemo(() => instances.find(i => i.instance_name === selectedInstanceName), [instances, selectedInstanceName]);
  const isCloud = selectedInstance?.type === 'wa_cloud';

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

  useEffect(() => {
    if (isOpen && workspaceId) {
      setIsLoading(true);
      getEvolutionApiInstances(workspaceId)
        .then((res) => {
          if (res.error) {
            toast({ title: 'Erro ao carregar instâncias', description: res.error, variant: 'destructive' });
            setInstances([]);
            return;
          }
          setInstances(res.instances || []);
        })
        .catch((error) => {
          console.error('[CHAT_LIST] Falha ao buscar instâncias', error);
          toast({ title: 'Erro ao carregar instâncias', description: 'Não foi possível buscar as instâncias de WhatsApp.', variant: 'destructive' });
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

      templatePayload = {
        name: selectedTemplate.name,
        language: selectedTemplate.language,
        components: [
          {
            type: 'body',
            parameters
          }
        ]
      };
    }

    const result = await startNewConversation({
      workspaceId,
      instanceName: selectedInstanceName,
      phoneNumber: phoneNumber,
      message: templatePayload ? `[Template: ${selectedTemplate.name}]` : message, // Fallback message for UI if needed
      tabId: null,
      template: templatePayload
    });

    if (result.success) {
      toast({ title: 'Mensagem Enviada!', description: 'A conversa foi iniciada e aparecerá na sua lista.' });
      setIsOpen(false);
      onActionSuccess();
      setPhoneNumber('55');
      setTemplateVariables({});
      setSelectedTemplateName('');
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
        // Optional: reset state on close
        // setSelectedInstanceName(''); 
      }
    }}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="icon">
            <PlusCircle className="h-5 w-5" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="bg-background border-border text-foreground sm:max-w-[425px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-foreground">Iniciar Nova Conversa</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Envie uma mensagem para um novo número para iniciar um atendimento.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-2 pb-4">
            <div className="space-y-2">
              <Label htmlFor="instanceName" className="text-muted-foreground">Instância de Envio</Label>
              <Select name="instanceName" required value={selectedInstanceName} onValueChange={setSelectedInstanceName}>
                <SelectTrigger id="instanceName" className="bg-muted/50 border-input text-foreground">
                  <SelectValue placeholder="Selecione a instância..." />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border text-popover-foreground">
                  {isLoading ? (
                    <div className="p-4 text-center text-sm text-white/50">Carregando...</div>
                  ) : (
                    instances.map((instance) => (
                      <SelectItem key={instance.id} value={instance.instance_name} className="focus:bg-white/10 focus:text-white">
                        {instance.display_name} {instance.type === 'wa_cloud' && '(Cloud API)'}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="phoneNumber" className="text-muted-foreground">Número do WhatsApp (JID)</Label>
              <Input
                id="phoneNumber"
                name="phoneNumber"
                placeholder="5511999998888"
                required
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                className="bg-muted/50 border-input text-foreground placeholder:text-muted-foreground/50"
              />
              <p className="text-xs text-white/40">
                Inclua o código do país e o DDD. Não use máscaras ou caracteres especiais.
              </p>
            </div>

            {isCloud ? (
              <div className="space-y-4 border-l-2 border-blue-500 pl-4 bg-muted/30 p-2 rounded-r-md">
                <div className="space-y-2">
                  <Label className="text-muted-foreground">Selecionar Template (Cloud API)</Label>
                  <Select value={selectedTemplateName} onValueChange={setSelectedTemplateName} required>
                    <SelectTrigger className="bg-muted/50 border-input text-foreground">
                      <SelectValue placeholder={loadingTemplates ? "Carregando templates..." : "Selecione um template..."} />
                    </SelectTrigger>
                    <SelectContent className="bg-popover border-border text-popover-foreground max-h-[200px]">
                      {loadingTemplates ? (
                        <div className="p-2 text-center text-xs text-muted-foreground">Carregando...</div>
                      ) : templates.length === 0 ? (
                        <div className="p-2 text-center text-xs text-muted-foreground">Nenhum template aprovado encontrado.</div>
                      ) : (
                        templates.map((t: any) => (
                          <SelectItem key={t.name} value={t.name}>{t.name}</SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  {selectedTemplate && (
                    <p className="text-xs text-muted-foreground italic mt-1 bg-muted p-2 rounded">
                      "{(selectedTemplate.components.find((c: any) => c.type === 'BODY')?.text || '')}"
                    </p>
                  )}
                </div>

                {variableKeys.length > 0 && (
                  <div className="space-y-3">
                    <Label className="text-xs font-semibold text-blue-400 uppercase tracking-wide">Variáveis do Template</Label>
                    {variableKeys.map((key) => (
                      <div key={key} className="space-y-1">
                        <Label htmlFor={`var-${key}`} className="text-xs text-white/70">Variável {`{{${key}}}`}</Label>
                        <Input
                          id={`var-${key}`}
                          className="bg-zinc-950/50 border-white/10 h-8 text-sm"
                          placeholder={`Valor para {{${key}}}`}
                          value={templateVariables[key] || ''}
                          onChange={(e) => setTemplateVariables(prev => ({ ...prev, [key]: e.target.value }))}
                          required
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="message" className="text-muted-foreground">Mensagem</Label>
                <Textarea
                  id="message"
                  name="message"
                  placeholder="Olá! Gostaria de falar sobre..."
                  required={!isCloud}
                  className="bg-muted/50 border-input text-foreground placeholder:text-muted-foreground/50 min-h-[100px]"
                />
              </div>
            )}

          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost" className="text-muted-foreground hover:text-foreground">
                Cancelar
              </Button>
            </DialogClose>
            <Button type="submit" disabled={isSubmitting || (isCloud && !selectedTemplate)} className="bg-blue-600 hover:bg-blue-500 text-white">
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isCloud ? 'Enviar Template' : 'Enviar Mensagem'}
            </Button>
          </DialogFooter>
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
}

const LastMessagePreview: React.FC<LastMessagePreviewProps> = ({ message }) => {
  const { latitude, longitude, address, locationName } = message.metadata || {};
  const isLocation = typeof latitude === 'number' && typeof longitude === 'number' || message.type === 'location';
  const isMedia = message.metadata?.mediaUrl || message.metadata?.thumbnail;

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
    else if (!isMedia) text = message.content;
    else if (message.content) text = message.content;
    else {
      const mimetype = message.metadata?.mimetype || '';
      if (mimetype.startsWith('image/')) text = 'Imagem';
      else if (mimetype.startsWith('video/')) text = 'Vídeo';
      else if (mimetype.startsWith('audio/')) text = 'Áudio';
      else if (message.metadata?.fileName) text = message.metadata.fileName;
      else text = 'Arquivo';
    }

    const charLimit = 30;
    if (text && text.length > charLimit) return text.substring(0, charLimit) + '...';
    return text;
  };

  return (
    <div className="flex items-start gap-1.5 text-sm text-muted-foreground overflow-hidden">
      <div className="mt-0.5 flex-shrink-0">{getIcon()}</div>
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
  snoozedUntil?: number;
  onSnooze?: (chatId: string) => void;
  onUnsnooze?: (chatId: string) => void;
  onAssign?: (chat: Chat) => Promise<void> | void;
  onPrefetch?: (chatId: string) => void;
}


const isMarketingMessage = (message: Message) => {
  const meta = message.metadata as any;
  return Boolean(meta?.isMarketing || meta?.event === 'marketing_auto_close');
};

const ChatListItem: React.FC<ChatListItemProps> = ({ chat, isSelected, onSelect, onUpdate, currentUser, showMarketing, isForwarding, isSelectedForForwarding, onToggleForwardSelection, onToggleBulkSelection, isBulkMode, isSelectedForBulk, snoozedUntil, onSnooze, onUnsnooze, onAssign, onPrefetch }) => {
  const isMarketingChat = chat.messages.some((m: any) => isMarketingMessage(m as Message));
  const visibleMessages = React.useMemo(() => {
    if (showMarketing) return chat.messages;
    return chat.messages.filter(m => !isMarketingMessage(m));
  }, [chat.messages, showMarketing]);
  const removeChat = useInboxStore(state => state.removeChat);
  const drafts = useInboxStore(state => state.drafts);
  const draft = drafts[chat.id];
  const lastMessage = visibleMessages[visibleMessages.length - 1] || chat.messages[chat.messages.length - 1];
  const [isTagDialogOpen, setIsTagDialogOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const canQuickClose = chat.status !== 'atendimentos' && chat.status !== 'encerrados';
  const canAssign = chat.status === 'gerais';
  const canSnooze = chat.status === 'atendimentos';
  const canTag = false;
  const isSnoozed = !!snoozedUntil && snoozedUntil > Date.now();
  const statusLabel = chat.status === 'encerrados' ? 'Fechado' : chat.status === 'atendimentos' ? 'Em atendimento' : 'Fila';
  const statusTone = chat.status === 'encerrados'
    ? 'bg-red-500/20 text-red-200'
    : chat.status === 'atendimentos'
      ? 'bg-emerald-500/20 text-emerald-100'
      : 'bg-blue-500/20 text-blue-100';
  const hasTag = Boolean(chat.tag);
  const tagLabel = hasTag ? chat.tag : 'Sem tag';

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

  const handleSnoozeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isSnoozed) {
      onUnsnooze?.(chat.id);
    } else {
      onSnooze?.(chat.id);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleSelect();
    }
  };

  const prefetchTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnter = () => {
    if (!onPrefetch) return;
    // Debounce prefetch 200ms
    prefetchTimeoutRef.current = setTimeout(() => {
      onPrefetch(chat.id);
    }, 200);
  };

  const handleMouseLeave = () => {
    if (prefetchTimeoutRef.current) {
      clearTimeout(prefetchTimeoutRef.current);
      prefetchTimeoutRef.current = null;
    }
  };

  return (
    <div
      className={cn(
        "relative flex items-start gap-2.5 md:gap-3 px-3 py-2.5 md:p-3 cursor-pointer group transition-all border border-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
        "mx-0 my-0 rounded-none border-b border-border/40 hover:bg-muted/30", // Mobile: Native list feel
        "md:mx-3 md:my-1 md:rounded-xl md:border-transparent md:hover:bg-muted/50", // Desktop: Card feel
        "min-h-[76px] md:h-[112px]", // Height adjustment
        isSelected && !isForwarding && !isBulkMode
          ? "bg-sidebar-accent dark:bg-white/10 dark:border-white/10 shadow-sm"
          : "dark:hover:bg-white/5",
        (isForwarding && isSelectedForForwarding) || (isBulkMode && isSelectedForBulk) ? "bg-primary/5 border-primary/20" : "",
        isSnoozed ? "opacity-60 grayscale" : ""
      )}
      onClick={handleSelect}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onDoubleClick={() => setIsTagDialogOpen(true)}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="option"
      aria-selected={isSelected}
      aria-label={`Conversa com ${chat.contact.name}${isSnoozed ? ' adiada' : ''}`}
    >
      {isSelected && !isForwarding && !isBulkMode && (
        <div className="absolute left-0 top-3 bottom-3 w-1 bg-primary rounded-r-full shadow-glow-primary"></div>
      )}

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

      <TagSelectionDialog
        isOpen={isTagDialogOpen}
        setIsOpen={setIsTagDialogOpen}
        chat={chat}
        onUpdate={onUpdate}
        user={currentUser}
      />

      <motion.div
        className="relative flex-shrink-0"
        layoutId={`avatar-morph-${chat.id}`}
      >
        <Avatar className="h-12 w-12 md:h-10 md:w-10 border border-border">
          <AvatarImage src={chat.contact.avatar_url || undefined} alt={chat.contact.name} data-ai-hint="person" />
          <AvatarFallback className="bg-muted text-muted-foreground">{chat.contact.name.charAt(0)}</AvatarFallback>
        </Avatar>
        {(() => {
          const lastMessage = chat.messages?.[chat.messages.length - 1] as any;
          const platformSources = [
            chat.source,
            lastMessage?.platform,
            lastMessage?.source_from_api,
            chat.instance_type,
          ].filter(Boolean).map(s => s.toLowerCase());

          const isInstagram = platformSources.some(s => s.includes('instagram'));
          const isMessenger = platformSources.some(s => s.includes('messenger') || s.includes('facebook'));
          const isWhatsapp = platformSources.some(s => s.includes('whatsapp') || s.includes('baileys') || s.includes('wa_cloud'));

          // Heuristic: "Meta User" usually implies Messenger/Facebook if not explicitly Instagram
          const isMetaUser = chat.contact.name.startsWith('Meta User');

          let icon = <FaWhatsapp size={10} />;
          let bg = 'bg-green-500';
          let label = 'WhatsApp';

          if (isInstagram) {
            icon = <FaInstagram size={10} />;
            bg = 'bg-gradient-to-tr from-purple-500 via-pink-500 to-yellow-500';
            label = 'Instagram';
          } else if (isMessenger || (isMetaUser && !isWhatsapp)) {
            icon = <FaFacebookMessenger size={10} />;
            bg = 'bg-blue-500';
            label = 'Messenger';
          }

          return (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className={`absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full text-white border-2 border-black shadow-sm ${bg}`}>
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
                <div className="absolute -top-1 -left-1 flex h-5 w-5 items-center justify-center rounded-full text-white border-2 border-black shadow-sm bg-orange-500">
                  <Megaphone size={10} />
                </div>
              </TooltipTrigger>
              <TooltipContent className="bg-popover border-border text-popover-foreground">
                <p>Campanha de Marketing</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </motion.div >

      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2 min-w-0 flex-nowrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 min-w-0 flex-nowrap">
              <p className={cn("font-semibold truncate whitespace-nowrap max-w-[70%] md:max-w-[60%]", "text-base md:text-sm text-foreground")} title={chat.contact.name}>
                {chat.contact.name}
              </p>
              {chat.status === 'encerrados' && (
                <Badge className={cn("text-[10px] border-0 px-1.5 py-0.5 flex-shrink-0", statusTone)}>
                  {statusLabel}
                </Badge>
              )}
              {isSnoozed && (
                <Badge className="text-[10px] px-1.5 py-0 bg-amber-500/30 text-amber-100 border-amber-500/40 flex-shrink-0" title="Conversa adiada temporariamente">
                  Snooze
                </Badge>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 flex-nowrap justify-end">
            <div className="flex items-center gap-1 flex-nowrap">
              {canAssign && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
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
              {canSnooze && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className={cn("h-7 w-7", isSnoozed ? "text-amber-500" : "text-muted-foreground hover:text-foreground")}
                        aria-label={isSnoozed ? "Retomar conversa adiada" : "Adiantar conversa por 15 minutos"}
                        onClick={handleSnoozeClick}
                      >
                        <BellOff className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{isSnoozed ? 'Retomar agora' : 'Soneca de 15 min'}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              {canTag && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        aria-label="Etiquetar conversa"
                        onClick={(e) => { e.stopPropagation(); setIsTagDialogOpen(true); }}
                      >
                        <TagIcon className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Aplicar tag</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
            {canQuickClose && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      onClick={handleQuickClose}
                      disabled={isClosing}
                    >
                      {isClosing ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Encerrar sem abrir</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {lastMessage && (
              <p className="text-[10px] text-muted-foreground whitespace-nowrap flex-shrink-0">
                {lastMessage.timestamp}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 min-h-[20px] flex-wrap">
          {chat.status === 'atendimentos' && chat.teamName ? (
            <Badge
              style={{
                backgroundColor: chat.teamColor || 'rgba(255,255,255,0.1)',
                color: chat.teamColor ? (chat.teamColor.toLowerCase().startsWith('#fff') ? '#000' : '#fff') : '#fff',
                borderColor: chat.teamColor ? chat.teamColor : 'rgba(255,255,255,0.2)'
              }}
              className="font-medium text-[10px] py-0 px-1.5 flex items-center gap-1 border flex-shrink-0"
              title={chat.teamName}
            >
              <Users className="h-3 w-3" />
              {chat.teamName}
            </Badge>
          ) : (
            <Badge
              style={hasTag ? {
                backgroundColor: chat.color || 'rgba(255,255,255,0.1)',
                color: chat.color ? (chat.color.toLowerCase().startsWith('#fff') ? '#000' : '#fff') : '#fff',
                borderColor: chat.color ? chat.color : 'rgba(255,255,255,0.2)'
              } : undefined}
              className={cn(
                "text-[10px] border px-1.5 py-0.5 flex-shrink-0",
                hasTag ? "" : "bg-muted/50 border-input text-muted-foreground"
              )}
              title={hasTag ? chat.tag : 'Sem tag'}
            >
              {tagLabel}
            </Badge>
          )}
          {isMarketingChat && (
            <Badge
              variant="secondary"
              className="font-medium text-[10px] py-0 px-1.5 flex items-center gap-1 bg-orange-500/20 text-orange-200 border-orange-500/30"
            >
              <Megaphone className="h-3 w-3" />
              Marketing
            </Badge>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex-1 min-w-0">
            {draft ? (
              <p className="text-xs text-red-500 font-medium truncate flex items-center gap-1">
                <PencilLine className="h-3 w-3" />
                <span className="font-bold">[Rascunho]:</span> {draft}
              </p>
            ) : (
              lastMessage ? <LastMessagePreview message={lastMessage} /> : <div className="h-[20px]" />
            )}
          </div>
          {(() => {
            const unread = chat.unreadCount ?? 0;
            if (unread <= 0) return null;
            return (
              <Badge className="h-5 min-w-[1.25rem] px-1.5 flex-shrink-0 justify-center rounded-full bg-blue-600 text-white border-0 shadow-md shadow-blue-500/20 text-[10px] font-bold">
                {unread}
              </Badge>
            );
          })()}
        </div>
      </div>
    </div >
  );
};

interface ChatListProps {
  chats: Chat[];
  selectedChat: Chat | null;
  setSelectedChat: (chat: Chat | null) => void;
  currentUser: User;
  onUpdate: () => void;
  isForwarding?: boolean;
  selectedForwardingChatIds?: Set<string>;
  onToggleForwardSelection?: (chatId: string) => void;
  onConfirmForward?: () => void;
  onCancelForward?: () => void;
  onPrefetch?: (chatId: string) => void;
  className?: string;
}

import { Virtuoso } from 'react-virtuoso';
import { useInboxStore } from '@/hooks/use-inbox-store';
import { loadMoreChatsAction, getInitialChatsData } from '@/actions/chats';

// ... existing imports ...

// ... existing components ...

import { AgentProfileSheet } from '@/components/team/agent-profile-sheet';

// ... existing imports ...

export default function ChatList({ chats, selectedChat, setSelectedChat, currentUser, onUpdate, isForwarding, selectedForwardingChatIds, onToggleForwardSelection, onConfirmForward, onCancelForward, onPrefetch, className }: ChatListProps) {
  const { onlineAgents, isOffline } = usePresence();
  const [selectedAgent, setSelectedAgent] = useState<OnlineAgent['user'] | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearchTerm = useDebouncedValue(searchTerm, 300);
  const [isSearchDialogOpen, setIsSearchDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'gerais' | 'atendimentos' | 'encerrados'>('gerais');
  const [ownershipFilter, setOwnershipFilter] = useState<'mine' | 'everyone'>('mine');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'closed'>('all');
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [showUnassignedOnly, setShowUnassignedOnly] = useState(false);
  const [showMarketing, setShowMarketing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isFiltering, setIsFiltering] = useState(false);
  const [snoozedUntilMap, setSnoozedUntilMap] = useState<Record<string, number>>({});

  const hasMoreChats = useInboxStore((state) => state.hasMoreChats);
  const appendChats = useInboxStore((state) => state.appendChats);
  const setInitialData = useInboxStore((state) => state.setInitialData);

  const setHasMoreChats = useInboxStore((state) => state.setHasMoreChats);

  const isFirstRun = React.useRef(true);

  const [isBulkMode, setIsBulkMode] = useState(false);
  const [selectedBulkChats, setSelectedBulkChats] = useState<Set<string>>(new Set());
  const [isBulkDialogOpen, setIsBulkDialogOpen] = useState(false);
  const [bulkMessage, setBulkMessage] = useState('');
  const [isBulkSubmitting, setIsBulkSubmitting] = useState(false);
  // const debouncedSearch = useDebouncedValue(searchQuery, 220); // Removed, replaced by debouncedSearchTerm

  // Assign Confirmation State
  const [chatToAssign, setChatToAssign] = useState<Chat | null>(null);

  const toggleBulkMode = () => {
    setIsBulkMode(!isBulkMode);
    setSelectedBulkChats(new Set());
    // If we're entering bulk mode, maybe we want to select the current filtered list?
    // No, usually user selects manually.
  };

  const handleSnooze = (chatId: string) => {
    const until = Date.now() + 15 * 60 * 1000;
    setSnoozedUntilMap((prev) => ({ ...prev, [chatId]: until }));
    toast({ title: 'Conversa adiada', description: 'Voltaremos a mostrar esse chat em 15 minutos.' });
  };

  const handleUnsnooze = (chatId: string) => {
    setSnoozedUntilMap((prev) => {
      const next = { ...prev };
      delete next[chatId];
      return next;
    });
  };

  const handleToggleBulkSelection = (chatId: string) => {
    const newSelected = new Set(selectedBulkChats);
    if (newSelected.has(chatId)) {
      newSelected.delete(chatId);
    } else {
      newSelected.add(chatId);
    }
    setSelectedBulkChats(newSelected);
  };

  const handleSelectAllBulk = () => {
    // Select all visible chats in the current tab
    // We can use filteredChats
    if (filteredChats.length === 0) return;

    const allIds = filteredChats.map(c => c.id);
    const allSelected = allIds.every(id => selectedBulkChats.has(id));

    if (allSelected) {
      // Deselect all
      setSelectedBulkChats(new Set());
    } else {
      // Select all
      setSelectedBulkChats(new Set(allIds));
    }
  };

  const handleBulkSubmit = async () => {
    if (selectedBulkChats.size === 0) return;
    setIsBulkSubmitting(true);

    const chatIds = Array.from(selectedBulkChats);
    let successCount = 0;

    // Process one by one on the client to avoid server timeouts on vast operations
    for (const chatId of chatIds) {
      try {
        // We reuse the action but send one by one
        const result = await closeMultipleChatsAction([chatId], bulkMessage);
        if (result.success) {
          successCount++;
          // Optional: We could update the UI here to remove the processed chat from the list or selection
          // But since we want to be safe, we just wait for the end.
        }
      } catch (err) {
        console.error(`Falha ao encerrar chat ${chatId}`, err);
      }
    }

    // Always finish "successfully" regarding the UI flow, 
    // reporting how many were actually closed if needed.
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

  const handleAssignChat = (chat: Chat) => {
    setChatToAssign(chat);
  };

  const confirmAssignChat = async () => {
    if (!chatToAssign) return;

    // Call unguarded or guarded? The component calls guarded usually.
    // guardedAssignChat logic passes through the result from assignChatToSelfAction
    const result = await guardedAssignChat(chatToAssign.id);

    if (result.success) {
      toast({ title: 'Assumiu atendimento', description: `${chatToAssign.contact.name} agora está com você.` });

      // If we got the full chat back (with updated colors/tags/status), update the store immediately
      // This prevents the "transparent tag" glitch while waiting for realtime/refresh
      if ((result as any).chat) {
        useInboxStore.getState().upsertChats([(result as any).chat]);
      }

      onUpdate();
    } else {
      toast({ title: 'Não foi possível assumir', description: result.error || 'Erro desconhecido', variant: 'destructive' });
    }
    setChatToAssign(null);
  };

  const selectedChatIdRef = React.useRef(selectedChat?.id);
  const lastSelectedStatusRef = React.useRef<string | null>(null);

  useEffect(() => {
    selectedChatIdRef.current = selectedChat?.id;
  }, [selectedChat?.id]);

  // Effect removed to prevent auto-navigation
  // useEffect(() => {
  //   const status = selectedChat?.status;
  //   if (!status) {
  //     lastSelectedStatusRef.current = null;
  //     return;
  //   }

  //   const statusChanged = lastSelectedStatusRef.current !== status;
  //   const isKnownTab = status === 'gerais' || status === 'atendimentos' || status === 'encerrados';

  //   if (statusChanged && isKnownTab && activeTab !== status) {
  //     setActiveTab(status);
  //   }

  //   lastSelectedStatusRef.current = status;
  // }, [activeTab, selectedChat?.status]);

  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }

    const fetchFilteredChats = async () => {
      if (!currentUser.activeWorkspaceId) return;
      setIsFiltering(true);
      try {
        const data = await getInitialChatsData({
          workspaceId: currentUser.activeWorkspaceId,
          selectedChatId: selectedChatIdRef.current || null,
          ownership: ownershipFilter
        });

        if (data.error) {
          toast({ title: 'Erro ao filtrar', description: data.error, variant: 'destructive' });
        } else {
          setInitialData(data);
        }
      } catch (err) {
        console.error(err);
        toast({ title: 'Erro ao filtrar', description: 'Falha ao buscar conversas.', variant: 'destructive' });
      } finally {
        setIsFiltering(false);
      }
    };

    fetchFilteredChats();
  }, [ownershipFilter, currentUser.activeWorkspaceId, setInitialData]);

  const sortedChats = useMemo(() => {
    const sorted = [...chats].sort((a, b) => {
      const timeA = a.messages.length > 0 ? new Date(a.messages[a.messages.length - 1].createdAt).getTime() : 0;
      const timeB = b.messages.length > 0 ? new Date(b.messages[b.messages.length - 1].createdAt).getTime() : 0;
      return timeB - timeA;
    });

    const gerais = sorted.filter((c) => c.status === 'gerais');
    const atendimentos = sorted.filter((c) => c.status === 'atendimentos');
    const encerrados = sorted.filter((c) => c.status === 'encerrados');

    return { gerais, atendimentos, encerrados };
  }, [chats]);

  const TABS = [
    { id: 'gerais', label: 'Fila', data: sortedChats.gerais },
    { id: 'atendimentos', label: 'Atendendo', data: sortedChats.atendimentos },
    { id: 'encerrados', label: 'Encerrados', data: sortedChats.encerrados }
  ] as const;

  const getBaseChatsForTab = useCallback(
    (tabId: typeof TABS[number]['id']) => {
      switch (tabId) {
        case 'gerais':
          return sortedChats.gerais;
        case 'atendimentos':
          return sortedChats.atendimentos;
        case 'encerrados':
        default:
          return sortedChats.encerrados;
      }
    },
    [sortedChats]
  );

  const filterChatByControls = useCallback(
    (chat: Chat) => {
      const now = Date.now();
      const visibleMessages = showMarketing
        ? chat.messages
        : chat.messages.filter(m => !isMarketingMessage(m));
      if (!showMarketing && visibleMessages.length === 0) {
        return false;
      }

      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'open' ? chat.status !== 'encerrados' : chat.status === 'encerrados');

      const chatAgentId = chat.agent?.id || chat.agentId;
      // Client-side ownership filter is now redundant if server filters correctly, 
      // but we keep it for safety or if mixed data is present.
      // Actually, if we fetch 'everyone', we might want to filter 'mine' on client?
      // No, if we fetch 'everyone', we want to see everyone.
      // If we fetch 'mine', we want to see mine.
      // So this filter should match the server state.

      const matchesOwner =
        ownershipFilter === 'everyone' ||
        chatAgentId === currentUser.id ||
        chat.status === 'gerais';

      const matchesUnread = !onlyUnread || (chat.unreadCount ?? 0) > 0;
      const matchesUnassigned = !showUnassignedOnly || !chat.agent;
      const snoozedUntil = snoozedUntilMap[chat.id];
      const matchesSnooze = !snoozedUntil || snoozedUntil <= now;

      // Search Logic
      const query = debouncedSearchTerm.toLowerCase(); // Changed to debouncedSearchTerm
      const protocol = chat.protocol || buildChatProtocol(chat.id);
      const matchesSearch =
        !query ||
        (chat.contact.name || '').toLowerCase().includes(query) ||
        (chat.contact.phone || '').includes(query) ||
        (protocol || '').toLowerCase().includes(query) ||
        (chat.id || '').toLowerCase().includes(query) ||
        visibleMessages.some(m => (m.content || '').toLowerCase().includes(query));

      return matchesStatus && matchesOwner && matchesUnread && matchesUnassigned && matchesSearch && matchesSnooze;
    },
    [statusFilter, ownershipFilter, onlyUnread, showUnassignedOnly, currentUser.id, debouncedSearchTerm, showMarketing, snoozedUntilMap] // Changed to debouncedSearchTerm
  );

  const filteredChats = useMemo(() => {
    return getBaseChatsForTab(activeTab).filter(filterChatByControls);
  }, [activeTab, getBaseChatsForTab, filterChatByControls, showMarketing]);

  const handleLoadMore = async () => {
    if (isLoadingMore || !currentUser.activeWorkspaceId) return;
    setIsLoadingMore(true);

    let oldestDate: string | null = null;
    if (chats.length > 0) {
      const dates = chats.map(c => c.updatedAt ? new Date(c.updatedAt).getTime() : 0).filter(t => t > 0);
      if (dates.length > 0) {
        const minDate = Math.min(...dates);
        oldestDate = new Date(minDate).toISOString();
      }
    }

    if (!oldestDate) {
      setIsLoadingMore(false);
      return;
    }

    const result = await loadMoreChatsAction({
      workspaceId: currentUser.activeWorkspaceId,
      limit: 20,
      before: oldestDate,
      ownership: ownershipFilter
    });

    if (result.chats) {
      appendChats(result.chats);
      setHasMoreChats(result.hasMoreChats);
    }

    setIsLoadingMore(false);
  };

  return (
    <div
      className={cn(
        "flex h-full shrink-0 flex-col border-r border-border bg-white dark:bg-black dark:border-white/10 transition-none",
        "w-full md:w-[450px] md:min-w-[450px] md:max-w-[450px]",
        className
      )}
    >
      {/* Header */}
      <div className="p-4 xl:p-5 flex-shrink-0 border-b border-border dark:border-white/10 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg md:text-xl font-bold text-foreground tracking-tight">Conversas</h2>
          <div className="flex items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Filtros" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted">
                  <Filter className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 p-4 space-y-4 bg-popover border-border text-popover-foreground">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Responsável</p>
                  <RadioGroup
                    value={ownershipFilter}
                    onValueChange={(value) => setOwnershipFilter(value as 'mine' | 'everyone')}
                    className="mt-2 space-y-2"
                  >
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <RadioGroupItem value="mine" id="owner-mine" className="border-border text-blue-500" />
                      <Label htmlFor="owner-mine" className="cursor-pointer text-foreground">Somente minhas conversas</Label>
                    </div>
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <RadioGroupItem value="everyone" id="owner-all" className="border-border text-blue-500" />
                      <Label htmlFor="owner-all" className="cursor-pointer text-foreground">Todos os atendentes</Label>
                    </div>
                  </RadioGroup>
                </div>

                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</p>
                  <RadioGroup
                    value={statusFilter}
                    onValueChange={(value) => setStatusFilter(value as 'all' | 'open' | 'closed')}
                    className="mt-2 space-y-2"
                  >
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <RadioGroupItem value="all" id="status-all" className="border-border text-blue-500" />
                      <Label htmlFor="status-all" className="cursor-pointer text-foreground">Todos</Label>
                    </div>
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <RadioGroupItem value="open" id="status-open" className="border-border text-blue-500" />
                      <Label htmlFor="status-open" className="cursor-pointer text-foreground">Abertos (Fila + Atendendo)</Label>
                    </div>
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <RadioGroupItem value="closed" id="status-closed" className="border-border text-blue-500" />
                      <Label htmlFor="status-closed" className="cursor-pointer text-foreground">Encerrados</Label>
                    </div>
                  </RadioGroup>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-foreground">Somente não lidas</p>
                      <p className="text-xs text-muted-foreground">Priorize contatos aguardando resposta</p>
                    </div>
                    <Switch checked={onlyUnread} onCheckedChange={setOnlyUnread} className="data-[state=checked]:bg-blue-600" />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-foreground">Somente sem responsável</p>
                      <p className="text-xs text-muted-foreground">Ótimo para dividir a fila com o time</p>
                    </div>
                    <Switch checked={showUnassignedOnly} onCheckedChange={setShowUnassignedOnly} className="data-[state=checked]:bg-blue-600" />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-foreground">Mostrar mensagens de Marketing</p>
                      <p className="text-xs text-muted-foreground">Oculta mensagens de marketing no preview</p>
                    </div>
                    <Switch checked={showMarketing} onCheckedChange={setShowMarketing} className="data-[state=checked]:bg-blue-600" />
                  </div>
                </div>
              </PopoverContent>
            </Popover>

            {/* Bulk Mode Toggle - Only in 'atendimentos' tab usually, but user might want it generally */}
            {activeTab === 'atendimentos' && !isForwarding && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={isBulkMode ? "secondary" : "ghost"}
                      size="icon"
                      className={cn("h-8 w-8 text-muted-foreground hover:text-white hover:bg-white/10", isBulkMode && "bg-blue-500/20 text-blue-400")}
                      onClick={toggleBulkMode}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {isBulkMode ? "Sair da seleção em massa" : "Selecionar conversas para encerrar"}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            {currentUser.activeWorkspaceId && (
              <NewConversationDialog
                workspaceId={currentUser.activeWorkspaceId}
                onActionSuccess={onUpdate}
                trigger={
                  <Button size="sm" className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-md transition-all duration-300 border-0">
                    <MessageSquare className="mr-2 h-4 w-4" />
                    Nova Conversa
                  </Button>
                }
              />
            )}
          </div>
        </div>
        <div className="relative group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-blue-400 transition-colors" />
          <Input
            placeholder="Pesquisar por nome, telefone ou mensagem..."
            className="pl-9 bg-muted/50 border-transparent focus:border-primary/20 focus:bg-background focus:ring-1 focus:ring-primary/20 transition-all rounded-xl text-foreground placeholder:text-muted-foreground dark:bg-white/5 dark:placeholder:text-white/50"
            value={searchTerm} // Changed to searchTerm
            onChange={(e) => setSearchTerm(e.target.value)} // Changed to setSearchTerm
            aria-label="Pesquisar conversas"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && searchTerm.trim()) { // Changed to searchTerm
                e.preventDefault();
                e.stopPropagation();
                setIsSearchDialogOpen(true);
              }
            }}
          />
        </div>
      </div>

      <SearchDetailsDialog
        isOpen={isSearchDialogOpen}
        onOpenChange={setIsSearchDialogOpen}
        searchQuery={searchTerm} // Changed to searchTerm
        chats={chats}
        workspaceId={currentUser.activeWorkspaceId}
        onSelectChat={setSelectedChat}
      />

      {/* Online agents */}
      <div className="px-4 py-3 flex-shrink-0 border-b border-border bg-muted/30 dark:bg-black dark:border-white/10">
        <h3 className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
          Agentes Online ({onlineAgents.length})
          {isOffline && (
            <Badge variant="destructive" className="h-4 text-[10px] px-1 animate-pulse">
              Offline - Reconectando...
            </Badge>
          )}
        </h3>
        <HoverCard openDelay={200}>
          <div className={cn("flex flex-wrap items-center gap-2 transition-opacity duration-300", isOffline ? "opacity-50 grayscale pointer-events-none" : "opacity-100")}>
            {onlineAgents.length === 0 ? (
              <div className="flex gap-2">
                <Skeleton className="h-8 w-8 rounded-full" />
                <Skeleton className="h-8 w-8 rounded-full" />
                <Skeleton className="h-8 w-8 rounded-full" />
              </div>
            ) : (
              onlineAgents.map((agent) => (
                <HoverCard key={agent.user.id}>
                  <HoverCardTrigger asChild>
                    <div
                      className="relative cursor-pointer hover:scale-110 transition-transform duration-200"
                      onClick={() => setSelectedAgent(agent.user)}
                    >
                      <Avatar className="h-8 w-8 border-2 border-border ring-2 ring-green-500/30 shadow-[0_0_10px_rgba(34,197,94,0.3)]">
                        <AvatarImage src={agent.user.avatar} className="object-cover" />
                        <AvatarFallback className="bg-gradient-to-br from-green-600 to-emerald-800 text-white text-xs font-bold">{agent.user.name.charAt(0)}</AvatarFallback>
                      </Avatar>
                      <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-green-500 border-2 border-background animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.8)]"></span>
                    </div>
                  </HoverCardTrigger>
                  <HoverCardContent className="w-80 p-0 border-border bg-popover text-popover-foreground shadow-2xl rounded-xl overflow-hidden">
                    <div className="relative h-20 bg-gradient-to-r from-green-600/20 to-emerald-900/20 p-4">
                      <div className="absolute inset-0 bg-[url('/grid-pattern.svg')] opacity-10" />
                      <div className="flex items-center gap-3 relative z-10">
                        <Avatar className="h-12 w-12 border-2 border-white/10 shadow-lg">
                          <AvatarImage src={agent.user.avatar} />
                          <AvatarFallback className="bg-green-700 text-white font-bold">{agent.user.name.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-bold text-lg leading-tight">{agent.user.name}</p>
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
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
                          // Close hover card by clicking body or something, but mainly trigger action
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
            {onlineAgents.length === 0 && (
              // This case only happens if we are sure nobody is online, but skeleton handles "loading" effectively.
              // We might want a "no agents" state if we are done loading.
              // For now, let's keep the skeleton logic as "loading" or empty state.
              <p className="text-xs text-muted-foreground italic sr-only">Nenhum agente online</p>
            )}
          </div>
        </HoverCard>
      </div>

      <AgentProfileSheet
        member={selectedAgent}
        isOpen={!!selectedAgent}
        onClose={() => setSelectedAgent(null)}
        isOnline={true}
      />

      {/* Tabs */}
      <div className="p-3 xl:p-4 flex-shrink-0 border-b border-border dark:border-white/10">
        <div className="flex items-center bg-muted/50 rounded-lg p-1 border border-border dark:bg-black/40 dark:border-white/5">
          {TABS.map((tab) => {
            const filteredCount = getBaseChatsForTab(tab.id).filter(filterChatByControls).length;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 text-xs font-medium py-1.5 rounded-md transition-all duration-200',
                  activeTab === tab.id
                    ? 'bg-white shadow-sm text-foreground dark:bg-white/10 dark:text-white'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted dark:hover:bg-white/5'
                )}
              >
                <span>{tab.label}</span>
                {filteredCount > 0 && (
                  <Badge
                    className={cn(
                      'px-1.5 h-4 text-[10px] min-w-[16px] justify-center',
                      activeTab === tab.id
                        ? 'bg-blue-500 text-white'
                        : 'bg-muted text-muted-foreground'
                    )}
                  >
                    {filteredCount}
                  </Badge>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Bulk Action Bar */}
      {
        isBulkMode && (
          <div className="p-2 border-b border-border bg-blue-500/10 flex items-center justify-between animate-in slide-in-from-top-2">
            <div className="flex items-center gap-2 px-2">
              <p className="text-sm font-medium text-blue-800">{selectedBulkChats.size} selecionado(s)</p>
              <Button variant="link" size="sm" className="h-auto p-0 text-blue-600 hover:text-blue-700" onClick={handleSelectAllBulk}>
                {filteredChats.length > 0 && filteredChats.every(c => selectedBulkChats.has(c.id)) ? "Deselecionar todos" : "Selecionar todos"}
              </Button>
            </div>
            <div className="flex items-center gap-1">
              <Dialog open={isBulkDialogOpen} onOpenChange={setIsBulkDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="destructive" disabled={selectedBulkChats.size === 0}>
                    Encerrar
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
                    <p className="text-xs text-muted-foreground mt-2">
                      Se deixar em branco, o modelo de encerramento padrão será usado (se configurado).
                    </p>
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
            </div>
          </div>
        )
      }

      {/* Chat list */}
      <div className="flex-1 overflow-hidden relative flex flex-col min-h-0 bg-transparent">
        {filteredChats.length > 0 ? (
          <>
            <Virtuoso
              style={{ height: '100%', width: '100%' }}
              data={filteredChats}
              itemContent={(index, chat) => (
                <div className="pb-1 px-3">
                  <ChatListItem
                    key={chat.id}
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
                    snoozedUntil={snoozedUntilMap[chat.id]}
                    onSnooze={chat.status === 'atendimentos' ? handleSnooze : undefined}
                    onUnsnooze={chat.status === 'atendimentos' ? handleUnsnooze : undefined}
                    onAssign={chat.status === 'gerais' ? handleAssignChat : undefined}
                    onPrefetch={onPrefetch}
                  />
                </div>
              )}
              endReached={() => {
                if (hasMoreChats && activeTab === 'encerrados' && !isLoadingMore) {
                  handleLoadMore();
                }
              }}
              components={{
                Footer: () => {
                  return (
                    <>
                      {hasMoreChats && activeTab === 'encerrados' && (
                        <div className="p-2 flex justify-center">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleLoadMore}
                            disabled={isLoadingMore}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            {isLoadingMore ? (
                              <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : (
                              <RefreshCw className="h-4 w-4 mr-2" />
                            )}
                            Carregar mais conversas
                          </Button>
                        </div>
                      )}
                    </>
                  );
                },
              }}
            />
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center space-y-3 opacity-50">
            {activeTab === 'atendimentos' ? (
              <>
                <div className="p-4 bg-blue-500/10 rounded-full mb-2 ring-1 ring-blue-500/20">
                  <div className="h-8 w-8 text-blue-400">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></svg>
                  </div>
                </div>
                <h3 className="font-semibold text-foreground">Nenhuma conversa</h3>
                <p className="text-sm text-muted-foreground max-w-[200px]">
                  Você não é responsável por nenhuma conversa no momento
                </p>
                {currentUser.activeWorkspaceId && (
                  <div className="pt-2 opacity-100 pointer-events-auto">
                    <NewConversationDialog
                      workspaceId={currentUser.activeWorkspaceId}
                      onActionSuccess={onUpdate}
                      trigger={
                        <Button variant="outline" className="gap-2 border-blue-500/20 hover:bg-blue-500/10 text-blue-600 hover:text-blue-700">
                          <PlusCircle className="h-4 w-4" />
                          Nova Conversa
                        </Button>
                      }
                    />
                  </div>
                )}
              </>
            ) : (
              <>
                <MessageSquare className="h-12 w-12 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">Nenhuma conversa encontrada nesta seção.</p>
              </>
            )}
          </div>
        )}
      </div>

      {/* Forwarding Footer */}
      {
        isForwarding && (
          <div className="p-4 border-t border-border bg-background border-t-2 shadow-inner">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-foreground font-medium">
                {selectedForwardingChatIds?.size || 0} selecionados
              </span>
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

      {/* Assign Confirmation Dialog */}
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
    </div >
  );
};
