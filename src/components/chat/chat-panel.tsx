'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo, useLayoutEffect } from 'react';
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
    Loader2,
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
    ArrowRightLeft,
    XCircle,
    X,
    Copy,
    StickyNote,
    MessageSquareQuote,
    Users,
    Globe,
    Lock,
    MapPin,
    FileText,
    Brain
} from 'lucide-react';
import { uploadFileToStorage } from '@/lib/supabase/storage';
import { type Chat, type Message, type User, Tag, MessageMetadata, Contact, AutopilotConfig, NexusFlowInstance, Shortcut } from '@/lib/types';
import SmartReplies from './smart-replies';
import ChatSummary from './chat-summary';
import { generateAgentResponse } from '@/ai/flows/auto-responder';
import { Switch } from '../ui/switch';
import { Label } from '../ui/label';
import { useToast } from '@/hooks/use-toast';
import { Separator } from '../ui/separator';
import { useInboxStore } from '@/hooks/use-inbox-store';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Textarea } from '../ui/textarea';
import { closeChatAction, assignChatToSelfAction, getContactMessages, toggleChatAutopilot } from '@/actions/chats';
import { useFormStatus } from 'react-dom';
import { deleteMessageAction } from '@/actions/evolution-api';
import { sendAutomatedMessageAction, sendAgentMessageAction, sendMediaAction, sendInternalNoteAction } from '@/actions/messages';
import { getAutopilotConfig, addDocumentToKnowledgeBase } from '@/actions/autopilot';
import { getShortcuts } from '@/actions/shortcuts';
import { generateChatHtml } from '@/lib/chat-export';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
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
import { cn, formatWhatsappText } from '@/lib/utils';
import MessageItem from './message-item';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import EmojiPicker, { type EmojiClickData } from 'emoji-picker-react';
import ContentEditable from 'react-contenteditable';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { AudioRecorder } from './audio-recorder';

import { FaWhatsapp } from 'react-icons/fa6';
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
}

