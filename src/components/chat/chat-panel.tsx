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
    ArrowUp,
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
import { createUniqueMediaFileName, createUniqueMediaStoragePath } from '@/lib/media-file-name';
import { type Chat, type Message, type User, Tag, MessageMetadata, Contact, AutopilotConfig, NexusFlowInstance, Shortcut } from '@/lib/types';
import { isChatInInboxQueueScope } from '@/lib/inbox-pagination';
import SmartReplies from './smart-replies';
import ChatSummary from './chat-summary';
import { Switch } from '../ui/switch';
import { Label } from '../ui/label';
import { useToast } from '@/hooks/use-toast';
import { fetchSGPContracts, createSGPServiceOrder } from '@/plugins/sgp/actions';
import { useInboxStore } from '@/hooks/use-inbox-store';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Textarea } from '../ui/textarea';
import { getContactMessages, transferChatToIntelligentAgentAction } from '@/actions/chats';
import {
    activateChatCopilot,
    deactivateChatCopilot,
    getPendingCopilotSuggestion,
    listInboxAiAgents,
    requestCopilotSuggestion,
    resolveCopilotSuggestionAction,
    type InboxAiAgent,
} from '@/actions/copilot';
import { CopilotSuggestionCard, type CopilotSuggestionView } from './copilot-suggestion-card';
import { useFormStatus } from 'react-dom';
import { deleteMessageAction } from '@/actions/evolution-api';
import { sendAutomatedMessageAction, sendMediaAction, sendInternalNoteAction, getMessageStatusBatchAction, retryMessageAction } from '@/actions/messages';
import { getAutopilotConfig } from '@/actions/autopilot';
import { getShortcuts } from '@/actions/shortcuts';
import { generateChatHtml } from '@/lib/chat-export';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuTrigger,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubTrigger,
    DropdownMenuSubContent,
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
import { ComposerAiMenu } from './composer-ai-menu';
import composerStyles from './composer.module.css';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { reportClientMetric } from '@/lib/observability/client';
import { guardedAssignChat, guardedCloseChat, guardedSendAgentMessage } from '@/actions/chat-guards';
import {
    Virtuoso,
    type VirtuosoHandle,
} from 'react-virtuoso';
import { useTheme } from '@/providers/theme-provider';
import { shouldAcceptAiSuggestion } from '@/lib/inbox-ownership';
import { TransferChatDialog } from './contact-panel';

import { FaWhatsapp, FaInstagram, FaFacebookMessenger, FaTelegram } from 'react-icons/fa6';
import { Badge } from '../ui/badge';
import { getChatIdentityDisplayValue, resolveChatPlatform } from '@/lib/chat-platform';
import { buildToolExecutionItems, isToolExecutionMessage, ToolExecutionsSheet } from './tool-executions-sheet';
import { ConversationLearningDialog } from './conversation-learning-dialog';
import { usePremiumWheelScroller } from '@/hooks/use-premium-wheel-scroller';
import { ChatTagsBar } from './chat-tags-bar';

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

