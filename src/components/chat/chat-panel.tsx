'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo, useLayoutEffect } from 'react';
import dynamic from 'next/dynamic';
import { generateChatSummaryAction } from '@/actions/ai';
import { v4 as uuidv4 } from 'uuid';
import Image from 'next/image';
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
    Pencil,
    SpellCheck2,
    Activity,
    Signature,
    PanelRightOpen,
} from 'lucide-react';
import { uploadFileToStorage } from '@/lib/supabase/storage';
import { createClient } from '@/lib/supabase/client';
import { type Chat, type Message, type User, Tag, MessageMetadata, Contact, AutopilotConfig, NexusFlowInstance, Shortcut } from '@/lib/types';
import SmartReplies from './smart-replies';
import ChatSummary from './chat-summary';
import { generateAgentResponse } from '@/ai/flows/auto-responder';
import { DEFAULT_AUTOPILOT_MODEL } from '@/lib/ai-models';
import { Switch } from '../ui/switch';
import { Label } from '../ui/label';
import { useToast } from '@/hooks/use-toast';
import { fetchSGPContracts, createSGPServiceOrder } from '@/plugins/sgp/actions';
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
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
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
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import type { EmojiClickData } from 'emoji-picker-react';
import ContentEditable from 'react-contenteditable';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { AudioRecorder } from './audio-recorder';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { reportClientMetric } from '@/lib/observability/client';
import { guardedAssignChat, guardedCloseChat, guardedSendAgentMessage } from '@/actions/chat-guards';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { useTheme } from '@/providers/theme-provider';
import { shouldAcceptAiSuggestion } from '@/lib/inbox-ownership';
import { TransferChatDialog } from './contact-panel';

import { FaWhatsapp, FaInstagram, FaFacebookMessenger, FaTelegram } from 'react-icons/fa6';
import { Badge } from '../ui/badge';
import { getChatIdentityDisplayValue, resolveChatPlatform } from '@/lib/chat-platform';
import { buildToolExecutionItems, isToolExecutionMessage, ToolExecutionsSheet } from './tool-executions-sheet';