function CloseChatDialog({ chat, onActionSuccess, reasons, isOpen, onOpenChange }: { chat: Chat, onActionSuccess: () => void, reasons: Tag[], isOpen?: boolean, onOpenChange?: (open: boolean) => void }) {
    const [internalIsOpen, setInternalIsOpen] = React.useState(false);
    const [isSubmitting, setIsSubmitting] = React.useState(false);
    const [reasonTagId, setReasonTagId] = React.useState<string | null>(null);
    const [notes, setNotes] = React.useState('');
    const { toast } = useToast();

    const show = isOpen !== undefined ? isOpen : internalIsOpen;
    const setShow = onOpenChange || setInternalIsOpen;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        const result = await closeChatAction(chat.id, reasonTagId, notes);
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
                                    {reasons.map(reason => (
                                        <SelectItem key={reason.id} value={reason.id}>{reason.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="close-notes">Notas Internas (Opcional)</Label>
                            <Textarea id="close-notes" placeholder="Adicione uma observação sobre o encerramento..." value={notes} onChange={(e) => setNotes(e.target.value)} />
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
                ? "bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/20"
                : "bg-white/5 text-muted-foreground hover:bg-white/10"
        )} disabled={pending || disabled}>
            {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
        </Button>
    )
}





export default function ChatPanel({ chat, currentUser, onActionSuccess, closeReasons, showFullHistory, setShowFullHistory, tabId, onLoadOlderMessages, canLoadOlder, workspaceTimezone, onToggleContactPanel, onForwardMessage }: ChatPanelProps) {

    const updateChat = useInboxStore(state => state.updateChat);
    const [newMessage, setNewMessage] = useState('');
    const [mediaFiles, setMediaFiles] = useState<MediaFileType[]>([]);
    const [isAiAgentActive, setIsAiAgentActive] = useState(chat?.is_autopilot_active ?? false);
    const [isInternalNote, setIsInternalNote] = useState(false);
    const autopilotSwitchTouchedRef = useRef(false);
    const [isAiTyping, setIsAiTyping] = useState(false);
    const canLoadOlderRef = useRef(canLoadOlder);
    const [allContactMessages, setAllContactMessages] = useState<Message[]>([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);

    const [autopilotConfig, setAutopilotConfig] = useState<AutopilotConfig | null>(null);
    const [autopilotRules, setAutopilotRules] = useState<NexusFlowInstance[]>([]);
    const [autopilotAgents, setAutopilotAgents] = useState<AutopilotConfig[]>([]);
    const isProtocolScoped = !!(chat as any)?.protocolScoped;
    const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
    const [showShortcutSuggestions, setShowShortcutSuggestions] = useState(false);
    const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);

    const scrollAreaRef = useRef<HTMLDivElement>(null);
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
    const removeMessagesForChat = useInboxStore((state) => state.removeMessagesForChat);
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
            updateChat(chat.id, { is_autopilot_active: checked, autopilot_config_id: agentId });
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
    }, [chat?.id, chat?.is_autopilot_active]);

    const tryLoadOlder = useCallback(() => {
        const viewport = scrollAreaRef.current?.querySelector('div[data-radix-scroll-area-viewport]');
        if (!viewport) return;
        if ((chat as any)?.protocolScoped) return;
        if (!canLoadOlderRef.current || isFetchingHistoryRef.current || showFullHistory) return;
        const { scrollTop } = viewport;

        if (scrollTop >= 120) return;

        isFetchingHistoryRef.current = true;
        setIsLoadingOlderMessages(true);
        Promise.resolve(onLoadOlderMessages?.())
            .catch((error) => console.error('[CHAT_PANEL] Failed to load older messages', error))
            .finally(() => {
                isFetchingHistoryRef.current = false;
                setIsLoadingOlderMessages(false);
                // Se ainda no topo e ainda há histórico, continue puxando.
                if (viewport.scrollTop < 120 && canLoadOlderRef.current) {
                    requestAnimationFrame(tryLoadOlder);
                }
            });
    }, [onLoadOlderMessages, showFullHistory]);

    useEffect(() => {
        const viewport = scrollAreaRef.current?.querySelector('div[data-radix-scroll-area-viewport]');
        if (!viewport) return;

        const handleScroll = () => {
            const { scrollTop, scrollHeight, clientHeight } = viewport;
            const isScrolledUp = scrollHeight - scrollTop - clientHeight > 100;
            userScrolledUpRef.current = isScrolledUp;
            if (scrollTop < 120) {
                tryLoadOlder();
            }
        };

        viewport.addEventListener('scroll', handleScroll);
        return () => viewport.removeEventListener('scroll', handleScroll);
    }, [tryLoadOlder]);


    // Se há histórico anterior, tenta carregar imediatamente (útil quando há poucas mensagens na tela).
    useEffect(() => {
        if (canLoadOlderRef.current) {
            requestAnimationFrame(tryLoadOlder);
        }
    }, [tryLoadOlder, showFullHistory]);

    useEffect(() => {
        setAllContactMessages([]);
    }, [chat?.contact?.id]);

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
        return chat?.messages || [];
    }, [isProtocolScoped, showFullHistory, allContactMessages, chat?.messages]);

    useLayoutEffect(() => {
        const viewport = scrollAreaRef.current?.querySelector('div[data-radix-scroll-area-viewport]');
        if (!viewport) return;

        const currentScrollHeight = viewport.scrollHeight;
        const previousScrollHeight = previousScrollHeightRef.current;
        const addedHeight = currentScrollHeight - previousScrollHeight;
        const currentFirstMessageId = messagesToRender[0]?.id;
        const previousFirstMessageId = previousFirstMessageIdRef.current;

        if (previousFirstMessageId && currentFirstMessageId !== previousFirstMessageId && addedHeight > 0) {
            // Se o primeiro ID mudou e a altura aumentou, assumimos que mensagens antigas foram carregadas (prepend)
            // Mantemos a posição visual ajustando o scrollTop
            viewport.scrollTop += addedHeight;
        } else if (!userScrolledUpRef.current) {
            // Comportamento padrão: rolar para o final se o usuário não subiu a tela
            viewport.scrollTop = viewport.scrollHeight;
        }

        previousScrollHeightRef.current = currentScrollHeight;
        previousFirstMessageIdRef.current = currentFirstMessageId || null;
    }, [messagesToRender]);

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

    const handleDeleteMessage = async (messageId: string, instanceName?: string) => {
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
    };

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

            if (file.type.startsWith('image/')) mediatype = 'image';
            if (file.type.startsWith('video/')) {
                mediatype = 'video';
                thumbnail = await generateVideoThumbnail(file);
            }

            return {
                id: `${file.name}-${file.lastModified}`,
                file,
                name: file.name,
                type: file.type,
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

    const generateOptimisticId = () =>
        typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : Math.random().toString(36).slice(2);

    const handleFormSubmit = async () => {
        if (!chat) return;

        const currentMessageText = htmlToWhatsappMarkdown(newMessage);
        const currentMediaFiles = [...mediaFiles];
        const isTextOnly = currentMediaFiles.length === 0;

        if (isTextOnly && !currentMessageText.trim()) return;

        setNewMessage('');
        setMediaFiles([]);
        if (contentEditableRef.current) contentEditableRef.current.innerHTML = '';

        let optimisticId: string | null = null;
        if (isTextOnly) {
            const now = new Date();
            // Use UUID for text messages to ensure deduplication with real message
            optimisticId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `optimistic-${Date.now()}`;

            const optimisticMessage: Message = {
                id: optimisticId,
                chat_id: chat.id,
                workspace_id: chat.workspace_id,
                content: currentMessageText,
                type: 'text',
                status: 'default',
                metadata: {},
                transcription: null,
                timestamp: formatOptimisticTimestamp(now),
                createdAt: now.toISOString(),
                formattedDate: 'Hoje',
                sender: {
                    id: currentUser.id,
                    name: currentUser.name,
                    avatar: currentUser.avatar_url || currentUser.avatar,
                    type: 'user',
                },
                from_me: true,
                is_read: true,
                optimistic: true,
                sentByTab: tabId,
            };
            appendMessagesToChat(chat.id, [optimisticMessage]);
        } else {
            // Optimistic updates for media
            const now = new Date();
            const optimisticMediaMessages = currentMediaFiles.map(mf => {
                return {
                    id: `optimistic-${generateOptimisticId()}`,
                    chat_id: chat.id,
                    workspace_id: chat.workspace_id,
                    content: mf.name,
                    type: mf.mediatype,
                    status: 'default',
                    metadata: {
                        mediaUrl: `data:${mf.type};base64,${mf.base64}`,
                        mimetype: mf.type,
                        fileName: mf.name,
                        thumbnail: mf.thumbnail,
                        mediatype: mf.mediatype
                    },
                    transcription: null,
                    timestamp: formatOptimisticTimestamp(now),
                    createdAt: now.toISOString(),
                    formattedDate: 'Hoje',
                    sender: {
                        id: currentUser.id,
                        name: currentUser.name,
                        avatar: currentUser.avatar_url || currentUser.avatar,
                        type: 'user',
                    },
                    from_me: true,
                    is_read: true,
                    optimistic: true,
                    sentByTab: tabId,
                } as Message;
            });
            appendMessagesToChat(chat.id, optimisticMediaMessages);
        }

        try {
            let result: { success: boolean; error?: string };
            if (!isTextOnly) {
                // Upload files first to get a public URL
                const uploadedFiles = await Promise.all(currentMediaFiles.map(async (mf) => {
                    const extension = mf.name.split('.').pop() || 'dat';
                    const fileName = `${Date.now()}_${crypto.randomUUID()}.${extension}`;
                    const { publicUrl, error } = await uploadFileToStorage(mf.file, 'temp-media', fileName);

                    if (error || !publicUrl) {
                        toast({
                            title: `Erro ao enviar ${mf.name}`,
                            description: error || 'Falha no upload',
                            variant: 'destructive'
                        });
                        throw new Error(`Falha no upload de ${mf.name}`);
                    }

                    return {
                        base64: publicUrl, // We pass the URL in the base64 field as expectations downstream handle it as a source
                        mimetype: mf.type,
                        filename: mf.name,
                        mediatype: mf.mediatype,
                        thumbnail: mf.thumbnail,
                    };
                }));

                result = await sendMediaAction(chat.id, currentMessageText, uploadedFiles as any, tabId);
            } else if (isInternalNote) {
                result = await sendInternalNoteAction(chat.id, currentMessageText, tabId);
            } else {
                // Pass the optimisticId (UUID) to the action so the DB uses the same ID
                result = await sendAgentMessageAction(chat.id, currentMessageText, tabId, optimisticId || undefined);
            }

            if (result.error) {
                toast({ title: 'Erro ao Enviar', description: result.error, variant: 'destructive' });
                if (optimisticId) {
                    removeMessagesForChat(chat.id, (message) => message.id === optimisticId);
                }
            }
        } catch (error) {
            console.error("Error during message submission:", error);
            toast({ title: 'Erro Crítico', description: 'Ocorreu um erro inesperado ao enviar a mensagem.', variant: 'destructive' });
            if (optimisticId) {
                removeMessagesForChat(chat.id, (message) => message.id === optimisticId);
            }
        }
    };

    const handleSendAudio = async (audioBlob: Blob, duration: number, mimetype: string) => {
        if (!chat) return;

        // Upload to Supabase Storage
        const fileName = `audio_${Date.now()}.webm`;
        const { publicUrl, error: uploadError } = await uploadFileToStorage(audioBlob, 'temp-media', fileName);

        if (uploadError || !publicUrl) {
            toast({ title: 'Erro ao fazer upload do áudio', description: uploadError || 'Erro desconhecido', variant: 'destructive' });
            return;
        }

        const result = await sendMediaAction(chat.id, '', [{
            base64: publicUrl, // Passing URL instead of base64
            mimetype,
            filename: 'audio_gravado.mp3', // Keep this filename to trigger voice note handling
            mediatype: 'audio',
            thumbnail: undefined
        }], tabId);

        if (result.error) {
            toast({ title: 'Erro ao Enviar Áudio', description: result.error, variant: 'destructive' });
        }
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
        if (e.key === 'Enter' && !e.shiftKey) {
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
        const command = newMessage.substring(newMessage.lastIndexOf('/') + 1).toLowerCase();
        return shortcuts.filter(s => s.name.toLowerCase().startsWith(command));
    }, [newMessage, shortcuts, showShortcutSuggestions]);

    const handleMessageChange = (e: React.FormEvent<HTMLDivElement>) => {
        const text = e.currentTarget.innerHTML;
        setNewMessage(text);
        setShowShortcutSuggestions(text.includes('/'));
    };

    const handleShortcutSelect = (shortcut: Shortcut) => {
        if (contentEditableRef.current) {
            // Use innerText to ensure newlines are handled correctly as plain text
            contentEditableRef.current.innerText = shortcut.message;
            setNewMessage(contentEditableRef.current.innerHTML);
            setShowShortcutSuggestions(false);
        }
    };




    if (!chat) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center bg-transparent min-w-0 p-6">
                <div className="text-center space-y-4 p-8 rounded-3xl bg-black/20 border border-white/5 backdrop-blur-xl shadow-2xl">
                    <div className="h-20 w-20 bg-gradient-to-br from-blue-500/20 to-purple-500/20 rounded-full flex items-center justify-center mx-auto mb-4 ring-1 ring-white/10">
                        <MessageSquare className="h-10 w-10 text-blue-400" />
                    </div>
                    <h2 className="text-2xl font-bold text-white">Bem-vindo ao Dialogy</h2>
                    <p className="text-white/50 max-w-md">
                        Selecione uma conversa na lista ao lado para iniciar o atendimento ou visualizar o histórico.
                    </p>
                </div>
            </div>
        )
    }

    const isChatOpen = chat.status !== 'encerrados';
    const isChatAssignedToMe = (chat.agent?.id || chat.agentId) === currentUser.id;

    const showTextInput = !mediaFiles.length;

    const lastCustomerMessage = useMemo(() =>
        (chat.messages || []).slice().reverse().find(m => !m.from_me && m.type !== 'system')
        , [chat.messages]);


    return (
        <div className="flex-1 flex flex-col bg-transparent min-w-0 relative h-full">
            {/* Header */}
            <header className="flex h-16 items-center justify-between border-b border-white/10 bg-black/20 backdrop-blur-xl px-6 flex-shrink-0 z-20">
                <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10 border border-white/10 ring-2 ring-white/5">
                        <AvatarImage src={chat.contact.avatar_url} alt={chat.contact.name} data-ai-hint="person" />
                        <AvatarFallback className="bg-zinc-800 text-white">{chat.contact.name.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div>
                        <h2 className="font-semibold text-white flex items-center gap-2">
                            {chat.contact.name}
                            {chat.status === 'atendimentos' && (
                                <Badge variant="secondary" className="bg-green-500/20 text-green-400 border-green-500/20 text-[10px] px-1.5 h-5">
                                    Em atendimento
                                </Badge>
                            )}
                        </h2>
                        <p className="text-xs text-white/50 flex items-center gap-1">
                            {chat.instance_name && (
                                <span className="flex items-center gap-1">
                                    <FaWhatsapp className="h-3 w-3 text-green-500" />
                                    {chat.instance_name}
                                </span>
                            )}
                            <span className="mx-1">•</span>
                            <span>{chat.contact.phone}</span>
                            <span className="mx-1">•</span>
                            <span className="text-[10px] opacity-50">ID: {chat.id}</span>
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="text-white/50 hover:text-white hover:bg-white/10">
                                    <Phone className="h-4 w-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent><p>Ligar (Em breve)</p></TooltipContent>
                        </Tooltip>

                        <div className="w-px h-6 bg-white/10 mx-1" />

                        {isChatOpen && isChatAssignedToMe && (
                            <>
                                <CloseChatDialog
                                    chat={chat}
                                    onActionSuccess={onActionSuccess}
                                    reasons={closeReasons}
                                    isOpen={isCloseDialogOpen}
                                    onOpenChange={setIsCloseDialogOpen}
                                />
                            </>
                        )}

                        <div className="w-px h-6 bg-white/10 mx-1" />

                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="text-white/50 hover:text-white hover:bg-white/10"
                                    onClick={() => {
                                        onToggleContactPanel();
                                    }}
                                >
                                    <ArrowRightLeft className="h-4 w-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent><p>Alternar Painel Lateral</p></TooltipContent>
                        </Tooltip>

                        <div className="w-px h-6 bg-white/10 mx-1" />

                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="text-white/50 hover:text-white hover:bg-white/10"
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
                                    className="text-white/50 hover:text-purple-400 hover:bg-purple-500/10"
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
            </header>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto relative" >
                <ScrollArea className="h-full" ref={scrollAreaRef}>
                    <div className="space-y-1 p-6 pb-4">
                        {isLoadingOlderMessages && canLoadOlder && (
                            <div className="flex justify-center py-4 text-white/50 text-xs">
                                <Loader2 className="h-4 w-4 animate-spin" />
                            </div>
                        )}
                        {messagesToRender.map((message, index) => (
                            <MessageItem
                                key={message.id}
                                message={message}
                                prevMessage={messagesToRender[index - 1]}
                                workspaceTimezone={workspaceTimezone}
                                onDelete={handleDeleteMessage}
                                currentUserId={currentUser.id}
                                instanceName={chat.instance_name}
                                onForward={handleForwardMessage}
                            />
                        ))}
                    </div>
                </ScrollArea>

            </div>


            {isChatOpen ? (
                <footer className="p-4 bg-transparent z-20">
                    {showShortcutSuggestions && filteredShortcuts.length > 0 && (
                        <div className="mb-2 p-2 border border-white/10 rounded-xl bg-black/60 backdrop-blur-xl max-h-40 overflow-y-auto shadow-xl">
                            {filteredShortcuts.map(shortcut => (
                                <button
                                    key={shortcut.id}
                                    className="w-full text-left p-2 rounded-lg hover:bg-white/10 text-sm text-white transition-colors"
                                    onClick={() => handleShortcutSelect(shortcut)}
                                >
                                    <span className="font-bold text-blue-400">/{shortcut.name}</span>
                                    <span className="text-white/70 ml-2 truncate">{shortcut.message}</span>
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
                    <div className="space-y-4">
                        <form onSubmit={(e) => { e.preventDefault(); handleFormSubmit(); }} onKeyDown={handleKeyDown} className='flex items-end gap-2'>
                            <input type="hidden" name="chatId" value={chat.id} />

                            <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl p-2 shadow-2xl flex items-end gap-2 relative flex-1">
                                <div className="flex gap-1 pb-1">
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-white/50 hover:text-blue-400 hover:bg-blue-500/10 rounded-xl" disabled={isAiTyping}>
                                                <Smile className="h-5 w-5" />
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-auto p-0 border-none mb-2 bg-transparent shadow-none">
                                            <EmojiPicker onEmojiClick={onEmojiClick} theme={"dark" as any} />
                                        </PopoverContent>
                                    </Popover>

                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-9 w-9 text-white/50 hover:text-blue-400 hover:bg-blue-500/10 rounded-xl"
                                        disabled={isAiTyping}
                                        onClick={() => fileInputRef.current?.click()}
                                    >
                                        <Paperclip className="h-5 w-5" />
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className={cn(
                                            "h-9 w-9 rounded-xl transition-colors",
                                            isInternalNote
                                                ? "text-yellow-400 bg-yellow-500/10 hover:bg-yellow-500/20"
                                                : "text-white/50 hover:text-yellow-400 hover:bg-yellow-500/10"
                                        )}
                                        disabled={isAiTyping}
                                        onClick={() => setIsInternalNote(!isInternalNote)}
                                        title="Nota Interna (não enviada ao cliente)"
                                    >
                                        <StickyNote className="h-5 w-5" />
                                    </Button>

                                    <Popover open={isShortcutsOpen} onOpenChange={setIsShortcutsOpen}>
                                        <PopoverTrigger asChild>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="h-9 w-9 text-white/50 hover:text-blue-400 hover:bg-blue-500/10 rounded-xl"
                                                disabled={isAiTyping}
                                                title="Atalhos"
                                            >
                                                <MessageSquareQuote className="h-5 w-5" />
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-80 p-0 bg-black/90 border-white/10 backdrop-blur-xl text-white max-h-96 overflow-y-auto" align="start">
                                            <div className="p-2 space-y-1">
                                                <h4 className="text-xs font-medium text-white/50 px-2 py-1">Atalhos Disponíveis</h4>
                                                {shortcuts.length === 0 ? (
                                                    <p className="text-sm text-white/50 px-2 py-2">Nenhum atalho encontrado.</p>
                                                ) : (
                                                    shortcuts.map(shortcut => (
                                                        <button
                                                            key={shortcut.id}
                                                            className="w-full text-left p-2 rounded-lg hover:bg-white/10 text-sm text-white transition-colors flex flex-col gap-1 group"
                                                            onClick={() => {
                                                                handleShortcutSelect(shortcut);
                                                                setIsShortcutsOpen(false);
                                                            }}
                                                        >
                                                            <div className="flex items-center justify-between w-full">
                                                                <span className="font-bold text-blue-400 flex items-center gap-2">
                                                                    /{shortcut.name}
                                                                    {shortcut.type === 'global' && <Globe className="h-3 w-3 text-white/30" />}
                                                                    {shortcut.type === 'team' && <Users className="h-3 w-3 text-white/30" />}
                                                                    {shortcut.type === 'private' && <Lock className="h-3 w-3 text-white/30" />}
                                                                </span>
                                                            </div>
                                                            <span className="text-white/70 truncate w-full text-xs">{shortcut.message}</span>
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
                                            className="w-full bg-transparent border-0 focus:ring-0 p-0 text-white placeholder:text-white/30 resize-none max-h-[120px] min-h-[24px] focus:outline-none scrollbar-hide whitespace-pre-wrap overflow-y-auto"
                                            tagName="div"
                                            onKeyUp={saveCursorPosition}
                                            onClick={saveCursorPosition}
                                        />
                                    ) : null}
                                </div>

                                <div className="pb-1 pr-1">
                                    {newMessage.trim() === "" && mediaFiles.length === 0 ? (
                                        <AudioRecorder onSend={handleSendAudio} />
                                    ) : (
                                        <SendMessageButton disabled={isAiTyping} />
                                    )}
                                </div>
                            </div>
                        </form>

                        <div className="flex flex-wrap items-center gap-3 px-2">
                            <div className="flex items-center space-x-2 bg-black/20 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/5">
                                <Bot className="h-4 w-4 text-blue-400" />
                                <Switch
                                    id="ai-agent-switch"
                                    checked={isAiAgentActive}
                                    onCheckedChange={handleAiSwitchChange}
                                    disabled={isAiTyping || (!autopilotConfig && autopilotAgents.length === 0)}
                                    className="data-[state=checked]:bg-blue-600"
                                />
                                {autopilotAgents.length > 1 ? (
                                    <Select
                                        value={chat?.autopilot_config_id || autopilotConfig?.id || (autopilotAgents.find(a => a.is_primary)?.id)}
                                        onValueChange={handleAgentChange}
                                        disabled={!isAiAgentActive}
                                    >
                                        <SelectTrigger className="h-6 border-none bg-transparent text-xs font-medium text-white focus:ring-0 px-1 gap-1 w-auto min-w-[30px] outline-none shadow-none ring-0 focus:ring-offset-0">
                                            <SelectValue placeholder="Agente" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {autopilotAgents.map(agent => (
                                                <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                ) : (
                                    <Label htmlFor="ai-agent-switch" className="font-medium text-xs text-white cursor-pointer">Agente de IA</Label>
                                )}
                                {isAiTyping && <Loader2 className="h-3 w-3 animate-spin text-blue-400 ml-1" />}
                            </div>
                            {autopilotConfig && (
                                <span className="text-[10px] text-white/30">
                                    {(autopilotConfig.knowledge_base_documents?.length || 0)} docs · {autopilotRules.filter(rule => rule.enabled).length} regras ativas
                                </span>
                            )}
                            <Link href="/autopilot" className="text-[10px] font-medium text-blue-400 hover:text-blue-300 hover:underline ml-auto">
                                Treinar agente
                            </Link>
                        </div>
                    </div>
                </footer>
            ) : (
                <footer className="p-4 flex-shrink-0 text-center bg-black/20 backdrop-blur-xl border-t border-white/10">
                    <p className='text-sm font-medium text-white/50'>
                        Este atendimento foi encerrado.
                    </p>
                </footer>
            )}
        </div>
    );
}