export function CloseChatDialog({ chat, onActionSuccess, reasons, isOpen, onOpenChange }: { chat: Chat, onActionSuccess: () => void, reasons: Tag[], isOpen?: boolean, onOpenChange?: (open: boolean) => void }) {
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
    feedbackKey,
}: {
    disabled?: boolean;
    feedbackKey?: number;
}) {
    const { pending } = useFormStatus();
    const isEnabled = !disabled && !pending;

    return (
        <button type="submit" className={composerStyles.send} disabled={!isEnabled} aria-label="Enviar mensagem" title="Enviar mensagem (Enter)">
            {pending ? <Loader2 className="animate-spin" /> : <span key={feedbackKey} className={composerStyles.sendIcon}><ArrowUp /></span>}
        </button>
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
    const [isDraggingFiles, setIsDraggingFiles] = useState(false);
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
    const [isConversationLearningOpen, setIsConversationLearningOpen] = useState(false);
    const [toolExecutionNow, setToolExecutionNow] = useState(() => Date.now());
    const autopilotSwitchTouchedRef = useRef(false);
    const [isAiTyping, setIsAiTyping] = useState(false);
    const canLoadOlderRef = useRef(canLoadOlder);
    const [allContactMessages, setAllContactMessages] = useState<Message[]>([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);
    const lastSendDraftRef = useRef<{ text: string; media: MediaFileType[]; isNote: boolean } | null>(null);
    const textSendQueueRef = useRef<TextSendJob[]>([]);
    const textSendProcessingRef = useRef(false);
    const retryingMessagesRef = useRef(new Set<string>());
    const [sendFeedbackKey, setSendFeedbackKey] = useState(0);
    const [isSendBurstActive, setIsSendBurstActive] = useState(false);
    const [isVoiceActive, setIsVoiceActive] = useState(false);
    const sendBurstTimeoutRef = useRef<number | null>(null);

    // AI Copilot Suggestion State
    const [aiSuggestion, setAiSuggestion] = useState<CopilotSuggestionView | null>(null);
    const [inboxAiAgents, setInboxAiAgents] = useState<InboxAiAgent[]>([]);
    const [isRequestingSuggestion, setIsRequestingSuggestion] = useState(false);

    // Virtualization refs/state removed
    // const messageHeightsRef = useRef<Map<string, number>>(new Map()); 

    const [autopilotConfig, setAutopilotConfig] = useState<AutopilotConfig | null>(null);
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
    const messageTimelineRef = useRef<HTMLDivElement>(null);
    const scrollToLatestFrameRef = useRef<number | null>(null);
    const finishInitialPositionTimerRef = useRef<number | null>(null);
    const initiallyPositionedChatRef = useRef<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const fileDragDepthRef = useRef(0);
    const contentEditableRef = useRef<any>(null);
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
    // Passar a conversa para a IA tira o atendimento do humano; exige confirmação
    // explícita para não acontecer por um clique errado.
    const [isAiTakeOverDialogOpen, setIsAiTakeOverDialogOpen] = useState(false);
    const [isTakingOverWithAi, setIsTakingOverWithAi] = useState(false);
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
        }, 900);
    }, []);

    useEffect(() => {
        return () => {
            if (sendBurstTimeoutRef.current) {
                window.clearTimeout(sendBurstTimeoutRef.current);
            }
        };
    }, []);

    // Turning the copilot on runs the same orchestrator the Intelligent Attendant uses,
    // on the server, and drafts a reply for the message that is already waiting.
    const enableCopilot = useCallback(async (agentId: string) => {
        if (!chat) return;
        autopilotSwitchTouchedRef.current = true;
        setIsAiAgentActive(true);
        updateChat(chat.id, {
            is_autopilot_active: true,
            autopilot_config_id: agentId,
            copilot_mode: 'suggest',
        });

        const selected = autopilotAgents.find(a => a.id === agentId) || (autopilotConfig?.id === agentId ? autopilotConfig : null);
        if (selected) setAutopilotConfig(selected);

        setIsRequestingSuggestion(true);
        const result = await activateChatCopilot(chat.id, agentId);
        setIsRequestingSuggestion(false);

        if (!result.success) {
            setIsAiAgentActive(false);
            updateChat(chat.id, { is_autopilot_active: false, copilot_mode: 'off' });
            toast({
                title: 'Não foi possível ativar o copiloto',
                description: result.error,
                variant: 'destructive',
            });
        }
    }, [autopilotAgents, autopilotConfig, chat, toast, updateChat]);

    const disableCopilot = useCallback(async () => {
        if (!chat) return;
        autopilotSwitchTouchedRef.current = true;
        setIsAiAgentActive(false);
        setAiSuggestion(null);
        updateChat(chat.id, { is_autopilot_active: false, copilot_mode: 'off' });
        await deactivateChatCopilot(chat.id);
    }, [chat, updateChat]);

    const handleAiSwitchChange = async (checked: boolean) => {
        if (!chat) return;
        if (!checked) {
            await disableCopilot();
            return;
        }

        const agentId = chat.autopilot_config_id
            || autopilotAgents.find(a => a.is_primary)?.id
            || autopilotAgents[0]?.id
            || autopilotConfig?.id;

        if (!agentId) {
            toast({
                title: 'Nenhum agente de IA disponível',
                description: 'Crie um agente de IA no Autopilot para usar o copiloto nas conversas.',
                variant: 'destructive',
            });
            return;
        }

        await enableCopilot(agentId);
    };

    const handleAgentChange = async (agentId: string) => {
        await enableCopilot(agentId);
    };

    /**
     * "Assumir a conversa" hands the chat over to the Intelligent Attendant that publishes
     * this AI configuration — the same runtime, now answering the customer directly.
     */
    const handleAiTakeOver = useCallback(async () => {
        if (!chat) return;
        const configId = chat.autopilot_config_id || autopilotConfig?.id;
        const agent = inboxAiAgents.find(item => item.id === configId);

        if (!agent?.systemAgentId || !agent.canTakeOverConversation) {
            toast({
                title: 'Este agente ainda não atende sozinho',
                description: 'Publique-o como Atendente Inteligente em Agentes do Sistema para que ele assuma conversas.',
                variant: 'destructive',
            });
            return;
        }

        setIsTakingOverWithAi(true);
        const result = await transferChatToIntelligentAgentAction({
            chatId: chat.id,
            systemAgentId: agent.systemAgentId,
        });
        setIsTakingOverWithAi(false);

        if (!result.success) {
            toast({
                title: 'Não foi possível transferir para a IA',
                description: result.error,
                variant: 'destructive',
            });
            return;
        }

        setIsAiTakeOverDialogOpen(false);
        setAiSuggestion(null);
        toast({
            title: `${agent.systemAgentName || agent.name} assumiu a conversa`,
            description: 'A IA passa a responder o cliente diretamente.',
        });
        onActionSuccess();
    }, [autopilotConfig?.id, chat, inboxAiAgents, onActionSuccess, toast]);

    const handleRequestSuggestion = useCallback(async () => {
        if (!chat) return;
        setIsRequestingSuggestion(true);
        setAiSuggestion(null);
        const result = await requestCopilotSuggestion(chat.id);
        setIsRequestingSuggestion(false);
        if (!result.success) {
            toast({
                title: 'Sem sugestão agora',
                description: result.error,
                variant: 'destructive',
            });
        }
    }, [chat, toast]);

    const resolveSuggestion = useCallback((outcome: 'sent' | 'edited' | 'dismissed') => {
        if (!chat) return;
        const suggestionId = aiSuggestion?.id ?? null;
        setAiSuggestion(null);
        void resolveCopilotSuggestionAction({ chatId: chat.id, suggestionId, outcome });
    }, [aiSuggestion?.id, chat]);

    const fetchAutopilotData = useCallback(async () => {
        if (!currentUser.activeWorkspaceId) return;
        const data = await getAutopilotConfig(currentUser.activeWorkspaceId, chat?.autopilot_config_id || undefined);
        if (!data.error) {
            setAutopilotConfig(data.config);
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

    // A draft that arrived while the operator was elsewhere is still waiting for them.
    useEffect(() => {
        const chatId = chat?.id;
        if (!chatId || !chat?.is_autopilot_active || chat?.assigned_system_agent_id) return;

        let cancelled = false;
        getPendingCopilotSuggestion(chatId)
            .then((result) => {
                if (cancelled || !result.suggestion) return;
                setAiSuggestion({
                    id: result.suggestion.id,
                    agentName: result.suggestion.agentName,
                    text: result.suggestion.suggestion,
                    blocks: result.suggestion.messageBlocks,
                    stage: result.suggestion.stage,
                    insights: result.suggestion.insights,
                    createdAt: result.suggestion.createdAt,
                });
            })
            .catch((error) => console.error('[CHAT_PANEL] Failed to hydrate copilot suggestion', error));

        return () => {
            cancelled = true;
        };
    }, [chat?.id, chat?.is_autopilot_active, chat?.assigned_system_agent_id]);

    useEffect(() => {
        const workspaceId = currentUser.activeWorkspaceId;
        if (!workspaceId) return;
        let cancelled = false;
        listInboxAiAgents(workspaceId)
            .then((result) => {
                if (!cancelled) setInboxAiAgents(result.agents);
            })
            .catch((error) => console.error('[CHAT_PANEL] Failed to load inbox AI agents', error));
        return () => {
            cancelled = true;
        };
    }, [currentUser.activeWorkspaceId]);

    // Subscribe to AI processing events and suggestions via Realtime
    useEffect(() => {
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
                setIsRequestingSuggestion(false);
            })
            .on('broadcast', { event: 'ai_suggestion_cleared' }, (payload) => {
                if (cancelled) return;
                if (!shouldAcceptAiSuggestion(chat.id, payload.payload?.chatId)) return;
                setAiSuggestion(null);
            })
            .on('broadcast', { event: 'ai_suggestion' }, (payload) => {
                if (cancelled) return; // Guard against updates after unmount
                setIsAiTyping(false);
                setIsRequestingSuggestion(false);
                if (!shouldAcceptAiSuggestion(chat.id, payload.payload?.chatId)) {
                    return;
                }
                const data = payload.payload;
                if (!data?.suggestion) return;
                setAiSuggestion({
                    id: data.id ?? null,
                    agentName: data.agentName || data.configName || 'IA',
                    text: data.suggestion,
                    blocks: Array.isArray(data.messageBlocks) ? data.messageBlocks : [],
                    stage: data.stage || 'model_response',
                    insights: data.insights || {},
                    createdAt: data.createdAt || new Date().toISOString(),
                });
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
            let cancelled = false;
            setIsLoadingHistory(true);
            setAllContactMessages([]);
            getContactMessages({
                contactId: chat.contact?.id || '',
                workspaceId: currentUser.activeWorkspaceId,
                limit: 1000
            })
                .then(res => {
                    if (!cancelled && res.messages) setAllContactMessages(res.messages);
                })
                .catch(err => console.error('[CHAT_PANEL] Failed to load full history', err))
                .finally(() => {
                    if (!cancelled) setIsLoadingHistory(false);
                });

            return () => {
                cancelled = true;
            };
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
    const timelineContentVersion = `${chat?.id || 'none'}:${visibleMessages.length}:${visibleMessages[0]?.id || 'empty'}:${visibleMessages[visibleMessages.length - 1]?.id || 'empty'}`;
    const {
        cancelAnimation: cancelPremiumWheelAnimation,
        scrollerRef: premiumWheelScrollerRef,
    } = usePremiumWheelScroller(isLoadingOlderMessages, timelineContentVersion);
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
    const START_INDEX = 1_000_000;
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
        const currentFirstId = visibleMessages.length > 0 ? visibleMessages[0].id : null;
        const prevFirstId = prevVisibleMessages.length > 0 ? prevVisibleMessages[0].id : null;

        // Update the tracking state
        setPrevVisibleMessages(visibleMessages);

        // Anchor against the first previously visible message. Counting the total
        // length delta is not safe because a realtime append can happen while the
        // older page is loading and would make the viewport jump.
        if (currentFirstId !== prevFirstId && prevFirstId !== null) {
            const prependedItemCount = visibleMessages.findIndex((message) => message.id === prevFirstId);
            if (prependedItemCount > 0) {
                setFirstItemIndex(prev => prev - prependedItemCount);
            }
        }
    }

    const handleMessageRangeChanged = useCallback(({ startIndex: visibleStartIndex }: { startIndex: number }) => {
        // Start fetching shortly before the user reaches the first item. Once the
        // page is prepended, firstItemIndex moves backwards and this distance grows,
        // preventing a cascade of requests while preserving the visual anchor.
        if (visibleStartIndex - firstItemIndex <= 6) {
            tryLoadOlder();
        }
    }, [firstItemIndex, tryLoadOlder]);

    const handleMessageScrolling = useCallback((isScrolling: boolean) => {
        if (!messageTimelineRef.current) return;
        messageTimelineRef.current.dataset.scrolling = isScrolling ? 'true' : 'false';
    }, []);

    const scrollToLatestMessage = useCallback((behavior: 'auto' | 'smooth' = 'smooth') => {
        cancelPremiumWheelAnimation();
        userScrolledUpRef.current = false;

        if (scrollToLatestFrameRef.current !== null) {
            window.cancelAnimationFrame(scrollToLatestFrameRef.current);
        }

        const resolvedBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'auto'
            : behavior;

        // Two frames let the optimistic/store update commit before Virtuoso resolves
        // LAST, avoiding stale relative indices after a prepend-enabled timeline.
        scrollToLatestFrameRef.current = window.requestAnimationFrame(() => {
            scrollToLatestFrameRef.current = window.requestAnimationFrame(() => {
                scrollToLatestFrameRef.current = null;
                virtuosoRef.current?.scrollToIndex({
                    index: 'LAST',
                    align: 'end',
                    behavior: resolvedBehavior,
                });
            });
        });
    }, [cancelPremiumWheelAnimation]);

    const settleInitialPositionAtLatest = useCallback(() => {
        if (!chat?.id || isLoadingInitialMessages || visibleMessages.length === 0) return;
        if (initiallyPositionedChatRef.current === chat.id) return;

        scrollToLatestMessage('auto');

        // Message rows can change height after Virtuoso's first measurement
        // (images, audio metadata, fonts, etc.). Keep the initial viewport pinned
        // to the latest message until the list height has been quiet for a moment.
        if (finishInitialPositionTimerRef.current !== null) {
            window.clearTimeout(finishInitialPositionTimerRef.current);
        }
        finishInitialPositionTimerRef.current = window.setTimeout(() => {
            initiallyPositionedChatRef.current = chat.id;
            finishInitialPositionTimerRef.current = null;
        }, 400);
    }, [chat?.id, isLoadingInitialMessages, scrollToLatestMessage, visibleMessages.length]);

    useEffect(() => () => {
        if (scrollToLatestFrameRef.current !== null) {
            window.cancelAnimationFrame(scrollToLatestFrameRef.current);
        }
        if (finishInitialPositionTimerRef.current !== null) {
            window.clearTimeout(finishInitialPositionTimerRef.current);
        }
    }, []);

    useLayoutEffect(() => {
        settleInitialPositionAtLatest();
    }, [settleInitialPositionAtLatest]);

    const startIndex = 0;
    const padTop = 0;
    const padBottom = 0;


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
            const safeName = (chat.contact?.name || chat.protocol || 'chat').replace(/[^a-z0-9]/gi, '_').toLowerCase();
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

    const handleLearnFromConversation = () => {
        if (!activeAutopilotConfig) {
            toast({
                title: 'Nenhum agente selecionado',
                description: 'Selecione o agente que deve receber este aprendizado.',
                variant: 'destructive',
            });
            return;
        }
        setIsConversationLearningOpen(true);
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
                mediatype = 'audio';
            }

            const finalMimeType = file.type || (isAudioExt ? 'audio/mpeg' : file.type) || 'application/octet-stream';

            // Keep the visible/provider filename unique as well as the Storage path.
            // This matters when several files have the same browser name (or are
            // pasted as the generic `image.png`) in the same send operation.
            const uniqueFileName = createUniqueMediaFileName(file.name);

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

    const isFileDrag = (event: React.DragEvent<HTMLElement>) =>
        Array.from(event.dataTransfer.types).includes('Files');

    const handleComposerDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        fileDragDepthRef.current += 1;
        setIsDraggingFiles(true);
    };

    const handleComposerDragOver = (event: React.DragEvent<HTMLDivElement>) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        setIsDraggingFiles(true);
    };

    const handleComposerDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
        if (!isDraggingFiles) return;
        event.preventDefault();
        fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
        if (fileDragDepthRef.current === 0) setIsDraggingFiles(false);
    };

    const handleComposerDrop = (event: React.DragEvent<HTMLDivElement>) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        fileDragDepthRef.current = 0;
        setIsDraggingFiles(false);
        const files = Array.from(event.dataTransfer.files);
        if (files.length > 0) void processFiles(files);
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
    const headerContactValue = contactDisplayValue || (isMetaPlatform ? '' : chat?.contact?.phone || chat?.contact?.phone_number_jid || '');

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
                    : resolvedPlatform === 'webchat'
                        ? <Globe className="h-3 w-3 text-blue-500" />
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
        }
    }, [currentUser, onActionSuccess, replaceOptimisticMessage, setDraft, tabId, toast, updateMessage, workspaceTimezone]);

    const enqueueTextSend = useCallback((job: TextSendJob) => {
        textSendQueueRef.current.push(job);
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

            scrollToLatestMessage();

            setNewMessage('');
            setMediaFiles([]);
            setSkipUserSignature(false);
            setIsInternalNote(false);
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

        // Optimization: Do not block for media sending.
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
        setIsInternalNote(false);
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

        scrollToLatestMessage();

        // Process in background (Fire-and-forget from UI perspective).
        // Upload every object with its own path, then submit one server action
        // for the batch. This avoids racing several send actions against the
        // same chat while preserving an individual optimistic status per file.
        (async () => {
            const markFailed = (index: number, errorMessage: string, notify = true) => {
                const mf = filesToSend[index];
                const optMsg = optimisticMessages[index];
                console.error(`Error sending file ${mf.name}:`, errorMessage);
                updateMessage(chatId, optMsg.id, {
                    api_message_status: 'FAILED',
                    metadata: {
                        ...optMsg.metadata,
                        send_error: errorMessage,
                        send_error_details: {
                            source: 'client_media_send',
                            status: 'FAILED',
                            reason: errorMessage,
                            captured_at: new Date().toISOString(),
                        },
                    }
                });

                if (notify) {
                    toast({
                        title: 'Erro ao enviar ' + mf.name,
                        description: errorMessage,
                        variant: 'destructive'
                    });
                }
            };

            const uploadedMedia: Array<{
                index: number;
                file: MediaFileType;
                storagePath: string;
                publicUrl: string;
            }> = [];

            try {
                for (let i = 0; i < filesToSend.length; i++) {
                    const mf = filesToSend[i];
                    const storagePath = createUniqueMediaStoragePath(mf.name);

                    try {
                        const { publicUrl, error: uploadError } = await uploadFileToStorage(
                            mf.file,
                            'temp-media',
                            storagePath,
                        );

                        if (uploadError || !publicUrl) {
                            throw new Error(uploadError || 'Upload sem URL pública.');
                        }

                        uploadedMedia.push({ index: i, file: mf, storagePath, publicUrl });
                    } catch (fileErr) {
                        const errorMessage = fileErr instanceof Error
                            ? `Falha no upload de ${mf.name}: ${fileErr.message}`
                            : `Falha no upload de ${mf.name}.`;
                        markFailed(i, errorMessage);
                    }
                }

                if (uploadedMedia.length === 0) return;

                const firstUploadedIndex = uploadedMedia[0].index;
                const mediaPayload = uploadedMedia.map(({ index, file, storagePath, publicUrl }) => ({
                    base64: publicUrl,
                    mimetype: file.type,
                    filename: file.name,
                    mediatype: file.mediatype,
                    thumbnail: file.thumbnail,
                    caption: index === firstUploadedIndex ? captionForFirst : '',
                    deleteAfterSend: true,
                    storageBucket: 'temp-media',
                    storagePath,
                }));

                const result = await sendMediaAction(chatId, captionForFirst, mediaPayload, tabId);

                if (result.error) {
                    throw new Error(result.error);
                }

                const serverMessages = result.messages || [];
                uploadedMedia.forEach(({ index }, position) => {
                    const optMsg = optimisticMessages[index];
                    const realMsg = serverMessages[position];

                    if (realMsg) {
                        replaceOptimisticMessage(chatId, optMsg.id, {
                            ...realMsg,
                            sender: optMsg.sender,
                            formattedDate: formatMessageDate(new Date(realMsg.createdAt), workspaceTimezone),
                        });
                    } else {
                        updateMessage(chatId, optMsg.id, {
                            api_message_status: 'SENT',
                        });
                    }
                });
            } catch (batchErr) {
                const errorMessage = batchErr instanceof Error ? batchErr.message : 'Falha no envio dos arquivos.';
                uploadedMedia.forEach(({ index }) => markFailed(index, errorMessage, false));
                toast({
                    title: 'Erro ao enviar arquivos',
                    description: errorMessage,
                    variant: 'destructive',
                });
            } finally {
                lastSendDraftRef.current = null;
                onActionSuccess();
                reportClientMetric('send_message', performance.now() - sendStart, { chatId, media: true });
            }
        })();
    };



    const handleSendAudio = async (audioBlob: Blob, duration: number, mimetype: string) => {
        if (!chat) throw new Error('Conversa indisponível.');

        // Determine file extension based on mimetype (WhatsApp prefers ogg)
        const audioExtension = mimetype.includes('ogg') ? 'ogg' : mimetype.includes('webm') ? 'webm' : mimetype.includes('mp4') ? 'm4a' : 'mp3';


        // 1. Upload to Supabase Storage (Public Bucket)
        const fileName = createUniqueMediaStoragePath(`audio.${audioExtension}`, 'audio-media');
        const { publicUrl, error: uploadError } = await uploadFileToStorage(audioBlob, 'temp-media', fileName);

        if (uploadError || !publicUrl) {
            throw new Error(uploadError || 'Não foi possível carregar o áudio.');
        }

        // 2. Send Media using the Public URL (instead of Base64)
        // User requested: "leave file in public, send url, then delete file"
        // We pass publicUrl in the 'base64' field because the action expects a string there, 
        // and internal logic handles URLs if they start with http.
        const audioFilename = createUniqueMediaFileName(`audio_gravado.${audioExtension}`);

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


        const result = await sendMediaAction(chat.id, '', mediaPayload, tabId, { mediaUrl: publicUrl, duration });


        if (!result.success || result.error) {
            console.error('[AUDIO_SEND] Error from server:', result.error);
            throw new Error(result.error || 'O envio não foi confirmado.');
        } else if ((result as any).messages && (result as any).messages.length > 0) {
            appendMessagesToChat(chat.id, (result as any).messages);
            triggerSendFeedback();
            scrollToLatestMessage();
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
        if (!(e.target instanceof HTMLElement) || !e.target.isContentEditable || e.nativeEvent.isComposing || isVoiceActive) return;
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

    const showTextInput = !isVoiceActive;
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
    // The copilot assists a chat a human still owns. Once an Intelligent Attendant takes
    // over, the AI answers the customer directly and there is nothing to suggest.
    const isCopilotActive = isAiAgentActive && !chat.assigned_system_agent_id;
    const selectedInboxAiAgent = inboxAiAgents.find(agent => agent.id === selectedAutopilotAgentId) || null;
    const composerAiAgents = availableAutopilotAgents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        avatarUrl: inboxAiAgents.find((inboxAgent) => inboxAgent.id === agent.id)?.systemAgentAvatarUrl || null,
    }));
    const copilotAgentName = selectedInboxAiAgent?.name || selectedAutopilotAgent?.name || 'IA Dialogy';
    const copilotAgentAvatarUrl = selectedInboxAiAgent?.systemAgentAvatarUrl || null;
    const canAiTakeOverConversation = Boolean(selectedInboxAiAgent?.canTakeOverConversation);
    const headerAssigneeName = chat.agent?.name || chat.assignedSystemAgent?.name || 'Não atribuído';
    const isRoboQueue = isChatInInboxQueueScope(chat, 'robo');
    const headerStatusLabel = chat.status === 'atendimentos'
        ? 'Em atendimento'
        : chat.status === 'encerrados'
            ? 'Encerrado'
            : isRoboQueue
                ? 'Robô'
                : 'Na fila';
    const headerStatusClassName = chat.status === 'atendimentos'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300'
        : chat.status === 'encerrados'
            ? 'border-slate-200 bg-slate-100 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300'
            : isRoboQueue
                ? 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/20 dark:bg-violet-500/10 dark:text-violet-300'
                : 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300';
    const headerPlatformLabel = resolvedPlatform === 'instagram'
        ? 'Instagram'
        : resolvedPlatform === 'messenger'
            ? 'Messenger'
            : resolvedPlatform === 'telegram'
                ? 'Telegram'
                : resolvedPlatform === 'webchat'
                    ? 'Chat do site'
                : 'WhatsApp';
    const headerServiceStartedAt = chat.assigned_at || chat.updatedAt;
    const headerServiceStartedAtMs = headerServiceStartedAt ? new Date(headerServiceStartedAt).getTime() : Number.NaN;
    const headerServiceStartedTime = Number.isFinite(headerServiceStartedAtMs)
        ? new Date(headerServiceStartedAtMs).toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: workspaceTimezone,
        })
        : null;




    return (
        <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-transparent">
            <ToolExecutionsSheet
                open={isToolExecutionsOpen}
                onOpenChange={setIsToolExecutionsOpen}
                executions={toolExecutionEntries}
                workspaceTimezone={workspaceTimezone}
            />
            <ConversationLearningDialog
                open={isConversationLearningOpen}
                onOpenChange={setIsConversationLearningOpen}
                chatId={chat.id}
                workspaceId={chat.workspace_id}
                agent={activeAutopilotConfig}
                onPublished={fetchAutopilotData}
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
                    <div className="relative shrink-0">
                        <Avatar className="h-10 w-10 border border-slate-200 bg-white md:h-11 md:w-11 dark:border-white/10 dark:bg-[#0B0B10]">
                            <AvatarImage fallbackOnBlank src={chat.contact?.avatar_url || undefined} alt={chat.contact?.name || chat.protocol || 'Contato'} data-ai-hint="person" />
                            <AvatarFallback className="bg-slate-100 text-slate-700 font-medium dark:bg-zinc-900 dark:text-white">{((chat.contact?.name || chat.protocol || '?').trim()[0] || '?').toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-500 dark:border-[#050507]" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <h2 className="flex min-w-0 items-center gap-2 text-[15px] font-semibold text-slate-950 md:text-base dark:text-white">
                            <span className="min-w-0 truncate">{chat.contact?.name || chat.protocol || 'Sem nome'}</span>
                            <Badge
                                data-chat-status
                                variant="secondary"
                                className={cn("h-5 shrink-0 whitespace-nowrap border px-2 text-[10px] font-semibold md:hidden", headerStatusClassName)}
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
                            <span className="flex shrink-0 items-center gap-1">
                                {headerPlatformIcon}
                                <span>{headerPlatformLabel}</span>
                            </span>
                            {headerContactValue && <span aria-hidden="true">•</span>}
                            <span className="min-w-0 truncate text-slate-600 dark:text-zinc-400">{headerContactValue}</span>
                        </p>
                    </div>
                    <div className="hidden h-9 w-px shrink-0 bg-slate-200 xl:block dark:bg-white/10" />
                    <div className="hidden min-w-[118px] items-center gap-2 xl:flex">
                        <Users className="h-4 w-4 shrink-0 text-slate-400 dark:text-zinc-500" />
                        <div className="min-w-0">
                            <p className="truncate text-xs font-semibold text-slate-800 dark:text-zinc-200">{chat.teamName || 'Sem equipe'}</p>
                            <p className="text-[10px] text-slate-400 dark:text-zinc-500">Equipe</p>
                        </div>
                    </div>
                    <div className="hidden h-9 w-px shrink-0 bg-slate-200 2xl:block dark:bg-white/10" />
                    <div className="hidden min-w-[132px] items-center gap-2 2xl:flex">
                        <Clock className="h-4 w-4 shrink-0 text-slate-400 dark:text-zinc-500" />
                        <div>
                            <p className="text-xs font-semibold text-slate-800 dark:text-zinc-200">Atendimento</p>
                            <p className="text-[10px] text-slate-400 dark:text-zinc-500">{headerServiceStartedTime ? `desde ${headerServiceStartedTime}` : 'Horário indisponível'}</p>
                        </div>
                    </div>
                    <div className="hidden h-9 w-px shrink-0 bg-slate-200 md:block dark:bg-white/10" />
                    <div className="hidden min-w-[104px] md:block">
                        <Badge variant="secondary" className={cn("h-5 whitespace-nowrap border px-2 text-[10px] font-semibold", headerStatusClassName)}>
                            {headerStatusLabel}
                        </Badge>
                        <p className="mt-0.5 truncate text-[10px] text-slate-400 dark:text-zinc-500" title={`Responsável: ${headerAssigneeName}`}>
                            {headerAssigneeName}
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

                    <AlertDialog open={isAiTakeOverDialogOpen} onOpenChange={setIsAiTakeOverDialogOpen}>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Deixar a IA assumir esta conversa?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    {selectedInboxAiAgent?.name || 'O agente de IA'} passa a responder {chat.contact?.name || 'o cliente'} diretamente
                                    e o atendimento sai da sua fila. Para apenas finalizar o atendimento, use &quot;Encerrar Atendimento&quot;.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel disabled={isTakingOverWithAi}>Cancelar</AlertDialogCancel>
                                <AlertDialogAction
                                    disabled={isTakingOverWithAi}
                                    onClick={(event) => {
                                        event.preventDefault();
                                        void handleAiTakeOver();
                                    }}
                                >
                                    {isTakingOverWithAi && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    Sim, passar para a IA
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>

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
                                {/* Ações de IA vivem no menu "IA" do campo de mensagem.
                                    Ficavam aqui coladas em "Encerrar Atendimento" e eram
                                    acionadas por engano no lugar dele. */}
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
                                    {/* Ações de IA vivem no menu "IA" do campo de mensagem. */}
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

            <ChatTagsBar chat={chat} onUpdate={onActionSuccess} />

            {/* Messages Area */}

            <div
                ref={messageTimelineRef}
                className="chat-timeline relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[#F8F9FB] dark:bg-black/25"
            >
                {isLoadingInitialMessages ? (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                        <div className="flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span>Carregando conversa...</span>
                        </div>
                    </div>
                ) : (
                <>
                <div
                    className={cn(
                        "pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 transition-[opacity,transform] duration-200 motion-reduce:transition-none",
                        isLoadingOlderMessages
                            ? "translate-y-0 opacity-100"
                            : "-translate-y-2 opacity-0"
                    )}
                    role="status"
                    aria-live="polite"
                    aria-hidden={!isLoadingOlderMessages}
                >
                    <div className="flex items-center gap-2 rounded-full border border-border/80 bg-background/95 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-lg shadow-black/5 backdrop-blur-md dark:shadow-black/30">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>Buscando mensagens anteriores...</span>
                    </div>
                </div>
                <Virtuoso
                    key={chat?.id}
                    ref={virtuosoRef}
                    scrollerRef={premiumWheelScrollerRef}
                    style={{ height: '100%', width: '100%' }}
                    data={visibleMessages}
                    firstItemIndex={firstItemIndex}
                    initialTopMostItemIndex={{ index: 'LAST', align: 'end' }}
                    increaseViewportBy={{ top: 480, bottom: 240 }}
                    minOverscanItemCount={{ top: 4, bottom: 2 }}
                    defaultItemHeight={96}
                    skipAnimationFrameInResizeObserver
                    alignToBottom={true}
                    isScrolling={handleMessageScrolling}
                    computeItemKey={(index, item) => item.id} // STABILITY: Prevent re-renders on prepend
                    followOutput={(isAtBottom) => {
                        // If we are at the bottom, stay there.
                        // If user is scrolled up, don't force them down unless it's their own message (handled by logic elsewhere)
                        return isAtBottom ? 'auto' : false;
                    }}
                    atBottomStateChange={(atBottom) => {
                        userScrolledUpRef.current = !atBottom;
                    }}
                    rangeChanged={handleMessageRangeChanged}
                    startReached={tryLoadOlder}
                    totalListHeightChanged={settleInitialPositionAtLatest}
                    components={{
                        Header: () => <div className="h-4" aria-hidden="true" />,
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
                            <div className="px-2 py-0.5 md:px-[clamp(20px,3vw,48px)]" id={`message-${message.id}`} data-message-row data-no-auto-translate>
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
                </>
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

                        {/* AI Copilot draft: same orchestrator as the Intelligent Attendant,
                            proposed to the operator instead of sent to the customer. */}
                        {isCopilotActive && (
                            <CopilotSuggestionCard
                                suggestion={aiSuggestion}
                                isThinking={isAiTyping || isRequestingSuggestion}
                                agentName={copilotAgentName}
                                agentAvatarUrl={copilotAgentAvatarUrl}
                                canRequest={hasAutopilotAvailable}
                                onSend={(text) => {
                                    // Send exactly what the preview showed: one message per block.
                                    const blocks = aiSuggestion?.blocks?.length ? aiSuggestion.blocks : [text];
                                    blocks.forEach((block) => { void handleFormSubmit(block); });
                                    resolveSuggestion('sent');
                                }}
                                onEdit={(text) => {
                                    syncComposerPlainText(text, true);
                                    resolveSuggestion('edited');
                                }}
                                onRegenerate={handleRequestSuggestion}
                                onDismiss={() => resolveSuggestion('dismissed')}
                            />
                        )}

                        <div className="space-y-2.5 md:space-y-3">
                            <form onSubmit={(e) => { e.preventDefault(); handleFormSubmit(); }} onKeyDown={handleKeyDown}>
                                <input type="hidden" name="chatId" value={chat.id} />

                                <div
                                    data-input-container
                                    data-ready={canSendFromComposer}
                                    data-note={isInternalNote}
                                    data-voice={isVoiceActive}
                                    data-dragging={isDraggingFiles}
                                    className={composerStyles.composer}
                                    onDragEnter={handleComposerDragEnter}
                                    onDragOver={handleComposerDragOver}
                                    onDragLeave={handleComposerDragLeave}
                                    onDrop={handleComposerDrop}
                                >
                                    {isSendBurstActive && <span key={sendFeedbackKey} className={composerStyles.burst} />}
                                    {isDraggingFiles && (
                                        <div className={composerStyles.dropOverlay} aria-hidden="true">
                                            <span className={composerStyles.dropIcon}><Paperclip size={18} /></span>
                                            <span><strong>Solte para anexar</strong><small>Fotos, vídeos, documentos ou áudios</small></span>
                                        </div>
                                    )}
                                    {isInternalNote && <div className={composerStyles.mode}><StickyNote size={13} /><span>Nota interna · somente sua equipe pode ver</span><button type="button" onClick={() => setIsInternalNote(false)} aria-label="Sair da nota interna"><X size={13} /></button></div>}
                                    {skipUserSignature && <div className={composerStyles.mode}><Signature size={13} /><span>Esta mensagem será enviada sem assinatura</span><button type="button" onClick={() => setSkipUserSignature(false)} aria-label="Restaurar assinatura"><X size={13} /></button></div>}
                                    {mediaFiles.length > 0 && <MediaPreview mediaFiles={mediaFiles} setMediaFiles={setMediaFiles} />}

                                    {isSpellChecking && (
                                        <div className="px-4 pt-1">
                                            <div className="inline-flex items-center gap-2 rounded-full border border-blue-400/20 bg-blue-500/10 px-3 py-1 text-xs font-medium text-blue-600 dark:text-blue-300">
                                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                Revisando ortografia...
                                            </div>
                                        </div>
                                    )}

                                    {/* Text Input Area */}
                                    <div className={cn("relative min-w-0 px-5 pb-1 pt-4", isVoiceActive && "hidden")}>
                                        {showTextInput && isComposerTextEmpty && !showAiTypingOverlay && (
                                            <div className="pointer-events-none absolute inset-0 px-5 pb-1 pt-4 select-none">
                                                <span className={cn(
                                                    "text-[15px] leading-relaxed",
                                                    isInternalNote ? "text-amber-700/60" : "text-muted-foreground/70"
                                                )}>{isInternalNote ? 'Escreva uma nota para sua equipe…' : mediaFiles.length ? 'Adicione uma legenda…' : 'Escreva uma mensagem…'}</span>
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
                                                    composerStyles.editor, "w-full resize-none overflow-y-auto whitespace-pre-wrap border-0 bg-transparent focus:outline-none focus:ring-0 scrollbar-hide",
                                                    isInternalNote ? "text-amber-950" : "text-foreground",
                                                    showAiTypingOverlay && "opacity-0"
                                                )}
                                                role="textbox"
                                                aria-label={isInternalNote ? "Nota interna" : "Mensagem"}
                                                aria-multiline="true"
                                                tagName="div"
                                                onKeyUp={saveCursorPosition}
                                                onClick={saveCursorPosition}
                                            />
                                        ) : null}
                                    </div>

                                    {/* Bottom Toolbar */}
                                    <div className={composerStyles.toolbar}>
                                        {/* Left Action Buttons */}
                                        <div className={cn("flex min-w-0 items-center gap-1.5", isVoiceActive && "hidden")}>
                                            <input
                                                type="file"
                                                ref={fileInputRef}
                                                onChange={handleFileChange}
                                                className="hidden"
                                                multiple
                                                accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,audio/*"
                                            />

                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <button type="button" className={cn(composerStyles.tool, composerStyles.add)} disabled={isAiTyping} aria-label="Anexos e ferramentas" title="Anexos e ferramentas">
                                                        <Plus size={19} />
                                                    </button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="start" side="top" sideOffset={12} className="w-72 rounded-2xl p-2 shadow-xl">
                                                    <DropdownMenuItem className="gap-3 rounded-xl py-3" onSelect={() => fileInputRef.current?.click()}><Paperclip className="h-4 w-4" /><div><p className="text-sm font-medium">Anexar mídia</p><p className="text-[11px] text-muted-foreground">Fotos, vídeos, documentos e áudios</p></div></DropdownMenuItem>
                                                    <DropdownMenuSeparator />
                                                    <DropdownMenuSub>
                                                        <DropdownMenuSubTrigger className="gap-3 rounded-xl py-3"><MessageSquareQuote className="h-4 w-4" /><span>Respostas rápidas</span><kbd className="ml-auto text-xs text-muted-foreground">/</kbd></DropdownMenuSubTrigger>
                                                        <DropdownMenuSubContent className="max-h-80 w-[min(300px,calc(100vw-40px))] overflow-y-auto rounded-xl p-2">
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
                                                        </DropdownMenuSubContent>
                                                    </DropdownMenuSub>
                                                    <DropdownMenuSeparator />
                                                    <DropdownMenuLabel>
                                                        <span className="block text-sm">Próxima mensagem</span>
                                                        <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">As opções são desativadas após o envio.</span>
                                                    </DropdownMenuLabel>
                                                    <DropdownMenuSeparator />
                                                    <DropdownMenuCheckboxItem
                                                        checked={isInternalNote}
                                                        onCheckedChange={(checked) => {
                                                            const enabled = checked === true;
                                                            setIsInternalNote(enabled);
                                                            if (enabled) setSkipUserSignature(false);
                                                        }}
                                                        onSelect={(event) => event.preventDefault()}
                                                    >
                                                        <StickyNote className="mr-2 h-4 w-4 text-amber-500" />
                                                        <div>
                                                            <p className="text-sm font-medium">Nota interna</p>
                                                            <p className="text-[10px] text-muted-foreground">Visível somente para a equipe</p>
                                                        </div>
                                                    </DropdownMenuCheckboxItem>
                                                    <DropdownMenuCheckboxItem
                                                        checked={skipUserSignature}
                                                        disabled={isInternalNote}
                                                        onCheckedChange={(checked) => {
                                                            const enabled = checked === true;
                                                            setSkipUserSignature(enabled);
                                                            if (enabled) setIsInternalNote(false);
                                                        }}
                                                        onSelect={(event) => event.preventDefault()}
                                                    >
                                                        <Signature className="mr-2 h-4 w-4 text-violet-500" />
                                                        <div>
                                                            <p className="text-sm font-medium">Sem assinatura</p>
                                                            <p className="text-[10px] text-muted-foreground">Envia sem o nome do atendente</p>
                                                        </div>
                                                    </DropdownMenuCheckboxItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>



                                            <ComposerAiMenu
                                                key={chat.id}
                                                agents={composerAiAgents}
                                                selectedId={selectedAutopilotAgent?.id}
                                                active={isCopilotActive}
                                                busy={isAiTyping || isRequestingSuggestion || isTakingOverWithAi}
                                                autonomous={Boolean(chat.assigned_system_agent_id)}
                                                canTakeOver={canAiTakeOverConversation}
                                                canSpellCheck={!isComposerTextEmpty}
                                                spellChecking={isSpellChecking}
                                                onActivate={handleAgentChange}
                                                onDeactivate={disableCopilot}
                                                onSuggest={() => { void handleRequestSuggestion(); }}
                                                onSpellCheck={() => { void handleSpellCheck(); }}
                                                onLearn={handleLearnFromConversation}
                                                onExecutions={() => setIsToolExecutionsOpen(true)}
                                                onTakeOver={() => setIsAiTakeOverDialogOpen(true)}
                                            />

                                            <Popover>
                                                <PopoverTrigger asChild>
                                                    <button
                                                        type="button"
                                                        className={composerStyles.tool}
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
                                        <div className={cn("flex items-center gap-1.5", isVoiceActive && "w-full min-w-0")}>
                                            {!canSendFromComposer ? (
                                                <div className={cn("min-w-0", isVoiceActive && "w-full")} >
                                                    <AudioRecorder key={chat.id} onSend={handleSendAudio} onActiveChange={setIsVoiceActive} disabled={isAiTyping || isInternalNote} />
                                                </div>
                                            ) : (
                                                <div className="animate-in zoom-in duration-150">
                                                    <SendMessageButton
                                                        disabled={isAiTyping}
                                                        feedbackKey={sendFeedbackKey}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </form>
                            <div className={composerStyles.hint}>
                                <span aria-live="polite">{isDraggingFiles ? 'Solte os arquivos para anexar' : isSendBurstActive ? <span className={composerStyles.feedback}><Check size={12} />Mensagem adicionada à conversa</span> : isVoiceActive ? 'Você pode ouvir e revisar antes de enviar.' : mediaFiles.length ? `${mediaFiles.length} arquivo(s) pronto(s) para enviar` : 'Use / para encontrar uma resposta rápida'}</span>
                                {!isVoiceActive && <span><kbd>Enter</kbd> envia · <kbd>Shift + Enter</kbd> quebra a linha</span>}
                            </div>
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
