'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo, useLayoutEffect } from 'react';
import { generateChatSummaryAction } from '@/actions/ai';
import { v4 as uuidv4 } from 'uuid';
import { formatInTimeZone } from 'date-fns-tz';
import { ptBR } from 'date-fns/locale';
import Image from 'next/image';
import Link from 'next/link';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
    Paperclip,
    Send,
    Smile,
    MoreVertical,
    Bot,
    MessageSquare,
    LogOut,
    FileDown,
    Info,
    Check,
    CheckCheck,
    Trash2,
    File as FileIcon,
    PlayCircle,
    Mic,
    Download,
    Bold,
    Italic,
    Strikethrough,
    Hand,
    History,
    Eye,
    EyeOff,
    Clock,
    Phone,
    Video,
    ArrowLeft,
    ArrowRightLeft,
    XCircle,
    X,
    Copy,
    StickyNote,
    MessageSquareQuote,
    Search,
    Globe,
    Users,
    Lock,
    Loader2,
    Plus,
    Sparkles,
    MapPin,
    FileText,
    Brain,
    Contrast,
    Languages,
    Pencil
} from 'lucide-react';
import { uploadFileToStorage } from '@/lib/supabase/storage';
import { createClient } from '@/lib/supabase/client';
import { type Chat, type Message, type User, Tag, MessageMetadata, Contact, AutopilotConfig, NexusFlowInstance, Shortcut } from '@/lib/types';
import SmartReplies from './smart-replies';
import ChatSummary from './chat-summary';
import { generateAgentResponse } from '@/ai/flows/auto-responder';
import { Switch } from '../ui/switch';
import { Label } from '../ui/label';
import { useToast } from '@/hooks/use-toast';
import { fetchSGPContracts, createSGPServiceOrder } from '@/plugins/sgp/actions';
import { Separator } from '../ui/separator';
import { useInboxStore } from '@/hooks/use-inbox-store';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Textarea } from '../ui/textarea';
import { getContactMessages, toggleChatAutopilot, updateChatCopilotModeAction } from '@/actions/chats';
import { useFormStatus } from 'react-dom';
import { deleteMessageAction } from '@/actions/evolution-api';
import { sendAutomatedMessageAction, sendMediaAction, sendInternalNoteAction, getMessageStatusBatchAction, retryMessageAction } from '@/actions/messages';
import { getAutopilotConfig, addDocumentToKnowledgeBase } from '@/actions/autopilot';
import { getShortcuts } from '@/actions/shortcuts';
import { generateChatHtml } from '@/lib/chat-export';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import MediaPreview, { type MediaFileType } from './media-preview';
import { cn, formatWhatsappText, formatMessageDate } from '@/lib/utils';
import MessageItem from './message-item';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '../ui/popover';
import EmojiPicker, { type EmojiClickData } from 'emoji-picker-react';
import ContentEditable from 'react-contenteditable';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { AudioRecorder } from './audio-recorder';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { reportClientMetric } from '@/lib/observability/client';
import { guardedAssignChat, guardedCloseChat, guardedSendAgentMessage } from '@/actions/chat-guards';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { motion } from 'framer-motion';

import { FaWhatsapp, FaInstagram, FaFacebookMessenger } from 'react-icons/fa6';
import { Badge } from '../ui/badge';



interface ChatPanelProps {
    chat: Chat | null;
    currentUser: User;
    onActionSuccess: () => void;
    closeReasons: Tag[];
    showFullHistory: boolean;
    setShowFullHistory: (show: boolean) => void;
    tabId: string;
    onLoadOlderMessages: () => Promise<void> | void;
    canLoadOlder: boolean;
    workspaceTimezone: string;
    onToggleContactPanel: () => void;
    onForwardMessage: (message: Message) => void;
    highContrast: boolean;
    onToggleHighContrast: () => void;
    isRTL: boolean;
    onToggleRTL: () => void;
    onBack?: () => void;
}

type TextSendJob = {
    chatId: string;
    messageId: string;
    content: string;
    isInternalNote: boolean;
    metadata: MessageMetadata;
    startedAt: number;
};