const EmojiPicker = dynamic(() => import('emoji-picker-react'), {
    ssr: false,
    loading: () => <div className="h-[360px] w-[300px] rounded-xl bg-muted" />,
});



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
    isLoadingInitialMessages?: boolean;
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
    skipUserSignature: boolean;
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
        const trimmedNotes = notes.trim();
        const canCreateSgpOrder = trimmedNotes.length > 0;

        if (selectedSgpContract && canCreateSgpOrder) {
            const osResult = await createSGPServiceOrder(chat.id, selectedSgpContract, trimmedNotes);
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
        } else if (selectedSgpContract && !canCreateSgpOrder) {
            toast({
                title: "OS no SGP ignorada",
                description: "Adicione uma nota para gerar ocorrencia no SGP.",
            });
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

function SendMessageButton({
    disabled,
    isPrimed,
    feedbackKey,
    showFeedback,
}: {
    disabled?: boolean;
    isPrimed?: boolean;
    feedbackKey?: number;
    showFeedback?: boolean;
}) {
    const { pending } = useFormStatus();
    const isEnabled = !disabled && !pending;
    const shouldShowFeedback = Boolean(showFeedback && feedbackKey);

    return (
        <div className="relative">
            {isEnabled && isPrimed && (
                <span className="pointer-events-none absolute -inset-1 rounded-full border border-cyan-400/30" />
            )}

            {shouldShowFeedback && (
                <span
                    key={`send-ring-${feedbackKey}`}
                    className="pointer-events-none absolute inset-0 rounded-full border border-cyan-300/70"
                />
            )}

            <Button
                type="submit"
                size="icon"
                className={cn(
                    "h-9 w-9 rounded-full transition-all duration-200 shrink-0 relative overflow-hidden",
                    isEnabled
                        ? "bg-blue-600 text-white hover:bg-blue-500"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                )}
                disabled={pending || disabled}
                aria-label="Enviar mensagem"
            >
                {pending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                    <span
                        key={`send-icon-${feedbackKey || 0}`}
                        className="flex items-center justify-center"
                    >
                        <Send className="h-4 w-4" />
                    </span>
                )}
            </Button>

            {shouldShowFeedback && (
                <span
                    key={`send-chip-${feedbackKey}`}
                    className="pointer-events-none absolute -top-5 right-0 text-[10px] font-semibold uppercase tracking-wide text-cyan-300"
                >
                    Enviado
                </span>
            )}
        </div>
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
    isLoadingInitialMessages = false,
    workspaceTimezone,
    onToggleContactPanel,
    onForwardMessage,
    highContrast,
    onToggleHighContrast,
    isRTL,
    onToggleRTL,
    onBack,
}: ChatPanelProps) {
    const { resolvedTheme } = useTheme();

    const updateChat = useInboxStore(state => state.updateChat);
    const drafts = useInboxStore(state => state.drafts);
    const setDraft = useInboxStore(state => state.setDraft);
    const [newMessage, setNewMessage] = useState('');
    const emojiPickerTheme = resolvedTheme === 'light' ? 'light' : 'dark';
    const debouncedMessageInput = useDebouncedValue(newMessage, 220);
    const [mediaFiles, setMediaFiles] = useState<MediaFileType[]>([]);
    const chatRef = useRef(chat?.id);
    const newMessageRef = useRef(newMessage);
    newMessageRef.current = newMessage;

    // Robust Draft Switching Logic (No Flicker)
    // Uses refs to avoid stale closures when saving/loading drafts on chat switch
    useLayoutEffect(() => {
        if (chat?.id !== chatRef.current) {
            // Save draft for previous chat using ref (always fresh)
            const previousChatId = chatRef.current;
            if (previousChatId) {
                setDraft(previousChatId, newMessageRef.current);
            }

            // Load draft for new chat from store state (always fresh)
            if (chat?.id) {
                const savedDraft = useInboxStore.getState().drafts[chat.id];
                setNewMessage(savedDraft || '');
            } else {
                setNewMessage('');
            }
            setSkipUserSignature(false);
            chatRef.current = chat?.id;
        }
    }, [chat?.id, setDraft]); // Minimal deps — refs handle freshness

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
    const [skipUserSignature, setSkipUserSignature] = useState(false);
    const [isToolExecutionsOpen, setIsToolExecutionsOpen] = useState(false);
    const [toolExecutionNow, setToolExecutionNow] = useState(() => Date.now());
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
    const [sendFeedbackKey, setSendFeedbackKey] = useState(0);
    const [isSendBurstActive, setIsSendBurstActive] = useState(false);
    const sendBurstTimeoutRef = useRef<number | null>(null);

    // AI Copilot Suggestion State
    const [aiSuggestion, setAiSuggestion] = useState<{ text: string; configName: string } | null>(null);

    // Virtualization refs/state removed
    // const messageHeightsRef = useRef<Map<string, number>>(new Map()); 

    const [autopilotConfig, setAutopilotConfig] = useState<AutopilotConfig | null>(null);
    const [autopilotRules, setAutopilotRules] = useState<NexusFlowInstance[]>([]);
    const [autopilotAgents, setAutopilotAgents] = useState<AutopilotConfig[]>([]);
    const activeAutopilotConfig = useMemo(() => {
        const chatConfigId = chat?.autopilot_config_id;
        if (chatConfigId) {
            return (
                autopilotAgents.find((agent) => agent.id === chatConfigId) ||
                (autopilotConfig?.id === chatConfigId ? autopilotConfig : null)
            );
        }
        return autopilotConfig;
    }, [autopilotAgents, autopilotConfig, chat?.autopilot_config_id]);
    const isProtocolScoped = !!(chat as any)?.protocolScoped;
    const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
    const [showShortcutSuggestions, setShowShortcutSuggestions] = useState(false);
    const [isSpellChecking, setIsSpellChecking] = useState(false);

    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const contentEditableRef = useRef<any>(null);
    const processedMessageIds = useRef(new Set<string>());
    const observedLastMessageIdByChatRef = useRef<Record<string, string>>({});
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
    const [isChatDetailsOpen, setIsChatDetailsOpen] = useState(false);
    const mobileMoreActionsRef = useRef<HTMLButtonElement>(null);
    const desktopMoreActionsRef = useRef<HTMLButtonElement>(null);
    const chatDetailsReturnFocusRef = useRef<HTMLButtonElement | null>(null);

    const { toast } = useToast();

    const triggerSendFeedback = useCallback(() => {
        setSendFeedbackKey((prev) => prev + 1);
        setIsSendBurstActive(true);

        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
            navigator.vibrate(8);
        }

        if (sendBurstTimeoutRef.current) {
            window.clearTimeout(sendBurstTimeoutRef.current);
        }
        sendBurstTimeoutRef.current = window.setTimeout(() => {
            setIsSendBurstActive(false);
        }, 460);
    }, []);

    useEffect(() => {
        return () => {
            if (sendBurstTimeoutRef.current) {
                window.clearTimeout(sendBurstTimeoutRef.current);
            }
        };
    }, []);

    const handleAiSwitchChange = async (checked: boolean) => {
        autopilotSwitchTouchedRef.current = true;
        setIsAiAgentActive(checked);

        let agentId = chat?.autopilot_config_id || undefined;
        if (checked && !agentId) {
            const primary = autopilotAgents.find(a => a.is_primary) || autopilotAgents[0] || autopilotConfig;
            if (primary) {
                agentId = primary.id;
            }
        }

        if (chat) {
            updateChat(chat.id, {
                is_autopilot_active: checked,
                autopilot_config_id: agentId,
                copilot_mode: checked ? 'suggest' : 'off'
            });
            await toggleChatAutopilot(chat.id, checked, agentId || null);

            if (checked && agentId) {
                const selected = autopilotAgents.find(a => a.id === agentId) || (autopilotConfig?.id === agentId ? autopilotConfig : null);
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

            const selected = autopilotAgents.find(a => a.id === agentId) || (autopilotConfig?.id === agentId ? autopilotConfig : null);
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
        const data = await getAutopilotConfig(currentUser.activeWorkspaceId, chat?.autopilot_config_id || undefined);
        if (!data.error) {
            setAutopilotConfig(data.config);
            setAutopilotRules(data.rules || []);
            setAutopilotAgents(data.agents || []);
        } else {
            console.error("Failed to fetch autopilot config:", data.error);
        }
    }, [chat?.autopilot_config_id, currentUser.activeWorkspaceId]);

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

    // Subscribe to AI processing events and suggestions via Realtime
    useEffect(() => {
        console.log('[CHAT_PANEL] Checking copilot subscription. Mode:', chat?.copilot_mode, 'ID:', chat?.id);
        if (!chat?.id) return;

        let cancelled = false;
        const supabase = createClient();
        const channel = supabase.channel(`chat:${chat.id}`)
            .on('broadcast', { event: 'ai_processing_start' }, (payload) => {
                if (cancelled) return;
                if (payload.payload?.chatId && payload.payload.chatId !== chat.id) return;
                setIsAiTyping(true);
            })
            .on('broadcast', { event: 'ai_processing_stop' }, (payload) => {
                if (cancelled) return;
                if (payload.payload?.chatId && payload.payload.chatId !== chat.id) return;
                setIsAiTyping(false);
            })
            .on('broadcast', { event: 'ai_suggestion' }, (payload) => {
                if (cancelled) return; // Guard against updates after unmount
                console.log('[CHAT_PANEL] Received AI suggestion:', payload);
                setIsAiTyping(false);
                if (!shouldAcceptAiSuggestion(chat.id, payload.payload?.chatId)) {
                    return;
                }
                if (chat.copilot_mode !== 'suggest') return;
                if (payload.payload?.suggestion) {
                    setAiSuggestion({
                        text: payload.payload.suggestion,
                        configName: payload.payload.configName || 'IA'
                    });
                }
            })
            .subscribe();

        return () => {
            cancelled = true;
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
        if (!showFullHistory && allContactMessages.length > 0) {
            setAllContactMessages([]);
        }
    }, [showFullHistory, allContactMessages.length]);

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

    const timelineMessages = useMemo(() => {
        if (isProtocolScoped) {
            return chat?.messages || [];
        }
        if (showFullHistory && allContactMessages.length > 0) {
            return allContactMessages;
        }
        // FIX: Use messagesByChat from store instead of chat.messages (which only has latest)
        return chat && messagesByChat[chat.id] ? messagesByChat[chat.id] : (chat?.messages || []);
    }, [isProtocolScoped, showFullHistory, allContactMessages, chat?.messages, chat?.id, messagesByChat]);

    const hasRawRunningToolExecution = useMemo(() => {
        return timelineMessages.some((message) => (
            isToolExecutionMessage(message) && message.metadata?.agentToolStatus === 'running'
        ));
    }, [timelineMessages]);

    useEffect(() => {
        if (!hasRawRunningToolExecution) return;

        const intervalId = window.setInterval(() => {
            setToolExecutionNow(Date.now());
        }, 30000);

        return () => window.clearInterval(intervalId);
    }, [hasRawRunningToolExecution]);

    const toolExecutionEntries = useMemo(() => {
        return buildToolExecutionItems(timelineMessages.filter(isToolExecutionMessage), toolExecutionNow);
    }, [timelineMessages, toolExecutionNow]);

    const messagesToRender = useMemo(() => {
        return timelineMessages.filter((message) => (
            !isToolExecutionMessage(message) || message.metadata?.agentToolStatus === 'prearmed'
        ));
    }, [timelineMessages]);

    const pendingStatusIds = useMemo(() => {
        if (!chat?.id) return [];
        const msgs = messagesByChat[chat.id] || [];
        return msgs
            .filter((m) => m.from_me && (m.api_message_status || '').toUpperCase() === 'PENDING')
            .map((m) => m.id);
    }, [chat?.id, messagesByChat]);

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
    const visibleMessagesLookup = useMemo(() => {
        const byId = new Map<string, Message>();
        const byApiMessageId = new Map<string, Message>();

        for (const item of visibleMessages) {
            byId.set(item.id, item);

            if (item.message_id_from_api) {
                byApiMessageId.set(item.message_id_from_api, item);
            }
        }

        return { byId, byApiMessageId };
    }, [visibleMessages]);

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
        const storeMessages = chat?.id
            ? (messagesByChat[chat.id] || []).filter((message) => !isToolExecutionMessage(message))
            : [];
        const lastMessage = storeMessages.length ? storeMessages[storeMessages.length - 1] : null;
        const chatId = chat?.id;

        if (!chatId || !lastMessage) {
            return;
        }

        const observedLastMessageId = observedLastMessageIdByChatRef.current[chatId];
        if (!observedLastMessageId) {
            observedLastMessageIdByChatRef.current[chatId] = lastMessage.id;
            return;
        }

        if (observedLastMessageId === lastMessage.id || processedMessageIds.current.has(lastMessage.id)) {
            return;
        }

        observedLastMessageIdByChatRef.current[chatId] = lastMessage.id;

        const copilotMode = chat?.copilot_mode || 'off';
        const shouldRun = isAiAgentActive &&
            !!chat &&
            !chat.assigned_system_agent_id &&
            copilotMode === 'suggest' &&
            lastMessage?.sender?.id !== currentUser.id &&
            !lastMessage?.metadata?.sentBy &&
            !isAiTyping;

        if (!shouldRun) {
            return;
        }

        try {
            setIsAiTyping(true);
            processedMessageIds.current.add(lastMessage.id);
            const chatHistoryForAI = storeMessages.map(m => `${m.sender?.name || 'System'}: ${m.content}`).join('\n');
            const activeRules = autopilotRules.filter(rule => rule.enabled);

            if (!activeAutopilotConfig) {
                console.warn("[AUTOPILOT] Configuração não carregada. Abortando.");
                return;
            }

            const sanitizedContact: Contact = {
                ...(chat.contact as Contact),
                email: chat.contact?.email || '',
            };

            const result = await generateAgentResponse({
                config: activeAutopilotConfig,
                chatId: chat.id,
                customerMessage: lastMessage.content || '',
                chatHistory: chatHistoryForAI,
                rules: activeRules,
                knowledgeBase: activeAutopilotConfig.knowledge_base || '',
                knowledgeBaseDocuments: activeAutopilotConfig.knowledge_base_documents || [],
                fallbackReply: activeAutopilotConfig.default_fallback_reply || '',
                model: activeAutopilotConfig.ai_model || DEFAULT_AUTOPILOT_MODEL,
                contact: sanitizedContact
            });

            if (result?.response) {
                if (copilotMode === 'suggest') {
                    setAiSuggestion({
                        text: result.response,
                        configName: activeAutopilotConfig.name || 'IA',
                    });
                    return;
                }

                if (copilotMode === 'off') {
                    return;
                }

                return;
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
    }, [activeAutopilotConfig, autopilotRules, chat, currentUser.id, isAiAgentActive, isAiTyping, onActionSuccess, toast, messagesByChat]);

    useEffect(() => {
        runAiAgent();
    }, [runAiAgent]);

    useEffect(() => {
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

    const handleExportChat = async () => {
        if (!chat) return;
        try {
            const exportMessages = messagesToRender.length > 0 ? messagesToRender : (messagesByChat[chat.id] || chat.messages || []);
            const html = await generateChatHtml(chat, currentUser, exportMessages);
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
        } catch (error) {
            console.error('Failed to export chat HTML', error);
            toast({ title: "Erro", description: "Nao foi possivel exportar a conversa em HTML.", variant: 'destructive' });
        }
    };

    const handleTrainAgent = async () => {
        if (!chat) return;

        // Use store messages for complete data
        const msgs = (messagesByChat[chat.id] || chat.messages || []).filter((message) => !isToolExecutionMessage(message));
        if (!msgs.length) {
            toast({ title: "Aviso", description: "Nenhuma mensagem carregada para treinar.", variant: 'destructive' });
            return;
        }

        // Simplify conversation for training
        const conversationText = msgs
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

    const composerPlainText = htmlToWhatsappMarkdown(newMessage);
    const isComposerTextEmpty = composerPlainText.trim() === '';
    const canSendFromComposer = !isComposerTextEmpty || mediaFiles.length > 0;

    const formatOptimisticTimestamp = (date: Date) =>
        date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    const generateOptimisticId = () => uuidv4();

    const resolvedPlatform = resolveChatPlatform(chat);
    const isMetaPlatform = resolvedPlatform === 'instagram' || resolvedPlatform === 'messenger';
    const contactDisplayValue = getChatIdentityDisplayValue(chat, resolvedPlatform);
    const headerContactValue = contactDisplayValue || (isMetaPlatform ? '' : chat?.contact.phone || chat?.contact.phone_number_jid || '');

    const optimisticPlatform =
        resolvedPlatform === 'instagram' || resolvedPlatform === 'messenger' || resolvedPlatform === 'telegram'
            ? resolvedPlatform
            : undefined;

    const headerPlatformIcon =
        resolvedPlatform === 'instagram'
            ? <FaInstagram className="h-3 w-3 text-pink-500" />
            : resolvedPlatform === 'messenger'
                ? <FaFacebookMessenger className="h-3 w-3 text-blue-500" />
                : resolvedPlatform === 'telegram'
                    ? <FaTelegram className="h-3 w-3 text-sky-500" />
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
                    : await guardedSendAgentMessage(job.chatId, job.content, tabId, job.messageId, {
                        skipUserSignature: job.skipUserSignature,
                    });

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
                        metadata: { ...job.metadata, send_error: undefined, send_error_details: undefined },
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
                    metadata: {
                        ...job.metadata,
                        send_error: errorMessage,
                        send_error_details: {
                            source: 'client_send_queue',
                            status: 'FAILED',
                            reason: errorMessage,
                            captured_at: new Date().toISOString(),
                        },
                    },
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
        const status = (message.api_message_status || '').toUpperCase();
        if (status !== 'FAILED' && status !== 'ERROR') return;
        if (message.metadata?.isInternalNote) return;
        if (retryingMessagesRef.current.has(message.id)) return;

        retryingMessagesRef.current.add(message.id);
        const baseMetadata = message.metadata || {};

        updateMessage(message.chat_id, message.id, {
            api_message_status: 'PENDING',
            metadata: { ...baseMetadata, send_error: undefined, send_error_details: undefined },
        });

        try {
            const result = await retryMessageAction(message.id);
            if (!result.success) {
                const errorText = result.error || 'Falha ao reenviar mensagem.';
                if (errorText.toLowerCase().includes('nao encontrada')) {
                    const fallback = await guardedSendAgentMessage(message.chat_id, message.content, tabId, message.id, {
                        skipUserSignature: message.metadata?.skipUserSignature === true,
                    });
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
                metadata: {
                    ...baseMetadata,
                    send_error: errorMessage,
                    send_error_details: {
                        source: 'client_retry',
                        status: 'FAILED',
                        reason: errorMessage,
                        captured_at: new Date().toISOString(),
                    },
                },
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
            const skipSignatureForSend = !isInternalNote && skipUserSignature;
            const metadata: MessageMetadata = {
                ...(isInternalNote ? { isInternalNote: true } : {}),
                ...(skipSignatureForSend ? { skipUserSignature: true } : {}),
            };

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
            triggerSendFeedback();

            // Force scroll to bottom by resetting user scroll state
            userScrolledUpRef.current = false;

            // Virtuoso handles auto-scroll via followOutput prop or ref
            setTimeout(() => {
                virtuosoRef.current?.scrollToIndex({ index: visibleMessages.length, align: 'end', behavior: 'smooth' });
            }, 50);

            setNewMessage('');
            setMediaFiles([]);
            setSkipUserSignature(false);
            if (contentEditableRef.current) contentEditableRef.current.innerHTML = '';

            setDraft(chat.id, '');
            enqueueTextSend({
                chatId: chat.id,
                messageId: optimisticId,
                content: currentMessageText,
                isInternalNote,
                skipUserSignature: skipSignatureForSend,
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
        setSkipUserSignature(false);
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
        triggerSendFeedback();

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
                        metadata: {
                            ...optMsg.metadata,
                            send_error: fileErr.message || 'Falha no envio.',
                            send_error_details: {
                                source: 'client_media_send',
                                status: 'FAILED',
                                reason: fileErr.message || 'Falha no envio.',
                                captured_at: new Date().toISOString(),
                            },
                        }
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
            triggerSendFeedback();
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

    const escapeHtml = useCallback((value: string) => {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }, []);

    const moveComposerCaretToEnd = useCallback((element: HTMLElement) => {
        const selection = window.getSelection();
        if (!selection) return;

        const range = document.createRange();
        range.selectNodeContents(element);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
        savedRange.current = range.cloneRange();
    }, []);

    const syncComposerHtml = useCallback((html: string, focusToEnd: boolean = false) => {
        const element = contentEditableRef.current as HTMLElement | null;
        if (element && element.innerHTML !== html) {
            element.innerHTML = html;
        }

        setNewMessage(html);

        if (chat?.id) {
            setDraft(chat.id, html);
        }

        if (focusToEnd && element) {
            element.focus();
            moveComposerCaretToEnd(element);
        }
    }, [chat?.id, moveComposerCaretToEnd, setDraft]);

    const syncComposerPlainText = useCallback((text: string, focusToEnd: boolean = false) => {
        const normalized = text.replace(/\r\n/g, '\n');
        const html = escapeHtml(normalized).replace(/\n/g, '<br>');
        syncComposerHtml(html, focusToEnd);
    }, [escapeHtml, syncComposerHtml]);

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
        syncComposerPlainText(shortcut.message, true);
        setShowShortcutSuggestions(false);
    };

    const handleSpellCheck = async () => {
        const plainText = composerPlainText.trim();
        if (!plainText || isSpellChecking) return;

        setIsSpellChecking(true);

        // Find the input container and add the processing glow
        const inputContainer = contentEditableRef.current?.closest('[data-input-container]') as HTMLElement | null;
        if (inputContainer) {
            inputContainer.classList.add('spellcheck-processing');
        }

        try {
            const res = await fetch('/api/spellcheck', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: plainText }),
            });

            const data = await res.json().catch(() => ({} as { correctedText?: string; error?: string }));

            if (!res.ok) {
                if (inputContainer) inputContainer.classList.remove('spellcheck-processing');
                toast({
                    title: 'Corretor Ortográfico',
                    description: data.error || 'Erro ao corrigir texto.',
                    variant: 'destructive',
                });
                return;
            }

            if (data.correctedText) {
                const corrected = data.correctedText;
                const el = contentEditableRef.current as HTMLElement | null;

                // Remove glow, prepare for typewriter
                if (inputContainer) inputContainer.classList.remove('spellcheck-processing');

                if (!el) {
                    syncComposerPlainText(corrected, true);
                    toast({
                        title: corrected === plainText ? 'Texto já está correto' : 'Texto corrigido ✨',
                        description: corrected === plainText
                            ? 'Nenhum ajuste ortográfico foi necessário.'
                            : 'A ortografia foi revisada com sucesso.',
                    });
                    return;
                }

                // Clear the text first with a brief pause
                el.innerText = '';
                syncComposerHtml('');

                // Typewriter effect — character by character
                const typeSpeed = Math.max(12, Math.min(35, 1200 / corrected.length)); // adaptive speed
                let i = 0;

                await new Promise<void>((resolve) => {
                    const typeChar = () => {
                        if (i < corrected.length) {
                            el.innerText = corrected.substring(0, i + 1);
                            i++;
                            setTimeout(typeChar, typeSpeed);
                        } else {
                            resolve();
                        }
                    };
                    typeChar();
                });

                // Set final state
                syncComposerPlainText(corrected, true);

                // Sparkle explosion effect
                if (inputContainer) {
                    inputContainer.classList.add('spellcheck-success');

                    // Create sparkle container
                    const sparkleContainer = document.createElement('div');
                    sparkleContainer.className = 'spellcheck-sparkle-container';
                    inputContainer.appendChild(sparkleContainer);

                    // Generate sparkle particles
                    const colors = ['#3b82f6', '#8b5cf6', '#22c55e', '#f59e0b', '#ec4899', '#06b6d4'];
                    const rect = inputContainer.getBoundingClientRect();
                    const numParticles = 18;

                    for (let p = 0; p < numParticles; p++) {
                        const sparkle = document.createElement('div');
                        sparkle.className = 'spellcheck-sparkle';
                        const color = colors[Math.floor(Math.random() * colors.length)];
                        const startX = Math.random() * rect.width;
                        const startY = Math.random() * rect.height;
                        const endX = (Math.random() - 0.5) * 80;
                        const endY = (Math.random() - 0.5) * 60;

                        sparkle.style.cssText = `
                            left: ${startX}px;
                            top: ${startY}px;
                            background: ${color};
                            box-shadow: 0 0 6px ${color}, 0 0 12px ${color}40;
                            --sparkle-x: ${endX}px;
                            --sparkle-y: ${endY}px;
                            animation-delay: ${Math.random() * 0.3}s;
                            width: ${3 + Math.random() * 5}px;
                            height: ${3 + Math.random() * 5}px;
                        `;
                        sparkleContainer.appendChild(sparkle);
                    }

                    // Clean up sparkles and success class
                    setTimeout(() => {
                        sparkleContainer.remove();
                        inputContainer.classList.remove('spellcheck-success');
                    }, 1200);
                }

                toast({
                    title: corrected === plainText ? 'Texto já está correto' : 'Texto corrigido ✨',
                    description: corrected === plainText
                        ? 'Nenhum ajuste ortográfico foi necessário.'
                        : 'A ortografia foi revisada com sucesso.',
                });
            }
        } catch (error) {
            console.error('[SPELLCHECK] Error:', error);
            if (inputContainer) inputContainer.classList.remove('spellcheck-processing');
            toast({
                title: 'Erro',
                description: 'Falha ao conectar com o corretor ortográfico.',
                variant: 'destructive',
            });
        } finally {
            setIsSpellChecking(false);
        }
    };




    const lastCustomerMessage = useMemo(() => {
        const msgs = chat?.id ? (messagesByChat[chat.id] || []) : [];
        return msgs.slice().reverse().find(m => !m.from_me && m.type !== 'system');
    }, [chat?.id, messagesByChat]);

    const aiTypingDisplayName = chat?.assignedSystemAgent?.name || autopilotAgents.find(a => a.id === chat?.autopilot_config_id)?.name || autopilotConfig?.name || 'IA Dialogy';

    if (!chat) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center bg-transparent min-w-0 p-6">
                <div className="text-center space-y-4 p-8 rounded-3xl bg-card border border-border">
                    <div className="h-20 w-20 bg-muted rounded-full flex items-center justify-center mx-auto mb-4 ring-1 ring-border">
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
    const showAiTypingOverlay = showTextInput && isAiTyping && isComposerTextEmpty;
    const availableAutopilotAgents = autopilotAgents.length > 0 ? autopilotAgents : autopilotConfig ? [autopilotConfig] : [];
    const selectedAutopilotAgentId =
        chat.autopilot_config_id ||
        autopilotConfig?.id ||
        autopilotAgents.find(agent => agent.is_primary)?.id ||
        autopilotAgents[0]?.id ||
        null;
    const selectedAutopilotAgent =
        availableAutopilotAgents.find(agent => agent.id === selectedAutopilotAgentId) ||
        (autopilotConfig?.id === selectedAutopilotAgentId ? autopilotConfig : null) ||
        autopilotConfig ||
        autopilotAgents.find(agent => agent.is_primary) ||
        autopilotAgents[0] ||
        null;
    const currentCopilotMode = chat.copilot_mode === 'auto' ? 'auto' : 'suggest';
    const hasAutopilotAvailable = availableAutopilotAgents.length > 0;
    const headerAssigneeName = chat.agent?.name || chat.assignedSystemAgent?.name || 'Não atribuído';
    const headerStatusLabel = chat.status === 'atendimentos'
        ? 'Em atendimento'
        : chat.status === 'encerrados'
            ? 'Encerrado'
            : 'Na fila';
    const headerStatusClassName = chat.status === 'atendimentos'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300'
        : chat.status === 'encerrados'
            ? 'border-slate-200 bg-slate-100 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300'
            : 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300';




    return (
        <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-transparent">
            <ToolExecutionsSheet
                open={isToolExecutionsOpen}
                onOpenChange={setIsToolExecutionsOpen}
                executions={toolExecutionEntries}
                workspaceTimezone={workspaceTimezone}
            />
            {/* Conversation header */}
            <header
                data-chat-header
                className="z-20 flex min-h-[60px] shrink-0 items-center justify-between border-b border-slate-200 bg-white px-3 pb-2 pt-[env(safe-area-inset-top)] md:h-[72px] md:px-[clamp(14px,1.5vw,22px)] md:pb-0 md:pt-0 dark:border-white/10 dark:bg-[#050507]"
            >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                    {onBack && (
                        <Button variant="ghost" size="icon" onClick={onBack} className="md:hidden -ml-2 mr-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-zinc-500 dark:hover:text-white dark:hover:bg-white/5">
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                    )}
                    <div>
                        <Avatar className="h-10 w-10 border border-slate-200 bg-white md:h-11 md:w-11 dark:border-white/10 dark:bg-[#0B0B10]">
                            <AvatarImage fallbackOnBlank src={chat.contact.avatar_url || undefined} alt={chat.contact.name} data-ai-hint="person" />
                            <AvatarFallback className="bg-slate-100 text-slate-700 font-medium dark:bg-zinc-900 dark:text-white">{chat.contact.name.charAt(0)}</AvatarFallback>
                        </Avatar>
                    </div>
                    <div className="min-w-0 flex-1">
                        <h2 className="flex min-w-0 items-center gap-2 text-[15px] font-semibold text-slate-950 md:text-base dark:text-white">
                            <span className="min-w-0 truncate">{chat.contact.name}</span>
                            <Badge
                                data-chat-status
                                variant="secondary"
                                className={cn("h-5 shrink-0 whitespace-nowrap border px-2 text-[10px] font-semibold", headerStatusClassName)}
                            >
                                {headerStatusLabel}
                            </Badge>
                            {chat.relatedContactThread && (
                                <Badge variant="secondary" className="hidden h-5 shrink-0 border-blue-500/20 bg-blue-500/15 px-1.5 text-[10px] text-blue-700 min-[1800px]:inline-flex dark:text-blue-200">
                                    {chat.relatedChatIds?.length || 1} conversas
                                </Badge>
                            )}
                            <Dialog open={isChatDetailsOpen} onOpenChange={setIsChatDetailsOpen}>
                                <DialogContent
                                    className="sm:max-w-md"
                                    onCloseAutoFocus={(event) => {
                                        event.preventDefault();
                                        const returnFocusTarget = chatDetailsReturnFocusRef.current;
                                        chatDetailsReturnFocusRef.current = null;
                                        window.requestAnimationFrame(() => returnFocusTarget?.focus());
                                    }}
                                >
                                    <DialogHeader>
                                        <DialogTitle>Detalhes da conversa</DialogTitle>
                                        <DialogDescription>
                                            Dados tecnicos do atendimento selecionado.
                                        </DialogDescription>
                                    </DialogHeader>
                                    <div className="space-y-3 text-sm">
                                        <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
                                            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Canal</div>
                                            <div className="mt-1 flex items-center gap-2 font-medium text-foreground">
                                                {headerPlatformIcon}
                                                <span className="break-all">{chat.instance_name || resolvedPlatform}</span>
                                            </div>
                                        </div>
                                        <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
                                            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Contato</div>
                                            <div className="mt-1 break-all font-medium text-foreground">
                                                {headerContactValue || 'Nao informado'}
                                            </div>
                                        </div>
                                        <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">ID do chat</div>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7"
                                                    aria-label="Copiar ID do chat"
                                                    onClick={() => {
                                                        navigator.clipboard?.writeText(chat.id);
                                                        toast({ title: "ID copiado", description: "O ID da conversa foi copiado." });
                                                    }}
                                                >
                                                    <Copy className="h-3.5 w-3.5" />
                                                </Button>
                                            </div>
                                            <div className="mt-1 break-all font-mono text-xs text-foreground">{chat.id}</div>
                                        </div>
                                    </div>
                                </DialogContent>
                            </Dialog>
                        </h2>
                        <p className="flex min-w-0 items-center gap-1.5 overflow-hidden text-xs text-slate-500 dark:text-zinc-500">
                            {chat.instance_name && (
                                <span className="flex shrink-0 items-center gap-1 text-slate-500 dark:text-zinc-500">
                                    {headerPlatformIcon}
                                    <span className="hidden max-w-[88px] truncate min-[1200px]:inline">{chat.instance_name}</span>
                                </span>
                            )}
                            {chat.instance_name && headerContactValue && (
                                <span aria-hidden="true" className="hidden shrink-0 min-[1200px]:inline">•</span>
                            )}
                            <span className="min-w-0 truncate text-slate-600 dark:text-zinc-400">{headerContactValue}</span>
                            <span aria-hidden="true" className="hidden shrink-0 min-[1500px]:inline">•</span>
                            <span className="hidden max-w-[120px] shrink-0 truncate min-[1500px]:inline" title={`Equipe: ${chat.teamName || 'Sem equipe'}`}>
                                {chat.teamName || 'Sem equipe'}
                            </span>
                            <span aria-hidden="true" className="hidden shrink-0 min-[1800px]:inline">•</span>
                            <span className="hidden max-w-[140px] shrink-0 truncate font-medium text-slate-600 min-[1800px]:inline dark:text-zinc-400" title={`Responsável: ${headerAssigneeName}`}>
                                {headerAssigneeName}
                            </span>
                        </p>
                    </div>
                </div>
                <div data-chat-actions className="flex shrink-0 items-center gap-2">
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
                                <Button ref={mobileMoreActionsRef} aria-label="Mais ações da conversa" variant="ghost" size="icon" className="-mr-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-zinc-500 dark:hover:text-white dark:hover:bg-white/5">
                                    <MoreVertical className="h-5 w-5" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-64 bg-popover border-border">
                                <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Conversa</DropdownMenuLabel>
                                <DropdownMenuItem onSelect={() => {
                                    chatDetailsReturnFocusRef.current = mobileMoreActionsRef.current;
                                    setIsChatDetailsOpen(true);
                                }}>
                                    <Info className="mr-2 h-4 w-4" />
                                    <span>Detalhes técnicos</span>
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => onToggleContactPanel()}>
                                    <PanelRightOpen className="mr-2 h-4 w-4" />
                                    <span>Contexto do contato</span>
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={handleExportChat}>
                                    <FileText className="mr-2 h-4 w-4" />
                                    <span>Salvar conversa</span>
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Automação e IA</DropdownMenuLabel>
                                <DropdownMenuItem onClick={handleTrainAgent}>
                                    <Brain className="mr-2 h-4 w-4" />
                                    <span>Treinar agente</span>
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setIsToolExecutionsOpen(true)}>
                                    <Activity className="mr-2 h-4 w-4" />
                                    <span>Execuções da IA</span>
                                    {toolExecutionEntries.length > 0 && (
                                        <Badge variant="secondary" className="ml-auto h-5 px-1.5 text-[10px]">
                                            {toolExecutionEntries.length}
                                        </Badge>
                                    )}
                                </DropdownMenuItem>
                                <DropdownMenuCheckboxItem
                                    checked={isAiAgentActive}
                                    onCheckedChange={(checked) => handleAiSwitchChange(checked === true)}
                                    onSelect={(event) => event.preventDefault()}
                                    disabled={isAiTyping || (!isAiAgentActive && !hasAutopilotAvailable)}
                                    className="items-start py-2"
                                >
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium">Agente IA</p>
                                        <p className="max-w-[160px] truncate text-[10px] text-muted-foreground">{selectedAutopilotAgent?.name || 'Não configurado'}</p>
                                    </div>
                                    <span className="ml-auto pt-0.5 text-[10px] font-medium text-muted-foreground">{isAiAgentActive ? 'Ativo' : 'Inativo'}</span>
                                </DropdownMenuCheckboxItem>
                                <DropdownMenuItem disabled={!isAiAgentActive || isAiTyping} onSelect={() => handleCopilotModeChange('suggest')}>
                                    <MessageSquareQuote className="mr-2 h-4 w-4" />
                                    <span>Modo sugestão</span>
                                    {currentCopilotMode === 'suggest' && <Check className="ml-auto h-4 w-4 text-cyan-500" />}
                                </DropdownMenuItem>
                                <DropdownMenuItem disabled={!isAiAgentActive || isAiTyping} onSelect={() => handleCopilotModeChange('auto')}>
                                    <Bot className="mr-2 h-4 w-4" />
                                    <span>Modo automático</span>
                                    {currentCopilotMode === 'auto' && <Check className="ml-auto h-4 w-4 text-cyan-500" />}
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

                    {/* Desktop action island */}
                    <div className="hidden items-center gap-0.5 rounded-xl border border-slate-200 bg-slate-50/80 p-1 md:flex dark:border-white/10 dark:bg-white/[0.04]">
                        <TransferChatDialog
                            chat={chat}
                            currentUser={currentUser}
                            onTransferSuccess={onActionSuccess}
                            disabled={chat.status === 'encerrados'}
                            trigger={
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={chat.status === 'encerrados'}
                                    aria-label="Transferir conversa"
                                    className="h-8 gap-2 rounded-lg px-2 text-slate-600 shadow-none hover:bg-white hover:text-slate-950 hover:shadow-sm min-[1400px]:px-2.5 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white"
                                    title="Transferir conversa"
                                >
                                    <ArrowRightLeft className="h-4 w-4" />
                                    <span className="hidden min-[1400px]:inline">Transferir</span>
                                </Button>
                            }
                        />
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={onToggleContactPanel}
                            className="h-8 gap-2 rounded-lg px-2 text-slate-600 shadow-none hover:bg-white hover:text-slate-950 hover:shadow-sm min-[1400px]:px-2.5 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white"
                            aria-label="Ver contexto do contato"
                            title="Ver contexto do contato"
                        >
                            <PanelRightOpen className="h-4 w-4" />
                            <span className="hidden min-[1400px]:inline">Contexto</span>
                        </Button>
                        {/* Secondary actions stay consolidated at every desktop width. */}
                        <div>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button ref={desktopMoreActionsRef} aria-label="Mais ações da conversa" title="Mais ações" variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-slate-500 hover:bg-white hover:text-slate-900 hover:shadow-sm dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white">
                                        <MoreVertical className="h-5 w-5" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-64 bg-popover border-border">
                                    <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Conversa</DropdownMenuLabel>
                                    <DropdownMenuItem onSelect={() => {
                                        chatDetailsReturnFocusRef.current = desktopMoreActionsRef.current;
                                        setIsChatDetailsOpen(true);
                                    }}>
                                        <Info className="mr-2 h-4 w-4" />
                                        <span>Detalhes técnicos</span>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={handleExportChat}>
                                        <FileText className="mr-2 h-4 w-4" />
                                        <span>Salvar conversa</span>
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Automação e IA</DropdownMenuLabel>
                                    <DropdownMenuItem onClick={handleTrainAgent}>
                                        <Brain className="mr-2 h-4 w-4" />
                                        <span>Treinar agente</span>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => setIsToolExecutionsOpen(true)}>
                                        <Activity className="mr-2 h-4 w-4" />
                                        <span>Execuções da IA</span>
                                        {toolExecutionEntries.length > 0 && (
                                            <Badge variant="secondary" className="ml-auto h-5 px-1.5 text-[10px]">
                                                {toolExecutionEntries.length}
                                            </Badge>
                                        )}
                                    </DropdownMenuItem>
                                    <DropdownMenuCheckboxItem
                                        checked={isAiAgentActive}
                                        onCheckedChange={(checked) => handleAiSwitchChange(checked === true)}
                                        onSelect={(event) => event.preventDefault()}
                                        disabled={isAiTyping || (!isAiAgentActive && !hasAutopilotAvailable)}
                                        className="items-start py-2"
                                    >
                                        <div className="min-w-0">
                                            <p className="text-sm font-medium">Agente IA</p>
                                            <p className="max-w-[160px] truncate text-[10px] text-muted-foreground">{selectedAutopilotAgent?.name || 'Não configurado'}</p>
                                        </div>
                                        <span className="ml-auto pt-0.5 text-[10px] font-medium text-muted-foreground">{isAiAgentActive ? 'Ativo' : 'Inativo'}</span>
                                    </DropdownMenuCheckboxItem>
                                    <DropdownMenuItem disabled={!isAiAgentActive || isAiTyping} onSelect={() => handleCopilotModeChange('suggest')}>
                                        <MessageSquareQuote className="mr-2 h-4 w-4" />
                                        <span>Modo sugestão</span>
                                        {currentCopilotMode === 'suggest' && <Check className="ml-auto h-4 w-4 text-cyan-500" />}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem disabled={!isAiAgentActive || isAiTyping} onSelect={() => handleCopilotModeChange('auto')}>
                                        <Bot className="mr-2 h-4 w-4" />
                                        <span>Modo automático</span>
                                        {currentCopilotMode === 'auto' && <Check className="ml-auto h-4 w-4 text-cyan-500" />}
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

                    </div>

                </div>
            </header>

            {/* Messages Area */}

            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[#F8F9FB] dark:bg-black/25">
                {isLoadingInitialMessages ? (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                        <div className="flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span>Carregando conversa...</span>
                        </div>
                    </div>
                ) : (
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
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground bg-background px-3 py-1 rounded-full border border-border">
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                        <span>Carregando histórico...</span>
                                    </div>
                                )}
                            </div>
                        ),
                        Footer: () => (
                            <div className="min-h-4 px-2 pb-2 md:px-6">
                                {isAiTyping && (
                                    <div className="flex items-start gap-3 py-1">
                                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-emerald-500/20 bg-emerald-500/10 text-emerald-500">
                                            <Sparkles className="h-4 w-4" />
                                        </div>
                                        <div className="rounded-2xl rounded-tl-sm border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-700 shadow-sm dark:text-emerald-200">
                                            <span>{aiTypingDisplayName} está analisando</span>
                                            <span className="ml-1 inline-flex gap-0.5 align-middle">
                                                <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:-0.2s]" />
                                                <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:-0.1s]" />
                                                <span className="h-1 w-1 animate-bounce rounded-full bg-current" />
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )
                    }}
                    itemContent={(index, message) => {
                        const arrayIndex = index - firstItemIndex;
                        const prevMessage = arrayIndex > 0 ? visibleMessages[arrayIndex - 1] : undefined;
                        const replyToId = typeof message.metadata?.replyToMessageId === 'string'
                            ? message.metadata.replyToMessageId
                            : undefined;
                        const replyToApiId = typeof message.metadata?.replyToMessageIdFromApi === 'string'
                            ? message.metadata.replyToMessageIdFromApi
                            : undefined;
                        const quotedMessage =
                            (replyToId ? visibleMessagesLookup.byId.get(replyToId) : undefined) ||
                            (replyToApiId ? visibleMessagesLookup.byApiMessageId.get(replyToApiId) : undefined);
                        return (
                            <div className="px-2 py-0.5 md:px-[clamp(20px,3vw,48px)]" id={`message-${message.id}`} data-no-auto-translate>
                                <MessageItem
                                    key={message.id}
                                    message={message}
                                    quotedMessage={quotedMessage}
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
                )}
            </div>


            {
                isChatOpen ? (
                    <footer className="z-20 max-h-[45dvh] shrink-0 overflow-y-auto overscroll-contain bg-[#F8F9FB] p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] transition-[padding] md:p-[clamp(12px,1.8vh,18px)] md:px-[clamp(16px,2.5vw,40px)] md:pb-[calc(clamp(12px,1.8vh,18px)+env(safe-area-inset-bottom))] data-[state=open]:p-0 dark:bg-black/25">
                        {showShortcutSuggestions && filteredShortcuts.length > 0 && (
                            <div className="mb-2 p-2 border border-border rounded-xl bg-popover max-h-40 overflow-y-auto">
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
                                <div className="bg-blue-500/10 border border-blue-500/30 rounded-2xl p-4">
                                    <div className="flex items-center gap-2 mb-2">
                                        <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center">
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
                                                syncComposerPlainText(aiSuggestion.text, true);
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

                        <div className="space-y-2.5 md:space-y-3">
                            <form onSubmit={(e) => { e.preventDefault(); handleFormSubmit(); }} onKeyDown={handleKeyDown}>
                                <input type="hidden" name="chatId" value={chat.id} />

                                <div data-input-container className={cn(
                                    "relative mx-auto flex w-full max-w-[1600px] flex-col overflow-hidden rounded-[22px] border shadow-[0_10px_35px_-28px_rgba(15,23,42,0.55)] transition-all duration-200",
                                    isInternalNote
                                        ? "bg-yellow-50 dark:bg-yellow-950/40 border-yellow-300 dark:border-yellow-700/40"
                                        : "border-slate-200 bg-white dark:border-white/10 dark:bg-black",
                                    canSendFromComposer && !isInternalNote && "border-cyan-500/50",
                                    isSendBurstActive && !isInternalNote && "ring-1 ring-cyan-300/40",
                                    isAiTyping && !isInternalNote && "ring-1 ring-cyan-400/25"
                                )}>
                                    {!isInternalNote && canSendFromComposer && (
                                        <span className="pointer-events-none absolute left-6 right-6 top-0 h-px bg-cyan-300/60" />
                                    )}

                                    {isAiTyping && !isInternalNote && (
                                        <span className="pointer-events-none absolute inset-x-10 top-0 h-px bg-cyan-400" />
                                    )}

                                    {Boolean(sendFeedbackKey) && (
                                        <span
                                            key={`composer-burst-${sendFeedbackKey}`}
                                            className="pointer-events-none absolute inset-0 rounded-2xl border border-cyan-300/60"
                                        />
                                    )}

                                    {isSpellChecking && (
                                        <div className="px-4 pt-1">
                                            <div className="inline-flex items-center gap-2 rounded-full border border-blue-400/20 bg-blue-500/10 px-3 py-1 text-xs font-medium text-blue-600 dark:text-blue-300">
                                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                Revisando ortografia...
                                            </div>
                                        </div>
                                    )}

                                    {/* Text Input Area */}
                                    <div className="relative min-w-0 px-4 pt-2 pb-1">
                                        {showTextInput && isComposerTextEmpty && !showAiTypingOverlay && (
                                            <div className="absolute inset-0 px-4 pt-3 pb-1 pointer-events-none select-none">
                                                <span className={cn(
                                                    "text-[15px] leading-relaxed",
                                                    isInternalNote ? "text-muted-foreground/50" : "text-slate-400 dark:text-zinc-500"
                                                )}>Digite aqui o seu texto...</span>
                                            </div>
                                        )}
                                        {showAiTypingOverlay && (
                                            <div className="absolute inset-0 z-10 px-4 pt-3 pb-2 pointer-events-none select-none">
                                                <div className="flex items-center gap-2 text-sm font-medium text-cyan-600 dark:text-cyan-300">
                                                    <Sparkles className="h-4 w-4" />
                                                    <span>{aiTypingDisplayName} está escrevendo uma resposta</span>
                                                    <div className="flex items-center gap-1">
                                                        {[0, 1, 2].map((dot) => (
                                                            <span
                                                                key={`ai-typing-dot-${dot}`}
                                                                className="h-1.5 w-1.5 rounded-full bg-current"
                                                            />
                                                        ))}
                                                    </div>
                                                </div>
                                                <div className="mt-3 space-y-2">
                                                    {[72, 94, 61].map((width, index) => (
                                                        <div
                                                            key={`ai-typing-line-${index}`}
                                                            className="h-3 rounded-full bg-cyan-300/20"
                                                            style={{ width: `${width}%` }}
                                                        />
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        {showTextInput ? (
                                            <ContentEditable
                                                innerRef={contentEditableRef as any}
                                                html={newMessage}
                                                disabled={isAiTyping}
                                                onChange={handleMessageChange}
                                                onPaste={handlePaste}
                                                className={cn(
                                                    "w-full bg-transparent border-0 focus:ring-0 p-0 resize-none max-h-[120px] min-h-[28px] focus:outline-none scrollbar-hide whitespace-pre-wrap overflow-y-auto text-[15px] leading-relaxed",
                                                    isInternalNote ? "text-foreground" : "text-slate-900 caret-slate-900 dark:text-white dark:caret-white",
                                                    showAiTypingOverlay && "opacity-0"
                                                )}
                                                tagName="div"
                                                onKeyUp={saveCursorPosition}
                                                onClick={saveCursorPosition}
                                            />
                                        ) : null}
                                    </div>

                                    {/* Bottom Toolbar */}
                                    <div className="flex items-center justify-between gap-2 px-3 pb-3 pt-1">
                                        {/* Left Action Buttons */}
                                        <div className="flex items-center gap-1">
                                            <button
                                                type="button"
                                                className="h-8 w-8 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted dark:hover:bg-white/10 transition-colors"
                                                onClick={() => fileInputRef.current?.click()}
                                                disabled={isAiTyping}
                                                aria-label="Anexar arquivo"
                                            >
                                                <Plus className="h-4 w-4" />
                                            </button>
                                            <input
                                                type="file"
                                                ref={fileInputRef}
                                                onChange={handleFileChange}
                                                className="hidden"
                                                multiple
                                                accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,audio/*"
                                            />

                                            <button
                                                type="button"
                                                className={cn(
                                                    "inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors",
                                                    isInternalNote
                                                        ? "bg-yellow-500/15 text-yellow-700 hover:bg-yellow-500/20 dark:text-yellow-300"
                                                        : "text-muted-foreground hover:bg-muted hover:text-foreground dark:hover:bg-white/10"
                                                )}
                                                onClick={() => setIsInternalNote(!isInternalNote)}
                                                disabled={isAiTyping}
                                                aria-pressed={isInternalNote}
                                            >
                                                <StickyNote className="h-4 w-4" />
                                                <span className="hidden sm:inline">{isInternalNote ? 'Remover nota' : 'Nota interna'}</span>
                                            </button>

                                            {!isInternalNote && (
                                                <TooltipProvider delayDuration={150}>
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <button
                                                                type="button"
                                                                className={cn(
                                                                    "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium transition-colors",
                                                                    skipUserSignature
                                                                        ? "bg-red-500/15 text-red-600 hover:bg-red-500/20 dark:text-red-300"
                                                                        : "text-muted-foreground hover:bg-muted hover:text-foreground dark:hover:bg-white/10"
                                                                )}
                                                                onClick={() => setSkipUserSignature((value) => !value)}
                                                                disabled={isAiTyping}
                                                                aria-label="Remover Assinatura"
                                                                aria-pressed={skipUserSignature}
                                                            >
                                                                <Signature className="h-4 w-4" />
                                                            </button>
                                                        </TooltipTrigger>
                                                        <TooltipContent side="top">Remover Assinatura</TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                            )}

                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <button
                                                        type="button"
                                                        className="inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground dark:hover:bg-white/10"
                                                        disabled={isAiTyping}
                                                    >
                                                        <MessageSquareQuote className="h-4 w-4" />
                                                        <span className="hidden sm:inline">Respostas rápidas</span>
                                                    </button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="start" className="w-80 max-h-96 overflow-y-auto">
                                                    <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                                                        Atalhos disponíveis
                                                    </div>
                                                    <DropdownMenuSeparator />
                                                    {shortcuts.length === 0 ? (
                                                        <DropdownMenuItem disabled>
                                                            Nenhum atalho encontrado.
                                                        </DropdownMenuItem>
                                                    ) : (
                                                        shortcuts.map(shortcut => (
                                                            <DropdownMenuItem
                                                                key={shortcut.id}
                                                                className="items-start gap-0 px-0 py-0 focus:bg-transparent"
                                                                onSelect={() => handleShortcutSelect(shortcut)}
                                                            >
                                                                <div className="flex w-full flex-col gap-1 rounded-sm px-2 py-2 hover:bg-accent">
                                                                    <div className="flex items-center justify-between w-full gap-2">
                                                                        <span className="font-bold text-primary flex items-center gap-2">
                                                                            /{shortcut.name}
                                                                            {shortcut.type === 'global' && <Globe className="h-3 w-3 text-muted-foreground" />}
                                                                            {shortcut.type === 'team' && <Users className="h-3 w-3 text-muted-foreground" />}
                                                                            {shortcut.type === 'private' && <Lock className="h-3 w-3 text-muted-foreground" />}
                                                                        </span>
                                                                    </div>
                                                                    <span className="w-full truncate text-xs text-muted-foreground">{shortcut.message}</span>
                                                                </div>
                                                            </DropdownMenuItem>
                                                        ))
                                                    )}
                                                </DropdownMenuContent>
                                            </DropdownMenu>

                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <button
                                                        type="button"
                                                        className={cn(
                                                            "h-8 w-8 flex items-center justify-center rounded-full transition-colors hover:bg-muted dark:hover:bg-white/10",
                                                            isAiAgentActive
                                                                ? "bg-cyan-500/10 text-cyan-600 dark:text-cyan-300"
                                                                : "text-muted-foreground hover:text-foreground"
                                                        )}
                                                        aria-label="Configurar IA"
                                                    >
                                                        <Globe className={cn("h-4 w-4", isAiAgentActive && "text-cyan-500")} />
                                                    </button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="start" className="w-72">
                                                    <div className="px-2 py-2">
                                                        <div className="flex items-center justify-between gap-3">
                                                            <div className="flex min-w-0 items-center gap-2">
                                                                <Sparkles className="h-4 w-4 text-cyan-500" />
                                                                <div className="min-w-0">
                                                                    <p className="truncate text-sm font-medium">Copiloto IA</p>
                                                                    <p className="truncate text-xs text-muted-foreground">
                                                                        {selectedAutopilotAgent?.name || 'Nenhum agente selecionado'}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                            <Switch
                                                                checked={isAiAgentActive}
                                                                onCheckedChange={handleAiSwitchChange}
                                                                disabled={isAiTyping || !hasAutopilotAvailable}
                                                            />
                                                        </div>
                                                    </div>
                                                    <DropdownMenuSeparator />
                                                    <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                                                        Agente responsavel
                                                    </div>
                                                    {!hasAutopilotAvailable ? (
                                                        <DropdownMenuItem disabled>
                                                            Nenhum agente IA configurado.
                                                        </DropdownMenuItem>
                                                    ) : (
                                                        availableAutopilotAgents.map(agent => (
                                                            <DropdownMenuItem
                                                                key={agent.id}
                                                                onSelect={() => handleAgentChange(agent.id)}
                                                                disabled={isAiTyping}
                                                                className="gap-2"
                                                            >
                                                                <Bot className="h-4 w-4 text-muted-foreground" />
                                                                <span className="min-w-0 flex-1 truncate">{agent.name}</span>
                                                                {agent.id === selectedAutopilotAgent?.id && <Check className="h-4 w-4 text-cyan-500" />}
                                                            </DropdownMenuItem>
                                                        ))
                                                    )}
                                                    <DropdownMenuSeparator />
                                                    <DropdownMenuItem onSelect={handleSpellCheck} disabled={isSpellChecking || isComposerTextEmpty}>
                                                        {isSpellChecking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <SpellCheck2 className="mr-2 h-4 w-4" />}
                                                        Corretor Ortográfico
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>

                                            <Popover>
                                                <PopoverTrigger asChild>
                                                    <button
                                                        type="button"
                                                        className="h-8 w-8 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted dark:hover:bg-white/10 transition-colors"
                                                        disabled={isAiTyping}
                                                        aria-label="Abrir emojis"
                                                    >
                                                        <Smile className="h-4 w-4" />
                                                    </button>
                                                </PopoverTrigger>
                                                <PopoverContent className="w-auto p-0 border-none mb-2 bg-transparent shadow-none">
                                                    <EmojiPicker onEmojiClick={onEmojiClick} theme={emojiPickerTheme as any} />
                                                </PopoverContent>
                                            </Popover>
                                        </div>

                                        {/* Right: Audio / Send */}
                                        <div className="flex items-center gap-1.5">
                                            {!canSendFromComposer ? (
                                                <div className="animate-in zoom-in duration-150">
                                                    <AudioRecorder onSend={handleSendAudio} />
                                                </div>
                                            ) : (
                                                <div className="animate-in zoom-in duration-150">
                                                    <SendMessageButton
                                                        disabled={isAiTyping || (sendState === 'sending' && mediaFiles.length > 0)}
                                                        isPrimed={!isAiTyping && canSendFromComposer}
                                                        feedbackKey={sendFeedbackKey}
                                                        showFeedback={isSendBurstActive}
                                                    />
                                                </div>
                                            )}
                                        </div>
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

                            {/* Agent UI removed from here, moving to header */}
                        </div>
                    </footer>
                ) : (
                    <footer className="p-4 flex-shrink-0 text-center bg-background border-t border-border">
                        <p className='text-sm font-medium text-muted-foreground'>
                            Este atendimento foi encerrado.
                        </p>
                    </footer>
                )
            }
        </div >
    );
}