function CloseChatDialog({ chat, onActionSuccess, reasons, isOpen, onOpenChange }: { chat: Chat, onActionSuccess: () => void, reasons: Tag[], isOpen?: boolean, onOpenChange?: (open: boolean) => void }) {
    const [internalIsOpen, setInternalIsOpen] = React.useState(false);
    const [isSubmitting, setIsSubmitting] = React.useState(false);
    const [reasonTagId, setReasonTagId] = React.useState<string | null>(null);
    const [notes, setNotes] = React.useState('');
    const { toast } = useToast();
    const [isGeneratingSummary, setIsGeneratingSummary] = React.useState(false);

    // SGP State
    const [sgpContracts, setSgpContracts] = React.useState<{ id: string, label: string }[]>([]);
    const [selectedSgpContract, setSelectedSgpContract] = React.useState<string>('');
    const [isLoadingSgp, setIsLoadingSgp] = React.useState(false);

    const show = isOpen !== undefined ? isOpen : internalIsOpen;
    const setShow = onOpenChange || setInternalIsOpen;

    useEffect(() => {
        if (show) {
            setSgpContracts([]);
            setSelectedSgpContract('');
            setIsLoadingSgp(true);
            fetchSGPContracts(chat.id).then(res => {
                if (res.success && res.contracts && res.contracts.length > 0) {
                    setSgpContracts(res.contracts);
                }
                setIsLoadingSgp(false);
            });
        }
    }, [show, chat.id]);

    const filteredReasons = useMemo(() => {
        return reasons.filter(reason => {
            if (!reason.team_ids || reason.team_ids.length === 0) return true;
            return chat.team_id && reason.team_ids.includes(chat.team_id);
        });
    }, [reasons, chat.team_id]);

    const handleGenerateSummary = async () => {
        setIsGeneratingSummary(true);
        const result = await generateChatSummaryAction(chat.id);
        if (result.success && result.summary) {
            setNotes(prev => prev ? `${prev}\n\n[Resumo IA]: ${result.summary}` : `[Resumo IA]: ${result.summary}`);
            toast({ title: "Resumo gerado!", description: "O resumo foi adicionado às notas." });
        } else {
            toast({ title: "Erro ao gerar resumo", description: result.error || "Falha desconhecida.", variant: "destructive" });
        }
        setIsGeneratingSummary(false);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // Contract selection is optional - if not selected, no SGP OS will be created
        // This allows closing without generating an OS when not needed

        setIsSubmitting(true);

        let additionalMetadata: Record<string, any> = {};

        if (selectedSgpContract) {
            const osResult = await createSGPServiceOrder(chat.id, selectedSgpContract, notes);
            if (!osResult.success) {
                toast({ title: "Erro ao criar OS no SGP", description: osResult.error, variant: "destructive" });
                setIsSubmitting(false);
                return; // Stop close if OS creation fails? User probably wants to know.
            }
            // SGP OS Created
            const protocol = osResult.apiResponse?.protocolo || osResult.apiResponse?.id || 'Unknown';
            additionalMetadata = {
                sgp_contract_id: selectedSgpContract,
                sgp_os_protocol: protocol,
                sgp_os_created: true
            };
            toast({ title: "OS criada no SGP", description: `Protocolo: ${protocol}` });
        }

        // Always send close message - the template will only be sent if configured in workspace settings
        const result = await guardedCloseChat(chat.id, reasonTagId, notes, true, additionalMetadata);

        if (result.success) {
            toast({ title: "Atendimento encerrado com sucesso!" });
            setShow(false);
            onActionSuccess();
        } else {
            toast({ title: "Erro ao encerrar", description: result.error, variant: 'destructive' });
        }
        setIsSubmitting(false);
    };

    return (
        <Dialog open={show} onOpenChange={setShow}>
            {!onOpenChange && (
                <DialogTrigger asChild>
                    <Button variant="outline">
                        <LogOut className="mr-2 h-4 w-4" /> Encerrar Atendimento
                    </Button>
                </DialogTrigger>
            )}
            <DialogContent>
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>Encerrar Atendimento</DialogTitle>
                        <DialogDescription>
                            Selecione um motivo e adicione uma nota final para encerrar esta conversa.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="close-reason">Motivo do Encerramento</Label>
                            <Select onValueChange={setReasonTagId} value={reasonTagId || ''}>
                                <SelectTrigger id="close-reason">
                                    <SelectValue placeholder="Selecione um motivo..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {filteredReasons.map(reason => (
                                        <SelectItem key={reason.id} value={reason.id}>{reason.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* SGP Contract Selection */}
                        {(isLoadingSgp || sgpContracts.length > 0) && (
                            <div className="space-y-2">
                                <Label htmlFor="sgp-contract">Contrato SGP <span className="text-xs text-muted-foreground">(Ordem de Serviço será gerada)</span></Label>
                                {isLoadingSgp ? (
                                    <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        <span>Buscando contratos...</span>
                                    </div>
                                ) : (
                                    <Select onValueChange={setSelectedSgpContract} value={selectedSgpContract}>
                                        <SelectTrigger id="sgp-contract">
                                            <SelectValue placeholder="Selecione o contrato..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {sgpContracts.map(contract => (
                                                <SelectItem key={contract.id} value={contract.id}>{contract.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}
                            </div>
                        )}
                        <div className="space-y-2">
                            <div className="flex justify-between items-center">
                                <Label htmlFor="close-notes">Notas Internas (Opcional)</Label>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleGenerateSummary}
                                    disabled={isGeneratingSummary}
                                    className="h-6 text-xs text-blue-400 hover:text-blue-300 hover:bg-blue-400/10"
                                >
                                    {isGeneratingSummary ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />}
                                    Gerar Resumo com IA
                                </Button>
                            </div>
                            <Textarea id="close-notes" placeholder="Adicione uma observação sobre o encerramento..." value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[100px]" />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="ghost" onClick={() => setShow(false)}>Cancelar</Button>
                        <Button type="submit" variant="destructive" disabled={isSubmitting}>
                            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Encerrar Atendimento
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

function SendMessageButton({ disabled }: { disabled?: boolean }) {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" size="icon" className={cn(
            "h-10 w-10 rounded-xl transition-all duration-200",
            !disabled && !pending
                ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
        )} disabled={pending || disabled} aria-label="Enviar mensagem">
            {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
        </Button>
    )
}

export default function ChatPanel({
    chat,
    currentUser,
    onActionSuccess,
    closeReasons,
    showFullHistory,
    setShowFullHistory,
    tabId,
    onLoadOlderMessages,
    canLoadOlder,
    workspaceTimezone,
    onToggleContactPanel,
    onForwardMessage,
    highContrast,
    onToggleHighContrast,
    isRTL,
    onToggleRTL,
    onBack,
}: ChatPanelProps) {

    const updateChat = useInboxStore(state => state.updateChat);
    const drafts = useInboxStore(state => state.drafts);
    const setDraft = useInboxStore(state => state.setDraft);
    const [newMessage, setNewMessage] = useState('');
    const debouncedMessageInput = useDebouncedValue(newMessage, 220);
    const [mediaFiles, setMediaFiles] = useState<MediaFileType[]>([]);
    const chatRef = useRef(chat?.id);

    // Robust Draft Switching Logic (No Flicker)
    useLayoutEffect(() => {
        if (chat?.id !== chatRef.current) {
            // Save draft for previous chat
            const previousChatId = chatRef.current;
            if (previousChatId) {
                setDraft(previousChatId, newMessage);
            }

            // Load draft for new chat
            if (chat?.id) {
                // Must read drafts from the current render scope
                setNewMessage(drafts[chat.id] || '');
            } else {
                setNewMessage('');
            }
            chatRef.current = chat?.id;
        }
    }, [chat?.id, drafts, setDraft, newMessage]); // Dependencies for closure freshness

    // Auto-save while typing (Debounced)
    useEffect(() => {
        if (!chat?.id) return;
        const timer = setTimeout(() => {
            setDraft(chat.id, newMessage);
        }, 500);
        return () => clearTimeout(timer);
    }, [newMessage, chat?.id, setDraft]);

    const [isAiAgentActive, setIsAiAgentActive] = useState(chat?.is_autopilot_active ?? false);
    const [isInternalNote, setIsInternalNote] = useState(false);
    const autopilotSwitchTouchedRef = useRef(false);
    const [isAiTyping, setIsAiTyping] = useState(false);
    const canLoadOlderRef = useRef(canLoadOlder);
    const [allContactMessages, setAllContactMessages] = useState<Message[]>([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);
    const [sendState, setSendState] = useState<'idle' | 'sending' | 'error'>('idle');
    const [lastSendError, setLastSendError] = useState<string | null>(null);
    const lastSendDraftRef = useRef<{ text: string; media: MediaFileType[]; isNote: boolean } | null>(null);
    const textSendQueueRef = useRef<TextSendJob[]>([]);
    const textSendProcessingRef = useRef(false);
    const [textSendQueueCount, setTextSendQueueCount] = useState(0);
    const retryingMessagesRef = useRef(new Set<string>());

    // AI Copilot Suggestion State
    const [aiSuggestion, setAiSuggestion] = useState<{ text: string; configName: string } | null>(null);

    // Virtualization refs/state removed
    // const messageHeightsRef = useRef<Map<string, number>>(new Map()); 

    const [autopilotConfig, setAutopilotConfig] = useState<AutopilotConfig | null>(null);
    const [autopilotRules, setAutopilotRules] = useState<NexusFlowInstance[]>([]);
    const [autopilotAgents, setAutopilotAgents] = useState<AutopilotConfig[]>([]);
    const isProtocolScoped = !!(chat as any)?.protocolScoped;
    const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
    const [showShortcutSuggestions, setShowShortcutSuggestions] = useState(false);
    const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);

    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const contentEditableRef = useRef<any>(null);
    const processedMessageIds = useRef(new Set());
    const savedRange = useRef<Range | null>(null);
    const userScrolledUpRef = useRef(false);
    const isFetchingHistoryRef = useRef(false);
    const previousScrollHeightRef = useRef(0);
    const previousFirstMessageIdRef = useRef<string | null>(null);
    const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false);
    const appendMessagesToChat = useInboxStore((state) => state.appendMessagesToChat);
    const replaceOptimisticMessage = useInboxStore((state) => state.replaceOptimisticMessage);
    const updateMessage = useInboxStore((state) => state.updateMessage);
    const messagesByChat = useInboxStore((state) => state.messagesByChat); // Connect to store messages
    const statusPollInFlightRef = useRef(false);

    useEffect(() => {
        canLoadOlderRef.current = !((chat as any)?.protocolScoped) && canLoadOlder;
    }, [canLoadOlder, chat]);

    const [isCloseDialogOpen, setIsCloseDialogOpen] = useState(false);

    const { toast } = useToast();

    const handleAiSwitchChange = async (checked: boolean) => {
        autopilotSwitchTouchedRef.current = true;
        setIsAiAgentActive(checked);

        let agentId = chat?.autopilot_config_id || undefined;
        if (checked && !agentId && autopilotAgents.length > 0) {
            const primary = autopilotAgents.find(a => a.is_primary) || autopilotAgents[0];
            agentId = primary.id;
        }

        if (chat) {
            updateChat(chat.id, {
                is_autopilot_active: checked,
                autopilot_config_id: agentId,
                copilot_mode: checked ? 'suggest' : 'off'
            });
            await toggleChatAutopilot(chat.id, checked, agentId || null);

            if (checked && agentId) {
                const selected = autopilotAgents.find(a => a.id === agentId);
                if (selected) setAutopilotConfig(selected);
            }
        }
    };

    const handleAgentChange = async (agentId: string) => {
        autopilotSwitchTouchedRef.current = true;
        setIsAiAgentActive(true);
        if (chat) {
            updateChat(chat.id, { is_autopilot_active: true, autopilot_config_id: agentId });
            await toggleChatAutopilot(chat.id, true, agentId);

            const selected = autopilotAgents.find(a => a.id === agentId);
            if (selected) setAutopilotConfig(selected);
        }
    };

    const handleCopilotModeChange = async (mode: 'auto' | 'suggest') => {
        if (chat) {
            updateChat(chat.id, { copilot_mode: mode });
            await updateChatCopilotModeAction(chat.id, mode);
            toast({ title: `Modo alterado para ${mode === 'auto' ? 'Automático' : 'Sugestão'}` });
        }
    };

    const fetchAutopilotData = useCallback(async () => {
        if (!currentUser.activeWorkspaceId) return;
        const data = await getAutopilotConfig(currentUser.activeWorkspaceId);
        if (!data.error) {
            setAutopilotConfig(data.config);
            setAutopilotRules(data.rules || []);
            setAutopilotAgents(data.agents || []);
        } else {
            console.error("Failed to fetch autopilot config:", data.error);
        }
    }, [currentUser.activeWorkspaceId]);

    const fetchShortcuts = useCallback(async () => {
        if (!currentUser.activeWorkspaceId) return;
        const data = await getShortcuts(currentUser.activeWorkspaceId);
        if (!data.error) {
            setShortcuts(data.shortcuts || []);
        }
    }, [currentUser.activeWorkspaceId]);

    useEffect(() => {
        fetchAutopilotData();
        fetchShortcuts();
    }, [fetchAutopilotData, fetchShortcuts]);

    useEffect(() => {
        setIsAiAgentActive(chat?.is_autopilot_active ?? false);
        autopilotSwitchTouchedRef.current = false;
        setAiSuggestion(null); // Clear suggestion when chat changes
    }, [chat?.id, chat?.is_autopilot_active]);

    // Subscribe to AI suggestions via Realtime
    useEffect(() => {
        console.log('[CHAT_PANEL] Checking copilot subscription. Mode:', chat?.copilot_mode, 'ID:', chat?.id);
        if (!chat?.id || chat.copilot_mode !== 'suggest') return;

        const supabase = createClient();
        const channel = supabase.channel(`chat:${chat.id}`)
            .on('broadcast', { event: 'ai_suggestion' }, (payload) => {
                console.log('[CHAT_PANEL] Received AI suggestion:', payload);
                if (payload.payload?.suggestion) {
                    setAiSuggestion({
                        text: payload.payload.suggestion,
                        configName: payload.payload.configName || 'IA'
                    });
                }
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [chat?.id, chat?.copilot_mode]);

    const tryLoadOlder = useCallback(() => {
        // Virtuoso calls this when we reach top, so we don't need to check scrollTop manually anymore.
        if ((chat as any)?.protocolScoped) return;
        if (!canLoadOlderRef.current || isFetchingHistoryRef.current || showFullHistory) return;

        isFetchingHistoryRef.current = true;
        setIsLoadingOlderMessages(true);
        Promise.resolve(onLoadOlderMessages?.())
            .catch((error) => console.error('[CHAT_PANEL] Failed to load older messages', error))
            .finally(() => {
                isFetchingHistoryRef.current = false;
                setIsLoadingOlderMessages(false);
            });
    }, [onLoadOlderMessages, showFullHistory, chat]);

    useEffect(() => {
        const handleScroll = () => {
            // Logic moved to Virtuoso
        };
        // Removed manual scroll listener
    }, [tryLoadOlder]);


    useEffect(() => {
        if (canLoadOlderRef.current && userScrolledUpRef.current === false) {
            // Auto-scroll logic handled by Virtuoso followOutput
        }
    }, [tryLoadOlder, showFullHistory]);

    useEffect(() => {
        setAllContactMessages([]);
    }, [chat?.contact?.id]);

    useEffect(() => {
        // messageHeightsRef.current.clear(); // Removed
        // setScrollTop(0); // Removed
        userScrolledUpRef.current = false;
        previousScrollHeightRef.current = 0;
    }, [chat?.id]);

    useEffect(() => {
        if (isProtocolScoped) return;
        if (showFullHistory && chat?.contact?.id && currentUser.activeWorkspaceId) {
            setIsLoadingHistory(true);
            getContactMessages({
                contactId: chat.contact.id,
                workspaceId: currentUser.activeWorkspaceId,
                limit: 1000
            })
                .then(res => {
                    if (res.messages) setAllContactMessages(res.messages);
                })
                .catch(err => console.error('[CHAT_PANEL] Failed to load full history', err))
                .finally(() => setIsLoadingHistory(false));
        }
    }, [showFullHistory, chat?.contact?.id, currentUser.activeWorkspaceId, isProtocolScoped]);

    const messagesToRender = useMemo(() => {
        if (isProtocolScoped) {
            return chat?.messages || [];
        }
        if (showFullHistory && allContactMessages.length > 0) {
            return allContactMessages;
        }
        // FIX: Use messagesByChat from store instead of chat.messages (which only has latest)
        return chat && messagesByChat[chat.id] ? messagesByChat[chat.id] : (chat?.messages || []);
    }, [isProtocolScoped, showFullHistory, allContactMessages, chat?.messages, chat?.id, messagesByChat]);

    const pendingStatusIds = useMemo(() => {
        if (!chat?.messages?.length) return [];
        return chat.messages
            .filter((message) => message.chat_id === chat.id)
            .filter((message) => message.from_me && (message.api_message_status || '').toUpperCase() === 'PENDING')
            .map((message) => message.id);
    }, [chat?.id, chat?.messages]);

    useEffect(() => {
        if (!chat?.id || isProtocolScoped || !pendingStatusIds.length) {
            return;
        }

        const intervalId = setInterval(async () => {
            if (statusPollInFlightRef.current) return;
            statusPollInFlightRef.current = true;
            try {
                const result = await getMessageStatusBatchAction(chat.id, pendingStatusIds);
                if (result.error) {
                    console.warn('[STATUS_POLL] Failed to refresh message status:', result.error);
                    return;
                }
                result.statuses.forEach((status) => {
                    if (!status?.id) return;
                    updateMessage(chat.id, status.id, {
                        api_message_status: status.api_message_status || undefined,
                        message_id_from_api: status.message_id_from_api || undefined,
                    });
                });
            } catch (error) {
                console.warn('[STATUS_POLL] Failed to refresh message status:', error);
            } finally {
                statusPollInFlightRef.current = false;
            }
        }, 4000);

        return () => {
            clearInterval(intervalId);
        };
    }, [chat?.id, isProtocolScoped, pendingStatusIds, updateMessage]);

    // Layout effect for manual scroll removed as Virtuoso handles it
    // useLayoutEffect(() => { ... }, [messagesToRender, messagesToRender.length]);

    // VIRTUALIZATION ENABLED
    const visibleMessages = messagesToRender;

    // First Item Index Strategy for Bidirectional Scrolling/Prepend
    // Strategy: Update state DURING render if changes are detected.
    // This pattern forces React to restart the render with the new value immediately,
    // ensuring Virtuoso never renders with mismatched data/index.
    const START_INDEX = 10000;
    const [firstItemIndex, setFirstItemIndex] = useState(START_INDEX);
    const [prevVisibleMessages, setPrevVisibleMessages] = useState<Message[]>(visibleMessages);

    // Reset when chat ID changes completely
    const [prevChatId, setPrevChatId] = useState(chat?.id);
    if (chat?.id !== prevChatId) {
        setPrevChatId(chat?.id);
        setFirstItemIndex(START_INDEX);
        setPrevVisibleMessages(visibleMessages);
    }

    // Detect Prepend logic
    if (visibleMessages !== prevVisibleMessages) {
        const currentLen = visibleMessages.length;
        const prevLen = prevVisibleMessages.length;
        const currentFirstId = visibleMessages.length > 0 ? visibleMessages[0].id : null;
        const prevFirstId = prevVisibleMessages.length > 0 ? prevVisibleMessages[0].id : null;

        // Update the tracking state
        setPrevVisibleMessages(visibleMessages);

        // Calculate offset if it's a prepend
        if (currentLen > prevLen && currentFirstId !== prevFirstId && prevFirstId !== null) {
            const diff = currentLen - prevLen;
            console.log('[VIRTUOSO] Prepend detected (render-phase):', diff, 'Adjusting firstItemIndex.');
            setFirstItemIndex(prev => prev - diff);
        }
    }

    const startIndex = 0;
    const padTop = 0;
    const padBottom = 0;

    const runAiAgent = useCallback(async () => {
        const lastMessage = chat?.messages?.length ? chat.messages[chat.messages.length - 1] : null;

        if (!lastMessage || processedMessageIds.current.has(lastMessage.id)) {
            return;
        }

        const shouldRun = isAiAgentActive &&
            !!chat &&
            lastMessage?.sender?.id !== currentUser.id &&
            !lastMessage?.metadata?.sentBy &&
            !isAiTyping;

        if (!shouldRun) {
            return;
        }

        try {
            setIsAiTyping(true);
            processedMessageIds.current.add(lastMessage.id);
            const chatHistoryForAI = (chat.messages || []).map(m => `${m.sender?.name || 'System'}: ${m.content}`).join('\n');
            const activeRules = autopilotRules.filter(rule => rule.enabled);

            if (!autopilotConfig) {
                console.warn("[AUTOPILOT] Configuração não carregada. Abortando.");
                return;
            }

            const sanitizedContact: Contact = {
                ...(chat.contact as Contact),
                email: chat.contact?.email || '',
            };

            const result = await generateAgentResponse({
                config: autopilotConfig,
                chatId: chat.id,
                customerMessage: lastMessage.content || '',
                chatHistory: chatHistoryForAI,
                rules: activeRules,
                knowledgeBase: autopilotConfig?.knowledge_base || '',
                knowledgeBaseDocuments: autopilotConfig?.knowledge_base_documents || [],
                fallbackReply: autopilotConfig?.default_fallback_reply || '',
                model: autopilotConfig?.ai_model || 'googleai/gemini-2.0-flash',
                contact: sanitizedContact
            });

            if (result?.response) {
                const copilotMode = chat?.copilot_mode || 'auto';

                if (copilotMode === 'suggest') {
                    setAiSuggestion({
                        text: result.response,
                        configName: autopilotConfig?.name || 'IA',
                    });
                    return;
                }

                if (copilotMode === 'off') {
                    return;
                }

                const agentIdForMessage = chat.agent?.id || currentUser.id;
                const sendResult = await sendAutomatedMessageAction(chat.id, result.response, agentIdForMessage);
                if (sendResult.success) {
                    onActionSuccess();
                } else {
                    toast({ title: 'Erro ao Enviar Mensagem', description: sendResult.error, variant: 'destructive' });
                }
            }
        } catch (error: any) {
            console.error('[AUTOPILOT] Erro ao gerar resposta:', error);
            toast({
                title: 'Erro do Agente de IA',
                description: error?.message || 'Não foi possível gerar a resposta automática.',
                variant: 'destructive',
            });
        } finally {
            setIsAiTyping(false);
        }
    }, [autopilotConfig, autopilotRules, chat, currentUser.id, isAiAgentActive, isAiTyping, onActionSuccess, toast]);

    useEffect(() => {
        runAiAgent();
    }, [runAiAgent, chat?.messages]);

    useEffect(() => {
        processedMessageIds.current.clear();
        setIsAiTyping(false);
    }, [chat?.id]);

    const handleDeleteMessage = useCallback(async (messageId: string, instanceName?: string) => {
        if (!instanceName) {
            toast({ title: "Erro", description: "Não foi possível determinar a instância da mensagem.", variant: 'destructive' });
            return;
        }
        const result = await deleteMessageAction(messageId, instanceName);
        if (result.error) {
            toast({ title: "Erro ao apagar mensagem", description: result.error, variant: 'destructive' });
        } else {
            toast({ title: "Mensagem apagada com sucesso!" });
            onActionSuccess();
        }
    }, [toast, onActionSuccess]);

    const handleForwardMessage = useCallback((message: Message) => {
        onForwardMessage(message);
    }, [onForwardMessage]);

    const handleExportChat = () => {
        if (!chat) return;
        const html = generateChatHtml(chat, currentUser);
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const dateStr = new Date().toISOString().split('T')[0];
        const safeName = chat.contact.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        a.download = `chat-${safeName}-${dateStr}.html`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast({ title: "Exportado", description: "Download do HTML iniciado." });
    };

    const handleTrainAgent = async () => {
        if (!chat) return;

        // Simplify conversation for training
        const conversationText = chat.messages
            .map(m => {
                const sender = m.from_me ? 'Atendente' : 'Cliente';
                const body = m.type === 'text' ? m.content : `[${m.type.toUpperCase()}]`;
                return `${sender}: ${body}`;
            })
            .join('\n');

        const title = `Conversa - ${chat.contact.name} - ${new Date().toLocaleDateString()}`;

        const result = await addDocumentToKnowledgeBase(chat.workspace_id, title, conversationText);

        if (result.success) {
            toast({ title: "Agente Treinado!", description: "Conversa adicionada à base de conhecimento." });
        } else {
            toast({ title: "Erro", description: result.error, variant: 'destructive' });
        }
    };

    const generateVideoThumbnail = async (file: File): Promise<string> => {
        return new Promise((resolve) => {
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.muted = true;
            video.playsInline = true;

            video.onloadeddata = () => {
                video.currentTime = 1;
            };

            video.onseeked = () => {
                const canvas = document.createElement('canvas');
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                    resolve(canvas.toDataURL('image/jpeg'));
                } else {
                    resolve('');
                }
                URL.revokeObjectURL(video.src);
            };

            video.onerror = () => {
                resolve('');
                URL.revokeObjectURL(video.src);
            };

            video.src = URL.createObjectURL(file);
        });
    };

    const processFiles = async (files: File[]) => {
        if (!files.length) return;

        const filePromises = files.map(async (file): Promise<MediaFileType> => {
            const reader = new FileReader();
            const base64Promise = new Promise<string>((resolve, reject) => {
                reader.onload = (e) => resolve((e.target?.result as string).split(',')[1]);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });

            const base64 = await base64Promise;
            let mediatype: MediaFileType['mediatype'] = 'document';
            let thumbnail: string | undefined;

            // Fallback detection by extension
            const ext = file.name.split('.').pop()?.toLowerCase();
            const isAudioExt = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus', 'webm'].includes(ext || '');

            if (file.type.startsWith('image/')) mediatype = 'image';
            else if (file.type.startsWith('video/')) {
                mediatype = 'video';
                thumbnail = await generateVideoThumbnail(file);
            } else if (file.type.startsWith('audio/') || isAudioExt) {
                mediatype = 'audio' as any;
            }

            const finalMimeType = file.type || (isAudioExt ? 'audio/mpeg' : file.type) || 'application/octet-stream';

            // Generate unique filename for clipboard-pasted images (which have generic names like 'image.png')
            // Also ensures uniqueness for any file sent in sequence
            const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
            const fileExtension = ext ? `.${ext}` : '';
            const baseName = file.name.replace(/\.[^/.]+$/, ''); // Remove extension
            const uniqueFileName = `${baseName}_${uniqueSuffix}${fileExtension}`;

            return {
                id: `${uniqueFileName}-${file.lastModified}`,
                file,
                name: uniqueFileName,
                type: finalMimeType,
                mediatype,
                base64,
                thumbnail,
            };
        });

        const newFiles = await Promise.all(filePromises);
        setMediaFiles(prev => [...prev, ...newFiles]);
    };

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files || []);
        await processFiles(files);
        event.target.value = '';
    };

    const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
        if (e.clipboardData.files.length > 0) {
            e.preventDefault();
            const files = Array.from(e.clipboardData.files);
            processFiles(files);
            return;
        }

        e.preventDefault();
        const text = e.clipboardData.getData('text/plain');
        document.execCommand("insertText", false, text);
    };

    const normalizePlainText = (text: string) => {
        if (!text) return '';
        // Collapse excessive blank lines and trim trailing spaces per line
        const collapsed = text
            .replace(/\r\n/g, '\n')
            .split('\n')
            .map(line => line.replace(/\s+$/, ''))
            .join('\n')
            .replace(/\n{3,}/g, '\n\n');
        return collapsed.trimEnd();
    };

    const htmlToWhatsappMarkdown = (html: string): string => {
        if (!html) return '';
        const plain = html
            .replace(/<b>(.*?)<\/b>/g, '*$1*')
            .replace(/<strong>(.*?)<\/strong>/g, '*$1*')
            .replace(/<i>(.*?)<\/i>/g, '_$1_')
            .replace(/<em>(.*?)<\/em>/g, '_$1_')
            .replace(/<(s|strike|del)>(.*?)<\/(s|strike|del)>/g, '~$2~')
            .replace(/<\/div>/g, '\n')
            .replace(/<\/p>/g, '\n')
            .replace(/<br\s*\/?>/g, '\n')
            .replace(/&nbsp;/g, ' ')
            .replace(/<[^>]*>/g, '');
        return normalizePlainText(plain);
    };

    const formatOptimisticTimestamp = (date: Date) =>
        date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    const generateOptimisticId = () => uuidv4();

    const lastPlatformMessage = chat?.messages?.length
        ? chat.messages[chat.messages.length - 1]
        : undefined;
    // Check for Meta contact signals
    const hasMetaContact = !!(chat?.metaContactExternalId || chat?.metaContactUsername);
    const isMetaUser = chat?.contact?.name?.startsWith('Meta User');

    let resolvedPlatform = (
        // Priority: message-level platform sources first, then chat-level
        lastPlatformMessage?.platform ||
        lastPlatformMessage?.source_from_api ||
        chat?.source ||
        chat?.instance_type ||
        ''
    ).toString().toLowerCase();

    // Force platform to instagram/messenger if we have reliable Meta signals and current platform is vague/missing
    if (chat?.metaPlatform) {
        resolvedPlatform = chat.metaPlatform;
    } else if (hasMetaContact && !resolvedPlatform.includes('messenger') && !resolvedPlatform.includes('facebook')) {
        resolvedPlatform = 'instagram';
    } else if (isMetaUser && !resolvedPlatform.includes('instagram')) {
        resolvedPlatform = 'messenger';
    }

    const optimisticPlatform =
        resolvedPlatform === 'instagram' || resolvedPlatform === 'messenger'
            ? (resolvedPlatform as 'instagram' | 'messenger')
            : undefined;

    const headerPlatformIcon =
        resolvedPlatform === 'instagram'
            ? <FaInstagram className="h-3 w-3 text-pink-500" />
            : resolvedPlatform === 'messenger'
                ? <FaFacebookMessenger className="h-3 w-3 text-blue-500" />
                : <FaWhatsapp className="h-3 w-3 text-green-500" />;

    const processTextSendQueue = useCallback(async () => {
        if (textSendProcessingRef.current) return;
        textSendProcessingRef.current = true;

        while (true) {
            const job = textSendQueueRef.current[0];
            if (!job) {
                textSendProcessingRef.current = false;
                if (textSendQueueRef.current.length === 0) {
                    break;
                }
                textSendProcessingRef.current = true;
                continue;
            }
            try {
                const result = job.isInternalNote
                    ? await sendInternalNoteAction(job.chatId, job.content, tabId, job.messageId)
                    : await guardedSendAgentMessage(job.chatId, job.content, tabId, job.messageId);

                if (!result.success) {
                    throw new Error(result.error || 'Falha ao enviar mensagem.');
                }

                if (result.message) {
                    const realMessage = {
                        ...result.message,
                        sender: {
                            id: currentUser.id,
                            name: currentUser.name,
                            avatar: currentUser.avatar || currentUser.avatar_url,
                            type: 'user'
                        },
                        formattedDate: formatMessageDate(new Date(result.message.createdAt), workspaceTimezone)
                    } as Message;
                    replaceOptimisticMessage(job.chatId, job.messageId, realMessage);
                } else {
                    updateMessage(job.chatId, job.messageId, {
                        api_message_status: 'PENDING',
                        metadata: { ...job.metadata, send_error: undefined },
                    });
                }

                if (job.isInternalNote) {
                    reportClientMetric('message_sent', performance.now() - job.startedAt);
                }

                onActionSuccess();
                setDraft(job.chatId, '');
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Falha ao enviar mensagem.';
                updateMessage(job.chatId, job.messageId, {
                    api_message_status: 'FAILED',
                    metadata: { ...job.metadata, send_error: errorMessage },
                });
                toast({ title: 'Falha ao enviar', description: errorMessage, variant: 'destructive' });
            } finally {
                reportClientMetric('send_message', performance.now() - job.startedAt, { chatId: job.chatId, media: false });
            }

            textSendQueueRef.current.shift();
            setTextSendQueueCount(textSendQueueRef.current.length);
        }
    }, [currentUser, onActionSuccess, replaceOptimisticMessage, setDraft, tabId, toast, updateMessage, workspaceTimezone]);

    const enqueueTextSend = useCallback((job: TextSendJob) => {
        textSendQueueRef.current.push(job);
        setTextSendQueueCount(textSendQueueRef.current.length);
        void processTextSendQueue();
    }, [processTextSendQueue]);

    const handleRetryMessage = useCallback(async (message: Message) => {
        if (!message?.id) return;
        if ((message.api_message_status || '').toUpperCase() !== 'FAILED') return;
        if (message.metadata?.isInternalNote) return;
        if (retryingMessagesRef.current.has(message.id)) return;

        retryingMessagesRef.current.add(message.id);
        const baseMetadata = message.metadata || {};

        updateMessage(message.chat_id, message.id, {
            api_message_status: 'PENDING',
            metadata: { ...baseMetadata, send_error: undefined },
        });

        try {
            const result = await retryMessageAction(message.id);
            if (!result.success) {
                const errorText = result.error || 'Falha ao reenviar mensagem.';
                if (errorText.toLowerCase().includes('nao encontrada')) {
                    const fallback = await guardedSendAgentMessage(message.chat_id, message.content, tabId, message.id);
                    if (!fallback.success) {
                        throw new Error(fallback.error || 'Falha ao reenviar mensagem.');
                    }
                    if (fallback.message) {
                        const realMessage = {
                            ...fallback.message,
                            sender: {
                                id: currentUser.id,
                                name: currentUser.name,
                                avatar: currentUser.avatar || currentUser.avatar_url,
                                type: 'user'
                            },
                            formattedDate: formatMessageDate(new Date(fallback.message.createdAt), workspaceTimezone)
                        } as Message;
                        replaceOptimisticMessage(message.chat_id, message.id, realMessage);
                    }
                } else {
                    throw new Error(errorText);
                }
            }
            onActionSuccess();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Falha ao reenviar mensagem.';
            updateMessage(message.chat_id, message.id, {
                api_message_status: 'FAILED',
                metadata: { ...baseMetadata, send_error: errorMessage },
            });
            toast({ title: 'Falha ao reenviar', description: errorMessage, variant: 'destructive' });
        } finally {
            retryingMessagesRef.current.delete(message.id);
        }
    }, [currentUser, onActionSuccess, replaceOptimisticMessage, tabId, toast, updateMessage, workspaceTimezone]);

    const handleFormSubmit = async (overrideHtml?: string | React.SyntheticEvent) => {
        if (!chat) return;

        const messageSource = typeof overrideHtml === 'string' ? overrideHtml : newMessage;
        const currentMessageText = htmlToWhatsappMarkdown(messageSource);
        const currentMediaFiles = [...mediaFiles];
        const isTextOnly = currentMediaFiles.length === 0;

        if (isTextOnly) {
            if (!currentMessageText.trim()) {
                return;
            }

            const now = new Date();
            const optimisticId = uuidv4();
            const metadata: MessageMetadata = isInternalNote ? { isInternalNote: true } : {};

            const optimisticMessage: Message = {
                id: optimisticId,
                chat_id: chat.id,
                workspace_id: chat.workspace_id,
                content: currentMessageText,
                type: 'text',
                status: 'default',
                from_me: true,
                createdAt: now.toISOString(),
                is_read: true,
                // timestamp and formatting for UI
                timestamp: now.toISOString(),
                formattedDate: formatMessageDate(now, workspaceTimezone),
                sender: {
                    id: currentUser.id,
                    name: currentUser.name,
                    avatar: currentUser.avatar || currentUser.avatar_url,
                    type: 'user'
                },
                transcription: null,
                metadata,
                api_message_status: 'PENDING',
                instance_name: chat.instance_name || undefined,
                platform: optimisticPlatform,
                source_from_api: optimisticPlatform,
                optimistic: true,
                sentByTab: tabId
            };
            appendMessagesToChat(chat.id, [optimisticMessage]);

            // Force scroll to bottom by resetting user scroll state
            userScrolledUpRef.current = false;

            // Virtuoso handles auto-scroll via followOutput prop or ref
            setTimeout(() => {
                virtuosoRef.current?.scrollToIndex({ index: visibleMessages.length, align: 'end', behavior: 'smooth' });
            }, 50);

            setNewMessage('');
            setMediaFiles([]);
            if (contentEditableRef.current) contentEditableRef.current.innerHTML = '';

            setDraft(chat.id, '');
            enqueueTextSend({
                chatId: chat.id,
                messageId: optimisticId,
                content: currentMessageText,
                isInternalNote,
                metadata,
                startedAt: performance.now(),
            });
            return;
        }

        if (sendState === 'sending') return;
        // Optimization: Do not block for media sending.
        // setSendState('sending'); // Removed blocking state for media
        setLastSendError(null);
        const sendStart = performance.now();

        // Save context for background tasks
        const filesToSend = [...currentMediaFiles];
        const captionForFirst = currentMessageText;
        const chatId = chat.id;

        // Reset UI immediately
        lastSendDraftRef.current = { text: currentMessageText, media: currentMediaFiles, isNote: isInternalNote };
        setNewMessage('');
        setMediaFiles([]);
        if (contentEditableRef.current) contentEditableRef.current.innerHTML = '';
        setDraft(chatId, '');

        // Generate optimistic messages for all files
        const optimisticMessages: Message[] = filesToSend.map((mf, index) => {
            const now = new Date();
            const optimisticId = uuidv4();
            // Use base64 preview for immediate display
            const mediaUrl = mf.base64 ? `data:${mf.type};base64,${mf.base64}` : '';

            return {
                id: optimisticId,
                chat_id: chatId,
                workspace_id: chat.workspace_id,
                content: index === 0 ? captionForFirst : '', // Only first gets caption
                type: mf.mediatype,
                status: 'default',
                from_me: true,
                createdAt: now.toISOString(),
                is_read: true,
                timestamp: now.toISOString(),
                formattedDate: formatMessageDate(now, workspaceTimezone),
                sender: {
                    id: currentUser.id,
                    name: currentUser.name,
                    avatar: currentUser.avatar || currentUser.avatar_url,
                    type: 'user'
                },
                transcription: null,
                metadata: {
                    ... (isInternalNote ? { isInternalNote: true } : {}),
                    mediaUrl: mediaUrl, // Optimistic preview
                    mimetype: mf.type,
                    fileName: mf.name,
                    thumbnail: mf.thumbnail,
                    optimisticId
                },
                api_message_status: 'PENDING',
                instance_name: chat.instance_name || undefined,
                platform: optimisticPlatform,
                source_from_api: optimisticPlatform,
                optimistic: true,
                sentByTab: tabId
            };
        });

        // Update UI immediately
        appendMessagesToChat(chatId, optimisticMessages);

        // Scroll to bottom
        userScrolledUpRef.current = false;
        setTimeout(() => {
            virtuosoRef.current?.scrollToIndex({ index: visibleMessages.length + optimisticMessages.length, align: 'end', behavior: 'smooth' });
        }, 50);

        // Process in background (Fire-and-forget from UI perspective)
        (async () => {
            for (let i = 0; i < filesToSend.length; i++) {
                const mf = filesToSend[i];
                const optMsg = optimisticMessages[i];

                try {
                    const extension = mf.name.split('.').pop() || 'dat';
                    const fileName = Date.now() + '_' + uuidv4() + '.' + extension;

                    // 1. Upload
                    const { publicUrl, error: uploadError } = await uploadFileToStorage(mf.file, 'temp-media', fileName);

                    if (uploadError || !publicUrl) {
                        throw new Error(`Falha no upload de ${mf.name}: ${uploadError}`);
                    }

                    // 2. Send Action (Single File)
                    const filePayload = [{
                        base64: publicUrl,
                        mimetype: mf.type,
                        filename: mf.name,
                        mediatype: mf.mediatype,
                        thumbnail: mf.thumbnail,
                    }];

                    const currentCaption = i === 0 ? captionForFirst : '';

                    // Call backend action
                    const result = await sendMediaAction(chatId, currentCaption, filePayload, tabId);

                    if (result.error) {
                        throw new Error(result.error);
                    }

                    // 3. Success (Replace optimistic message with real one or just update status)
                    // If backend returns the created message, we replace it.
                    if ((result as any).messages && (result as any).messages.length > 0) {
                        const realMsg = (result as any).messages[0];
                        // Ensure formattedDate is present for UI
                        const formattedRealMsg = {
                            ...realMsg,
                            sender: optMsg.sender,
                            formattedDate: formatMessageDate(new Date(realMsg.createdAt), workspaceTimezone)
                        };
                        replaceOptimisticMessage(chatId, optMsg.id, formattedRealMsg);
                    } else {
                        // Just mark as sent if no object returned (shouldn't happen with current action)
                        updateMessage(chatId, optMsg.id, {
                            api_message_status: 'SENT',
                        });
                    }

                } catch (fileErr: any) {
                    console.error(`Error sending file ${mf.name}:`, fileErr);
                    // Mark specific message as FAILED
                    updateMessage(chatId, optMsg.id, {
                        api_message_status: 'FAILED',
                        metadata: { ...optMsg.metadata, send_error: fileErr.message || 'Falha no envio.' }
                    });

                    toast({
                        title: 'Erro ao enviar ' + mf.name,
                        description: fileErr.message || 'Falha no envio.',
                        variant: 'destructive'
                    });
                }
            }

            // Cleanup logic if needed
            lastSendDraftRef.current = null;
            onActionSuccess();
            reportClientMetric('send_message', performance.now() - sendStart, { chatId, media: true });

        })();
    };



    const handleSendAudio = async (audioBlob: Blob, duration: number, mimetype: string) => {
        if (!chat) return;

        // Determine file extension based on mimetype (WhatsApp prefers ogg)
        const audioExtension = mimetype.includes('ogg') || mimetype.includes('opus') ? 'ogg' : mimetype.includes('webm') ? 'webm' : 'mp3';

        console.log(`[AUDIO_SEND] Received mimetype: ${mimetype}, using extension: ${audioExtension}`);

        // 1. Upload to Supabase Storage (Public Bucket)
        const fileName = `audio_${Date.now()}.${audioExtension}`;
        const { publicUrl, error: uploadError } = await uploadFileToStorage(audioBlob, 'temp-media', fileName);

        if (uploadError || !publicUrl) {
            toast({ title: 'Erro ao fazer upload do áudio', description: uploadError || 'Erro desconhecido', variant: 'destructive' });
            return;
        }

        // 2. Send Media using the Public URL (instead of Base64)
        // User requested: "leave file in public, send url, then delete file"
        // We pass publicUrl in the 'base64' field because the action expects a string there, 
        // and internal logic handles URLs if they start with http.
        const audioFilename = `audio_gravado.${audioExtension}`;

        const mediaPayload = [{
            base64: publicUrl,
            mimetype,
            filename: audioFilename,
            mediatype: 'audio' as any,
            thumbnail: undefined,
            deleteAfterSend: true,
            storageBucket: 'temp-media',
            storagePath: fileName
        }];

        console.log('[AUDIO_SEND] Sending media payload:', JSON.stringify(mediaPayload, null, 2));

        const result = await sendMediaAction(chat.id, '', mediaPayload, tabId, { mediaUrl: publicUrl });

        console.log('[AUDIO_SEND] Server result:', result);

        if (result.error) {
            console.error('[AUDIO_SEND] Error from server:', result.error);
            toast({ title: 'Erro ao Enviar Áudio', description: result.error, variant: 'destructive' });
        } else if ((result as any).messages && (result as any).messages.length > 0) {
            console.log('[AUDIO_SEND] Success, appending messages');
            appendMessagesToChat(chat.id, (result as any).messages);
        }

        // Cleanup happens server-side after the background send completes.
    };

    const onEmojiClick = (emojiData: EmojiClickData) => {
        const editableDiv = contentEditableRef.current;
        if (!editableDiv) return;

        editableDiv.focus();
        const selection = window.getSelection();

        if (selection && selection.rangeCount > 0) {
            const range = savedRange.current || selection.getRangeAt(0);
            range.deleteContents();

            const emojiNode = document.createTextNode(emojiData.emoji);
            range.insertNode(emojiNode);
            range.setStartAfter(emojiNode);
            range.setEndAfter(emojiNode);

            selection.removeAllRanges();
            selection.addRange(range);
            savedRange.current = range.cloneRange();
        } else {
            editableDiv.innerHTML += emojiData.emoji;
        }

        setNewMessage(editableDiv.innerHTML);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
        if (e.key === 'Enter' && (e.ctrlKey || !e.shiftKey)) {
            e.preventDefault();
            handleFormSubmit();
        }
    };

    const saveCursorPosition = () => {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
            savedRange.current = selection.getRangeAt(0).cloneRange();
        }
    };

    const filteredShortcuts = useMemo(() => {
        if (!showShortcutSuggestions) return [];
        const command = debouncedMessageInput.substring(debouncedMessageInput.lastIndexOf('/') + 1).toLowerCase();
        return shortcuts.filter(s => s.name.toLowerCase().startsWith(command));
    }, [debouncedMessageInput, shortcuts, showShortcutSuggestions]);

    const handleMessageChange = (e: React.FormEvent<HTMLDivElement>) => {
        const text = e.currentTarget.innerHTML;
        setNewMessage(text);
    };

    useEffect(() => {
        setShowShortcutSuggestions(debouncedMessageInput.includes('/'));
    }, [debouncedMessageInput]);

    const handleShortcutSelect = (shortcut: Shortcut) => {
        if (contentEditableRef.current) {
            // Use innerText to ensure newlines are handled correctly as plain text
            contentEditableRef.current.innerText = shortcut.message;
            setNewMessage(contentEditableRef.current.innerHTML);
            setShowShortcutSuggestions(false);
        }
    };




    const lastCustomerMessage = useMemo(() =>
        (chat?.messages || []).slice().reverse().find(m => !m.from_me && m.type !== 'system')
        , [chat?.messages]);

    if (!chat) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center bg-transparent min-w-0 p-6">
                <div className="text-center space-y-4 p-8 rounded-3xl bg-card/40 border border-border backdrop-blur-md shadow-2xl">
                    <div className="h-20 w-20 bg-gradient-to-br from-primary/10 to-secondary/10 rounded-full flex items-center justify-center mx-auto mb-4 ring-1 ring-border">
                        <MessageSquare className="h-10 w-10 text-primary" />
                    </div>
                    <h2 className="text-2xl font-bold text-foreground">Bem-vindo ao Dialogy</h2>
                    <p className="text-muted-foreground max-w-md">
                        Selecione uma conversa na lista ao lado para iniciar o atendimento ou visualizar o histórico.
                    </p>
                </div>
            </div>
        )
    }

    const isChatOpen = chat.status !== 'encerrados';
    const isChatAssignedToMe = (chat.agent?.id || chat.agentId) === currentUser.id;

    const showTextInput = !mediaFiles.length;




    return (
        <div className="flex-1 flex flex-col bg-transparent min-w-0 relative h-full">
            {/* Header */}
            {/* Header */}
            <header className="flex min-h-[60px] md:h-16 items-center justify-between border-b border-border dark:border-white/10 bg-background/50 dark:bg-black/60 backdrop-blur-md px-3 md:px-6 flex-shrink-0 z-20 pt-[env(safe-area-inset-top)] pb-2 md:pt-0 md:pb-0">
                <div className="flex items-center gap-3">
                    {onBack && (
                        <Button variant="ghost" size="icon" onClick={onBack} className="md:hidden -ml-2 mr-1">
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                    )}
                    <motion.div layoutId={`avatar-morph-${chat.id}`}>
                        <Avatar className="h-10 w-10 border border-border ring-2 ring-background">
                            <AvatarImage src={chat.contact.avatar_url || undefined} alt={chat.contact.name} data-ai-hint="person" />
                            <AvatarFallback className="bg-muted text-foreground">{chat.contact.name.charAt(0)}</AvatarFallback>
                        </Avatar>
                    </motion.div>
                    <div className="min-w-0 flex-1">
                        <h2 className="font-semibold text-foreground flex items-center gap-2 min-w-0">
                            <span className="truncate">{chat.contact.name}</span>
                            {chat.status === 'atendimentos' && (
                                <Badge variant="secondary" className="bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/20 text-[10px] px-1.5 h-5 shrink-0 hidden 2xl:inline-flex">
                                    Atendendo
                                </Badge>
                            )}
                        </h2>
                        <p className="text-xs text-muted-foreground flex items-center gap-1 overflow-hidden min-w-0">
                            {chat.instance_name && (
                                <span className="flex items-center gap-1 shrink-0">
                                    {headerPlatformIcon}
                                    <span className="hidden lg:inline truncate max-w-[80px]">{chat.instance_name}</span>
                                </span>
                            )}
                            <span className="hidden lg:inline mx-1">•</span>
                            <span className="truncate">{chat.contact.phone}</span>
                            <span className="hidden sm:inline-flex items-center shrink-0">
                                <span className="mx-1">•</span>
                                <span className="text-xs whitespace-nowrap">ID: {chat.id}</span>
                            </span>
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {/* Dialogs logic - rendered once */}
                    {isChatOpen && isChatAssignedToMe && (
                        <CloseChatDialog
                            chat={chat}
                            onActionSuccess={onActionSuccess}
                            reasons={closeReasons}
                            isOpen={isCloseDialogOpen}
                            onOpenChange={setIsCloseDialogOpen}
                        />
                    )}

                    {/* MOBILE MENU */}
                    <div className="md:hidden">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="-mr-2">
                                    <MoreVertical className="h-5 w-5" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56 bg-popover/95 backdrop-blur-xl border-border">

                                <DropdownMenuItem onClick={() => onToggleContactPanel()}>
                                    <ArrowRightLeft className="mr-2 h-4 w-4" />
                                    <span>Detalhes do Contato</span>
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={handleExportChat}>
                                    <FileText className="mr-2 h-4 w-4" />
                                    <span>Salvar conversa</span>
                                </DropdownMenuItem>



                                {isChatOpen && isChatAssignedToMe && (
                                    <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                            onClick={() => setIsCloseDialogOpen(true)}
                                            className="text-red-500 focus:text-red-500 focus:bg-red-500/10"
                                        >
                                            <XCircle className="mr-2 h-4 w-4" />
                                            <span>Encerrar Atendimento</span>
                                        </DropdownMenuItem>
                                    </>
                                )}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>

                    {/* DESKTOP MENU - Dropdown for lg, full buttons for xl+ */}
                    <div className="hidden md:flex items-center gap-1">
                        {/* Dropdown for smaller desktops (md to 2xl) */}
                        <div className="2xl:hidden">
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
                                        <MoreVertical className="h-5 w-5" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-56 bg-popover/95 backdrop-blur-xl border-border">
                                    <DropdownMenuItem onClick={() => onToggleContactPanel()}>
                                        <ArrowRightLeft className="mr-2 h-4 w-4" />
                                        <span>Detalhes do Contato</span>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={handleExportChat}>
                                        <FileText className="mr-2 h-4 w-4" />
                                        <span>Salvar conversa</span>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={handleTrainAgent}>
                                        <Brain className="mr-2 h-4 w-4" />
                                        <span>Treinar Agente</span>
                                    </DropdownMenuItem>
                                    {isChatOpen && isChatAssignedToMe && (
                                        <>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem
                                                onClick={() => setIsCloseDialogOpen(true)}
                                                className="text-red-500 focus:text-red-500 focus:bg-red-500/10"
                                            >
                                                <XCircle className="mr-2 h-4 w-4" />
                                                <span>Encerrar Atendimento</span>
                                            </DropdownMenuItem>
                                        </>
                                    )}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>

                        {/* Full buttons for 2xl+ screens */}
                        <div className="hidden 2xl:flex items-center gap-2">
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="text-muted-foreground hover:text-foreground hover:bg-muted"
                                            onClick={() => onToggleContactPanel()}
                                        >
                                            <ArrowRightLeft className="h-4 w-4" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent><p>Alternar Painel Lateral</p></TooltipContent>
                                </Tooltip>

                                <div className="w-px h-6 bg-border mx-1" />

                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="text-muted-foreground hover:text-foreground hover:bg-muted"
                                            onClick={handleExportChat}
                                        >
                                            <FileText className="h-4 w-4" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent><p>Salvar como HTML</p></TooltipContent>
                                </Tooltip>

                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="text-muted-foreground hover:text-purple-600 hover:bg-purple-500/10"
                                            onClick={handleTrainAgent}
                                        >
                                            <Brain className="h-4 w-4" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent><p>Treinar Agente</p></TooltipContent>
                                </Tooltip>

                                {isChatOpen && isChatAssignedToMe && (
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => setIsCloseDialogOpen(true)}
                                                className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                            >
                                                <XCircle className="h-4 w-4" />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent><p>Encerrar atendimento</p></TooltipContent>
                                    </Tooltip>
                                )}
                            </TooltipProvider>
                        </div>
                    </div>

                </div>
            </header>

            {/* Messages Area */}

            <div className="flex-1 overflow-hidden relative flex flex-col min-h-0 bg-transparent">
                <Virtuoso
                    key={chat?.id}
                    ref={virtuosoRef}
                    style={{ height: '100%', width: '100%' }}
                    data={visibleMessages}
                    firstItemIndex={firstItemIndex}
                    initialTopMostItemIndex={firstItemIndex + visibleMessages.length - 1}
                    increaseViewportBy={1000} // Increased for smoother fast scrolling
                    defaultItemHeight={80} // STABILITY: Prevents height guessing during scroll
                    alignToBottom={true}
                    computeItemKey={(index, item) => item.id} // STABILITY: Prevent re-renders on prepend
                    followOutput={(isAtBottom) => {
                        // If we are at the bottom, stay there.
                        // If user is scrolled up, don't force them down unless it's their own message (handled by logic elsewhere)
                        return isAtBottom ? 'auto' : false;
                    }}
                    atBottomStateChange={(atBottom) => {
                        userScrolledUpRef.current = !atBottom;
                    }}
                    startReached={() => {
                        if (canLoadOlder && !isLoadingOlderMessages && !isFetchingHistoryRef.current) {
                            tryLoadOlder();
                        }
                    }}
                    components={{
                        Header: () => (
                            <div className="h-4 flex justify-center p-2">
                                {isLoadingOlderMessages && (
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground bg-background/50 backdrop-blur-sm px-3 py-1 rounded-full border border-border shadow-sm animate-in fade-in zoom-in duration-300">
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                        <span>Carregando histórico...</span>
                                    </div>
                                )}
                            </div>
                        ),
                        Footer: () => <div className="h-4" />
                    }}
                    itemContent={(index, message) => {
                        const arrayIndex = index - firstItemIndex;
                        const prevMessage = arrayIndex > 0 ? visibleMessages[arrayIndex - 1] : undefined;
                        return (
                            <div className="px-2 md:px-6 py-0.5" id={`message-${message.id}`}>
                                <MessageItem
                                    key={message.id}
                                    message={message}
                                    prevMessage={prevMessage}
                                    workspaceTimezone={workspaceTimezone}
                                    onDelete={handleDeleteMessage}
                                    currentUserId={currentUser.id}
                                    instanceName={chat?.instance_name}
                                    onForward={handleForwardMessage}
                                    onRetry={handleRetryMessage}
                                />
                            </div>
                        );
                    }}
                />
            </div>


            {
                isChatOpen ? (
                    <footer className="p-2 md:p-4 bg-transparent z-20 pb-[calc(0.5rem+env(safe-area-inset-bottom))] md:pb-[calc(1rem+env(safe-area-inset-bottom))] transition-[padding] data-[state=open]:p-0">
                        {showShortcutSuggestions && filteredShortcuts.length > 0 && (
                            <div className="mb-2 p-2 border border-border rounded-xl bg-popover/90 backdrop-blur-md max-h-40 overflow-y-auto shadow-xl">
                                {filteredShortcuts.map(shortcut => (
                                    <button
                                        key={shortcut.id}
                                        className="w-full text-left p-2 rounded-lg hover:bg-muted text-sm text-foreground transition-colors"
                                        onClick={() => handleShortcutSelect(shortcut)}
                                    >
                                        <span className="font-bold text-primary">/{shortcut.name}</span>
                                        <span className="text-muted-foreground ml-2 truncate">{shortcut.message}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                        {mediaFiles.length > 0 && (
                            <MediaPreview mediaFiles={mediaFiles} setMediaFiles={setMediaFiles} />
                        )}
                        {/* {!isAiAgentActive && mediaFiles.length === 0 && !isAiTyping && (chat.messages || []).length > 0 && !(chat.messages![chat.messages!.length - 1].from_me) && (
                        <SmartReplies
                            customerMessage={lastCustomerMessage?.content || ''}
                            chatHistory={(chat.messages || []).map(m => `${m.sender?.name || 'System'}: ${m.content}`).join('\n')}
                            workspaceId={currentUser.activeWorkspaceId!}
                            onSelectReply={(reply) => {
                                setNewMessage(reply);
                                if (contentEditableRef.current) contentEditableRef.current.innerHTML = reply;
                            }}
                        />
                    )} */}

                        {/* AI Copilot Suggestion Bubble */}
                        {aiSuggestion && (
                            <div className="animate-in slide-in-from-bottom-2 duration-300 mb-3">
                                <div className="bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-blue-500/10 border border-blue-500/30 rounded-2xl p-4 shadow-lg backdrop-blur-sm">
                                    <div className="flex items-center gap-2 mb-2">
                                        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                                            <Brain className="w-4 h-4 text-white" />
                                        </div>
                                        <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                                            Sugestão do {aiSuggestion.configName}
                                        </span>
                                    </div>
                                    <p className="text-sm text-foreground mb-3 whitespace-pre-wrap line-clamp-4">
                                        {aiSuggestion.text}
                                    </p>
                                    <div className="flex gap-2">
                                        <Button
                                            type="button"
                                            size="sm"
                                            className="bg-green-600 hover:bg-green-700 text-white"
                                            onClick={() => {
                                                handleFormSubmit(aiSuggestion.text);
                                                setAiSuggestion(null);
                                            }}
                                        >
                                            <Check className="w-4 h-4 mr-1" />
                                            Enviar
                                        </Button>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            onClick={() => {
                                                setNewMessage(aiSuggestion.text);
                                                if (contentEditableRef.current) {
                                                    contentEditableRef.current.innerHTML = aiSuggestion.text;
                                                    contentEditableRef.current.focus();
                                                }
                                                setAiSuggestion(null);
                                            }}
                                        >
                                            <Pencil className="w-4 h-4 mr-1" />
                                            Editar
                                        </Button>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="ghost"
                                            className="text-muted-foreground hover:text-red-500"
                                            onClick={() => setAiSuggestion(null)}
                                        >
                                            <X className="w-4 h-4 mr-1" />
                                            Ignorar
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="space-y-4">
                            <form onSubmit={(e) => { e.preventDefault(); handleFormSubmit(); }} onKeyDown={handleKeyDown} className='flex items-end gap-2'>
                                <input type="hidden" name="chatId" value={chat.id} />

                                <div className={cn(
                                    "backdrop-blur-md border rounded-[20px] md:rounded-2xl p-1.5 md:p-2 shadow-sm flex items-end gap-2 relative flex-1 transition-all duration-300 focus-within:ring-2 focus-within:ring-blue-500/50 focus-within:border-blue-500/50 focus-within:shadow-lg focus-within:shadow-blue-500/10",
                                    isInternalNote
                                        ? "bg-yellow-50 dark:bg-yellow-900/10 border-yellow-200 dark:border-yellow-700/30"
                                        : "bg-background/60 dark:bg-zinc-900/60 border-border/50 dark:border-white/10"
                                )}>
                                    <div className="flex gap-1 pb-1">
                                        <Popover>
                                            <PopoverTrigger asChild>
                                                <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-xl transition-all duration-200 hover:scale-110 active:scale-95" disabled={isAiTyping} aria-label="Abrir emojis">
                                                    <Smile className="h-5 w-5" />
                                                </Button>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-auto p-0 border-none mb-2 bg-transparent shadow-none">
                                                <EmojiPicker onEmojiClick={onEmojiClick} theme={"dark" as any} />
                                            </PopoverContent>
                                        </Popover>

                                        <Popover open={isShortcutsOpen} onOpenChange={setIsShortcutsOpen}>

                                            <div className="hidden md:flex items-center gap-1">
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-9 w-9 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-xl transition-all duration-200 hover:scale-110 active:scale-95"
                                                    onClick={() => fileInputRef.current?.click()}
                                                    disabled={isAiTyping}
                                                    aria-label="Anexar arquivo"
                                                >
                                                    <Paperclip className="h-5 w-5" />
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    className={cn(
                                                        "h-9 w-9 rounded-xl transition-all duration-200 hover:scale-110 active:scale-95",
                                                        isInternalNote
                                                            ? "text-yellow-600 hover:text-yellow-600 hover:bg-yellow-500/10"
                                                            : "text-muted-foreground hover:text-primary hover:bg-primary/10"
                                                    )}
                                                    onClick={() => setIsInternalNote(!isInternalNote)}
                                                    disabled={isAiTyping}
                                                    aria-label="Nota interna"
                                                >
                                                    <StickyNote className="h-5 w-5" />
                                                </Button>
                                                <PopoverTrigger asChild>
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-9 w-9 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-xl transition-all duration-200 hover:scale-110 active:scale-95"
                                                        disabled={isAiTyping}
                                                        aria-label="Respostas rápidas"
                                                    >
                                                        <MessageSquareQuote className="h-5 w-5" />
                                                    </Button>
                                                </PopoverTrigger>
                                            </div>

                                            <div className="md:hidden">
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-9 w-9 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-xl transition-all duration-200 hover:scale-110 active:scale-95"
                                                            disabled={isAiTyping}
                                                        >
                                                            <Plus className="h-5 w-5" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="start" side="top" className="w-48 bg-popover/90 backdrop-blur-md border-border">
                                                        <DropdownMenuItem onClick={() => fileInputRef.current?.click()} className="cursor-pointer">
                                                            <Paperclip className="mr-2 h-4 w-4" />
                                                            <span>Anexar</span>
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem onClick={() => setIsInternalNote(!isInternalNote)} className={cn("cursor-pointer", isInternalNote ? "text-yellow-600 focus:text-yellow-700" : "")}>
                                                            <StickyNote className="mr-2 h-4 w-4" />
                                                            <span>{isInternalNote ? 'Remover Nota' : 'Nota Interna'}</span>
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem onClick={() => setIsShortcutsOpen(true)} className="cursor-pointer">
                                                            <MessageSquareQuote className="mr-2 h-4 w-4" />
                                                            <span>Respostas Rápidas</span>
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </div>
                                            <PopoverContent className="w-80 p-0 bg-popover border-border backdrop-blur-md text-foreground max-h-96 overflow-y-auto" align="start" side="top" sideOffset={12}>
                                                <div className="p-2 space-y-1">
                                                    <h4 className="text-xs font-medium text-muted-foreground px-2 py-1">Atalhos Disponíveis</h4>
                                                    {shortcuts.length === 0 ? (
                                                        <p className="text-sm text-muted-foreground px-2 py-2">Nenhum atalho encontrado.</p>
                                                    ) : (
                                                        shortcuts.map(shortcut => (
                                                            <button
                                                                key={shortcut.id}
                                                                className="w-full text-left p-2 rounded-lg hover:bg-muted text-sm text-foreground transition-colors flex flex-col gap-1 group"
                                                                onClick={() => {
                                                                    handleShortcutSelect(shortcut);
                                                                    setIsShortcutsOpen(false);
                                                                }}
                                                            >
                                                                <div className="flex items-center justify-between w-full">
                                                                    <span className="font-bold text-primary flex items-center gap-2">
                                                                        /{shortcut.name}
                                                                        {shortcut.type === 'global' && <Globe className="h-3 w-3 text-muted-foreground" />}
                                                                        {shortcut.type === 'team' && <Users className="h-3 w-3 text-muted-foreground" />}
                                                                        {shortcut.type === 'private' && <Lock className="h-3 w-3 text-muted-foreground" />}
                                                                    </span>
                                                                </div>
                                                                <span className="text-muted-foreground truncate w-full text-xs">{shortcut.message}</span>
                                                            </button>
                                                        ))
                                                    )}
                                                </div>
                                            </PopoverContent>
                                        </Popover>

                                        <input
                                            type="file"
                                            ref={fileInputRef}
                                            onChange={handleFileChange}
                                            className="hidden"
                                            multiple
                                            accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,audio/*"
                                        />
                                    </div>

                                    <div className="relative flex-1 min-w-0 py-2">
                                        {showTextInput ? (
                                            <ContentEditable
                                                innerRef={contentEditableRef}
                                                html={newMessage}
                                                disabled={isAiTyping}
                                                onChange={handleMessageChange}
                                                onPaste={handlePaste}
                                                className="w-full bg-transparent border-0 focus:ring-0 p-0 text-foreground placeholder:text-muted-foreground resize-none max-h-[120px] min-h-[24px] focus:outline-none scrollbar-hide whitespace-pre-wrap overflow-y-auto"
                                                tagName="div"
                                                onKeyUp={saveCursorPosition}
                                                onClick={saveCursorPosition}
                                            />
                                        ) : null}
                                    </div>

                                    <div className="pb-1 pr-1">
                                        {newMessage.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, '').trim() === "" && mediaFiles.length === 0 ? (
                                            <div className="animate-in zoom-in duration-300">
                                                <AudioRecorder onSend={handleSendAudio} />
                                            </div>
                                        ) : (
                                            <div className="animate-in zoom-in duration-300">
                                                <SendMessageButton disabled={isAiTyping || (sendState === 'sending' && mediaFiles.length > 0)} />
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </form>
                            {sendState === 'sending' && (
                                <div className="text-xs text-blue-300 flex items-center gap-2 pl-1">
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                    <span>Enviando...</span>
                                </div>
                            )}
                            {sendState === 'error' && (
                                <div className="text-xs text-red-300 flex items-center gap-2 pl-1">
                                    <span>{lastSendError || 'Falha ao enviar. Tente novamente.'}</span>
                                    <Button variant="link" size="sm" className="px-1 h-auto text-red-200" onClick={handleFormSubmit}>
                                        Reenviar
                                    </Button>
                                </div>
                            )}
                            {textSendQueueCount > 0 && (
                                <div className="text-xs text-muted-foreground flex items-center gap-2 pl-1">
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                    <span>Fila de envio: {textSendQueueCount} mensagem{textSendQueueCount > 1 ? 's' : ''}</span>
                                </div>
                            )}

                            <div className="hidden md:flex flex-wrap items-center gap-3 px-2">
                                <div className="flex items-center space-x-2 bg-muted/30 backdrop-blur-md px-3 py-1.5 rounded-full border border-border">
                                    <Bot className="h-4 w-4 text-primary" />
                                    <Switch
                                        id="ai-agent-switch"
                                        checked={isAiAgentActive}
                                        onCheckedChange={handleAiSwitchChange}
                                        disabled={isAiTyping || (!autopilotConfig && autopilotAgents.length === 0)}
                                        className="data-[state=checked]:bg-primary"
                                    />
                                    {autopilotAgents.length > 1 ? (
                                        <Select
                                            value={chat?.autopilot_config_id || autopilotConfig?.id || (autopilotAgents.find(a => a.is_primary)?.id)}
                                            onValueChange={handleAgentChange}
                                            disabled={!isAiAgentActive}
                                        >
                                            <SelectTrigger className="h-6 border-none bg-transparent text-xs font-medium text-foreground focus:ring-0 px-1 gap-1 w-auto min-w-[30px] outline-none shadow-none ring-0 focus:ring-offset-0">
                                                <SelectValue placeholder="Agente" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {autopilotAgents.map(agent => (
                                                    <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    ) : (
                                        <Label htmlFor="ai-agent-switch" className="font-medium text-xs text-foreground cursor-pointer">Agente de IA</Label>
                                    )}

                                    {isAiAgentActive && (
                                        <Select
                                            value={chat?.copilot_mode || 'auto'}
                                            onValueChange={(val) => handleCopilotModeChange(val as 'auto' | 'suggest')}
                                        >
                                            <SelectTrigger className="h-6 border-none bg-transparent text-xs font-medium text-foreground focus:ring-0 px-1 gap-1 w-auto min-w-[30px] outline-none shadow-none ring-0 focus:ring-offset-0 ml-1 border-l border-border pl-2 rounded-none">
                                                <div className="flex items-center gap-1">
                                                    {chat?.copilot_mode === 'suggest' ? <MessageSquareQuote className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
                                                    <span className="hidden sm:inline">{chat?.copilot_mode === 'suggest' ? 'Sugestão' : 'Auto'}</span>
                                                </div>
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="auto">
                                                    <div className="flex items-center gap-2">
                                                        <Bot className="h-3 w-3" />
                                                        <span>Automático</span>
                                                    </div>
                                                </SelectItem>
                                                <SelectItem value="suggest">
                                                    <div className="flex items-center gap-2">
                                                        <MessageSquareQuote className="h-3 w-3" />
                                                        <span>Sugestão (Aprovar)</span>
                                                    </div>
                                                </SelectItem>
                                            </SelectContent>
                                        </Select>
                                    )}
                                    {isAiTyping && <Loader2 className="h-3 w-3 animate-spin text-primary ml-1" />}
                                </div>
                                {autopilotConfig && (
                                    <span className="text-[10px] text-muted-foreground">
                                        {(autopilotConfig.knowledge_base_documents?.length || 0)} docs · {autopilotRules.filter(rule => rule.enabled).length} regras ativas
                                    </span>
                                )}
                                <Link href="/autopilot" className="text-[10px] font-medium text-primary hover:text-primary/80 hover:underline ml-auto">
                                    Treinar agente
                                </Link>
                            </div>
                        </div>
                    </footer>
                ) : (
                    <footer className="p-4 flex-shrink-0 text-center bg-background/50 backdrop-blur-md border-t border-border">
                        <p className='text-sm font-medium text-muted-foreground'>
                            Este atendimento foi encerrado.
                        </p>
                    </footer>
                )
            }
        </div >
    );
}

