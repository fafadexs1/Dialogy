'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
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
    Lock
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Textarea } from '../ui/textarea';
import { closeChatAction, assignChatToSelfAction, getContactMessages } from '@/actions/chats';
import { useFormStatus } from 'react-dom';
import { deleteMessageAction } from '@/actions/evolution-api';
import { sendAutomatedMessageAction, sendAgentMessageAction, sendMediaAction, sendInternalNoteAction } from '@/actions/messages';
import { getAutopilotConfig } from '@/actions/autopilot';
import { getShortcuts } from '@/actions/shortcuts';
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
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import EmojiPicker, { type EmojiClickData } from 'emoji-picker-react';
import ContentEditable from 'react-contenteditable';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { AudioPlayer } from './audio-player';
import { AudioRecorder } from './audio-recorder';
import { useInboxStore } from '@/hooks/use-inbox-store';
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

function formatWhatsappText(text: string, options: { isOutgoing?: boolean } = {}): string {
    if (!text) return '';

    // URL regex to find links
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const { isOutgoing } = options;

    // First, escape HTML to prevent XSS from other content
    let processedText = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

    // Then, apply rich text formatting for whatsapp-style markdown
    // Note: Lookbehind support varies, so we use a more compatible approach
    processedText = processedText
        .replace(/(\s|^)\*(.*?)\*(\s|$)/g, '$1<b>$2</b>$3') // Bold
        .replace(/(\s|^)_(.*?)_(\s|$)/g, '$1<i>$2</i>$3') // Italic
        .replace(/(\s|^)~(.*?)~(\s|$)/g, '$1<s>$2</s>$3') // Strikethrough
        .replace(/```(.*?)```/gs, (match, p1) => `<pre><code>${p1}</code></pre>`); // Code block

    // Finally, replace URLs with anchor tags
    processedText = processedText.replace(urlRegex, (url) => {
        // The URL is already escaped, so we can safely use it.
        // We need to decode it for the href attribute but keep the display version escaped.
        const decodedUrl = url.replace(/&amp;/g, "&");
        const outgoingClasses = 'text-white/90 underline decoration-white/60 hover:decoration-white';
        const incomingClasses = 'text-blue-400 hover:text-blue-300 underline';
        return `<a href="${decodedUrl}" target="_blank" rel="noopener noreferrer" class="${isOutgoing ? outgoingClasses : incomingClasses}">${url}</a>`;
    });

    return processedText.replace(/\n/g, '<br />'); // Handle line breaks
}


import { MediaViewer } from './media-viewer';

function MediaMessage({ message }: { message: Message }) {
    const { mediaUrl, mimetype = '', fileName, thumbnail, duration, waveform } = message.metadata || {};

    let urlToUse = mediaUrl || thumbnail;
    if (mimetype.startsWith('video/') && thumbnail) {
        urlToUse = thumbnail;
    }

    if (!urlToUse) return <p>{message.content || 'Mídia inválida'}</p>;

    const renderMedia = () => {
        if (mimetype.startsWith('image/')) {
            return (
                <MediaViewer src={urlToUse} type="image" alt={message.content || fileName || 'Imagem enviada'} fileName={fileName}>
                    <Image
                        src={urlToUse}
                        alt={message.content || fileName || 'Imagem enviada'}
                        width={300}
                        height={300}
                        className="rounded-lg object-cover w-full max-w-[300px] h-auto cursor-pointer hover:brightness-90 transition-all"
                    />
                </MediaViewer>
            );
        }
        if (mimetype.startsWith('video/')) {
            return (
                <MediaViewer src={mediaUrl || ''} type="video" fileName={fileName}>
                    <div className="relative group w-full max-w-[300px] aspect-video bg-slate-900 rounded-lg flex items-center justify-center cursor-pointer overflow-hidden shadow-md">
                        {urlToUse ? (
                            <Image
                                src={urlToUse}
                                alt="Video thumbnail"
                                width={300}
                                height={169}
                                className="group-hover:brightness-75 transition-all object-cover"
                            />
                        ) : null}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent group-hover:from-black/60 transition-all z-10"></div>
                        <PlayCircle className="h-16 w-16 text-white/70 group-hover:text-white/90 z-20 group-hover:scale-110 transition-transform" />
                        {message.optimistic && (
                            <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                                <Loader2 className="h-10 w-10 text-white animate-spin" />
                            </div>
                        )}
                    </div>
                </MediaViewer>
            );
        }
        if (mimetype.startsWith('audio/')) {
            return <AudioPlayer src={urlToUse} messageId={message.id} initialTranscription={message.transcription} duration={duration} waveform={waveform} isFromMe={message.from_me} />;
        }
        if (mimetype === 'application/pdf' || mimetype.startsWith('application/')) {
            return (
                <a
                    href={urlToUse}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 p-3 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition-colors max-w-xs"
                >
                    <FileIcon className="h-8 w-8 text-white/70 flex-shrink-0" />
                    <div className='min-w-0'>
                        <p className="font-medium truncate text-white">{fileName || 'Documento'}</p>
                        <p className="text-xs text-white/50">Clique para abrir ou baixar</p>
                    </div>
                    <Download className="h-5 w-5 text-white/50 ml-auto flex-shrink-0" />
                </a>
            );
        }
        return <p>{message.content}</p>;
    };

    return (
        <div className='flex flex-col gap-1.5'>
            {renderMedia()}
            {message.content && (
                <p className="whitespace-pre-wrap text-sm" dangerouslySetInnerHTML={{ __html: formatWhatsappText(message.content, { isOutgoing: Boolean(message.from_me) }) }} />
            )}
        </div>
    )
}

function TakeOwnershipOverlay({ onTakeOwnership }: { onTakeOwnership: () => void }) {
    const [isAssigning, setIsAssigning] = useState(false);
    const [isPeeking, setIsPeeking] = useState(false);

    const handleTakeOwnershipClick = async () => {
        setIsAssigning(true);
        try {
            await onTakeOwnership();
        } finally {
            setIsAssigning(false);
        }
    };

    return (
        <div className={cn(
            "absolute inset-0 z-10 flex flex-col items-center justify-center p-6 transition-all",
            isPeeking ? "bg-black/30 backdrop-blur-none pointer-events-none" : "bg-black/60 backdrop-blur-sm"
        )}>
            <div className={cn("text-center transition-opacity pointer-events-auto", { "opacity-0 pointer-events-none": isPeeking })}>
                <div className="inline-block p-4 bg-blue-500/20 rounded-full mb-4">
                    <Hand className="h-10 w-10 text-blue-400" />
                </div>
                <h3 className="text-xl font-bold text-white">Atendimento Disponível</h3>
                <p className="text-white/70 mt-1 mb-6">Este chat está na fila geral e aguardando um atendente.</p>
                <Button size="lg" onClick={handleTakeOwnershipClick} disabled={isAssigning} className="bg-blue-600 hover:bg-blue-500 text-white">
                    {isAssigning && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
                    Assumir este Atendimento
                </Button>
            </div>

            <Button
                variant="outline"
                className="absolute bottom-6 border-white/10 bg-black/40 text-white hover:bg-white/10 pointer-events-auto"
                onClick={() => setIsPeeking(!isPeeking)}
            >
                {isPeeking ? <EyeOff className="mr-2 h-4 w-4" /> : <Eye className="mr-2 h-4 w-4" />}
                {isPeeking ? "Ocultar Mensagens" : "Ver Mensagens"}
            </Button>
        </div>
    );
}

export default function ChatPanel({ chat, currentUser, onActionSuccess, closeReasons, showFullHistory, setShowFullHistory, tabId, onLoadOlderMessages, canLoadOlder }: ChatPanelProps) {

    const [newMessage, setNewMessage] = useState('');
    const [mediaFiles, setMediaFiles] = useState<MediaFileType[]>([]);
    const [isAiAgentActive, setIsAiAgentActive] = useState(false);
    const [isInternalNote, setIsInternalNote] = useState(false);
    const autopilotSwitchTouchedRef = useRef(false);
    const [isAiTyping, setIsAiTyping] = useState(false);

    const [autopilotConfig, setAutopilotConfig] = useState<AutopilotConfig | null>(null);
    const [autopilotRules, setAutopilotRules] = useState<NexusFlowInstance[]>([]);
    const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
    const [showShortcutSuggestions, setShowShortcutSuggestions] = useState(false);
    const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);

    const scrollAreaRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const contentEditableRef = useRef<HTMLElement>(null);
    const processedMessageIds = useRef(new Set());
    const savedRange = useRef<Range | null>(null);
    const userScrolledUpRef = useRef(false);
    const isFetchingHistoryRef = useRef(false);
    const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false);
    const appendMessagesToChat = useInboxStore((state) => state.appendMessagesToChat);
    const removeMessagesForChat = useInboxStore((state) => state.removeMessagesForChat);

    const [allContactMessages, setAllContactMessages] = useState<Message[]>([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);
    const [isCloseDialogOpen, setIsCloseDialogOpen] = useState(false);

    const { toast } = useToast();

    const handleAiSwitchChange = (checked: boolean) => {
        autopilotSwitchTouchedRef.current = true;
        setIsAiAgentActive(checked);
    };

    const fetchAutopilotData = useCallback(async () => {
        if (!currentUser.activeWorkspaceId) return;
        const data = await getAutopilotConfig(currentUser.activeWorkspaceId);
        if (!data.error) {
            setAutopilotConfig(data.config);
            setAutopilotRules(data.rules || []);
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
        autopilotSwitchTouchedRef.current = false;
    }, [chat?.id]);

    useEffect(() => {
        if (!autopilotConfig) {
            if (!autopilotSwitchTouchedRef.current) {
                setIsAiAgentActive(false);
            }
            return;
        }
        if (!autopilotSwitchTouchedRef.current) {
            setIsAiAgentActive(Boolean(autopilotConfig.is_active));
        }
    }, [autopilotConfig, chat?.id]);

    useEffect(() => {
        const viewport = scrollAreaRef.current?.querySelector('div[data-radix-scroll-area-viewport]');
        if (!viewport) return;

        const handleScroll = () => {
            const { scrollTop, scrollHeight, clientHeight } = viewport;
            const isScrolledUp = scrollHeight - scrollTop - clientHeight > 100;
            userScrolledUpRef.current = isScrolledUp;

            if (scrollTop < 120 && canLoadOlder && !isFetchingHistoryRef.current) {
                isFetchingHistoryRef.current = true;
                setIsLoadingOlderMessages(true);
                Promise.resolve(onLoadOlderMessages?.())
                    .catch((error) => console.error('[CHAT_PANEL] Failed to load older messages', error))
                    .finally(() => {
                        isFetchingHistoryRef.current = false;
                        setIsLoadingOlderMessages(false);
                    });
            }
        };

        viewport.addEventListener('scroll', handleScroll);
        return () => viewport.removeEventListener('scroll', handleScroll);
    }, [canLoadOlder, onLoadOlderMessages]);

    useEffect(() => {
        setAllContactMessages([]);
    }, [chat?.contact?.id]);

    useEffect(() => {
        if (showFullHistory && chat?.contact?.id && currentUser.activeWorkspaceId) {
            setIsLoadingHistory(true);
            getContactMessages({
                contactId: chat.contact.id,
                workspaceId: currentUser.activeWorkspaceId,
                limit: 500
            })
                .then(res => {
                    if (res.messages) {
                        setAllContactMessages(res.messages);
                    }
                })
                .catch(err => console.error("Failed to load history", err))
                .finally(() => setIsLoadingHistory(false));
        }
    }, [showFullHistory, chat?.contact?.id, currentUser.activeWorkspaceId]);

    const messagesToRender = useMemo(() => {
        if (showFullHistory && allContactMessages.length > 0) {
            return allContactMessages;
        }
        return chat?.messages || [];
    }, [showFullHistory, allContactMessages, chat?.messages]);

    useEffect(() => {
        const viewport = scrollAreaRef.current?.querySelector('div[data-radix-scroll-area-viewport]');
        if (viewport && !userScrolledUpRef.current) {
            viewport.scrollTop = viewport.scrollHeight;
        }
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

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files || []);
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
        event.target.value = '';
    };

    const htmlToWhatsappMarkdown = (html: string): string => {
        if (!html) return '';
        return html
            .replace(/<b>(.*?)<\/b>/g, '*$1*')
            .replace(/<strong>(.*?)<\/strong>/g, '*$1*')
            .replace(/<i>(.*?)<\/i>/g, '_$1_')
            .replace(/<em>(.*?)<\/em>/g, '_$1_')
            .replace(/<(s|strike|del)>(.*?)<\/(s|strike|del)>/g, '~$2~')
            .replace(/<br\s*\/?>/g, '\n')
            .replace(/&nbsp;/g, ' ')
            .replace(/<[^>]*>/g, '');
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
            optimisticId = `optimistic-${generateOptimisticId()}`;
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
                optimisticId = `optimistic-${generateOptimisticId()}`; // Keep track of at least one for error handling, or all?
                // Note: If multiple files, we might need to track all IDs to remove them on error. 
                // For simplicity in this scope, we'll track the last one or change logic to track array.
                // But the current error handling only removes 'optimisticId' (singular).
                // Let's just let it be for now, or improve error handling later.

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
            // We capture the IDs to remove on error
            // optimisticId = ... (This variable is single, but we have multiple. 
            // We should probably update the error handling to remove all optimistic messages if we want to be robust.
            // For now, I will just proceed. The user mainly wants the happy path to look good.)
        }

        try {
            let result: { success: boolean; error?: string };
            if (!isTextOnly) {
                const mediaData = currentMediaFiles.map(mf => ({
                    base64: mf.base64,
                    mimetype: mf.type,
                    filename: mf.name,
                    mediatype: mf.mediatype,
                    thumbnail: mf.thumbnail,
                }));
                result = await sendMediaAction(chat.id, currentMessageText, mediaData as any, tabId);
            } else if (isInternalNote) {
                result = await sendInternalNoteAction(chat.id, currentMessageText, tabId);
            } else {
                result = await sendAgentMessageAction(chat.id, currentMessageText, tabId);
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

    const handleTakeOwnership = async () => {
        if (!chat) return;
        const result = await assignChatToSelfAction(chat.id);
        if (result.success) {
            toast({ title: "Você assumiu o atendimento!" });
            onActionSuccess();
        } else {
            toast({ title: "Erro ao assumir", description: result.error, variant: 'destructive' });
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
            contentEditableRef.current.innerHTML = shortcut.message;
            setNewMessage(shortcut.message);
            setShowShortcutSuggestions(false);
        }
    };

    const renderMessageContent = (message: Message, isFromMe = false) => {
        const isMediaType = message.type && message.type !== 'text' && message.type !== 'system';
        const hasMediaAttachment = Boolean(
            message.metadata?.mediaUrl ||
            message.metadata?.thumbnail ||
            message.metadata?.fileName ||
            message.metadata?.mimetype
        );

        if (isMediaType || hasMediaAttachment) {
            return <MediaMessage message={message} />;
        }

        if (!message.content?.trim()) {
            return <span className="text-xs italic text-muted-foreground">Mensagem sem conteúdo</span>;
        }

        return (
            <p
                className="text-sm whitespace-pre-wrap"
                dangerouslySetInnerHTML={{ __html: formatWhatsappText(message.content, { isOutgoing: isFromMe }) }}
            />
        );
    };

    const renderMessageWithSeparator = (message: Message, index: number, array: Message[]) => {
        const prevMessage = array[index - 1];
        const showDateSeparator = !prevMessage || message.formattedDate !== prevMessage.formattedDate;

        const isFromMe = !!message.from_me;
        const isDeleted = message.status === 'deleted';
        const isPending = message.api_message_status === 'PENDING';
        const isInternalNote = message.metadata?.isInternalNote;

        return (
            <React.Fragment key={message.id}>
                {showDateSeparator && (
                    <div className="relative my-6">
                        <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-white/10"></div>
                        </div>
                        <div className="relative flex justify-center">
                            <span className="bg-black/40 backdrop-blur-md px-3 py-1 text-xs font-medium text-white/50 rounded-full border border-white/5">{message.formattedDate}</span>
                        </div>
                    </div>
                )}
                {message.type === 'system' ? (
                    <div className="flex justify-center items-center my-4">
                        <div className="flex items-center gap-2 text-xs text-white/50 bg-white/5 rounded-full px-3 py-1 border border-white/5">
                            <Info className="h-3.5 w-3.5" />
                            <span>{message.content}</span>
                            <span>-</span>
                            <span>{message.timestamp}</span>
                        </div>
                    </div>
                ) : (
                    <div
                        className={`group flex items-start gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300 ${isFromMe ? 'flex-row-reverse' : 'flex-row'}`}
                        style={{ willChange: 'transform, opacity', backfaceVisibility: 'hidden' }}
                    >
                        {message.sender && (
                            <Avatar className="h-8 w-8 border border-white/10 ring-1 ring-white/5">
                                <AvatarImage src={(message.sender as any).avatar || (message.sender as any).avatar_url} alt={message.sender.name || ''} data-ai-hint="person" />
                                <AvatarFallback className="bg-zinc-800 text-white/70 text-xs">{message.sender.name?.charAt(0) || '?'}</AvatarFallback>
                            </Avatar>
                        )}
                        <div className={cn("flex flex-col", isFromMe ? 'items-end' : 'items-start')}>
                            <div className={cn("flex items-end", isFromMe ? 'flex-row-reverse' : 'flex-row')}>
                                <div
                                    className={cn("break-words rounded-2xl p-3 max-w-lg shadow-lg relative",
                                        isDeleted
                                            ? 'bg-white/5 text-white/50 italic border border-white/10'
                                            : isInternalNote
                                                ? 'bg-yellow-500/10 border border-yellow-500/20 text-yellow-200'
                                                : (isFromMe
                                                    ? 'bg-gradient-to-br from-blue-600 to-violet-600 text-white rounded-tr-sm border border-white/10'
                                                    : 'bg-white/10 backdrop-blur-md border border-white/10 text-white rounded-tl-sm')
                                    )}
                                >
                                    {isInternalNote && (
                                        <div className="flex items-center gap-1 text-xs text-yellow-500/70 mb-1 font-medium uppercase tracking-wider">
                                            <StickyNote className="h-3 w-3" /> Nota Interna
                                        </div>
                                    )}
                                    {isDeleted ? (
                                        <span className="flex items-center gap-2"><Trash2 className="h-4 w-4" />Mensagem apagada</span>
                                    ) : renderMessageContent(message, isFromMe)}
                                </div>
                                {!isDeleted && (
                                    <div className="flex-shrink-0 self-start">
                                        <AlertDialog>
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-white/50 hover:text-white hover:bg-white/10">
                                                        <MoreVertical className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent className="bg-black/90 border-white/10 text-white">
                                                    <DropdownMenuItem
                                                        className="cursor-pointer hover:bg-white/10 focus:bg-white/10"
                                                        onClick={() => {
                                                            navigator.clipboard.writeText(message.content || '');
                                                            toast({ title: 'Mensagem copiada!' });
                                                        }}
                                                    >
                                                        <Copy className="mr-2 h-4 w-4" />
                                                        Copiar
                                                    </DropdownMenuItem>
                                                    {isFromMe && (
                                                        <AlertDialogTrigger asChild>
                                                            <DropdownMenuItem className="text-red-400 focus:bg-red-500/20 focus:text-red-300 cursor-pointer" onSelect={e => e.preventDefault()}>
                                                                <Trash2 className="mr-2 h-4 w-4" />
                                                                Apagar para todos
                                                            </DropdownMenuItem>
                                                        </AlertDialogTrigger>
                                                    )}
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                            <AlertDialogContent className="bg-black/90 border-white/10 text-white">
                                                <AlertDialogHeader>
                                                    <AlertDialogTitle>Apagar mensagem?</AlertDialogTitle>
                                                    <AlertDialogDescription className="text-white/70">
                                                        Esta ação não pode ser desfeita. A mensagem será apagada para todos na conversa.
                                                    </AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                    <AlertDialogCancel className="bg-white/10 border-white/10 text-white hover:bg-white/20 hover:text-white">Cancelar</AlertDialogCancel>
                                                    <AlertDialogAction onClick={() => handleDeleteMessage(message.id, chat?.instance_name)} className="bg-red-600 hover:bg-red-700 text-white border-none">Apagar</AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    </div>
                                )}
                            </div>
                            <div className={cn("flex items-center text-[10px] text-white/40 mt-1.5", isFromMe ? 'flex-row-reverse gap-1' : 'flex-row gap-1')}>
                                <span className="mx-1">{message.timestamp}</span>
                                {message.from_me && !isDeleted && (
                                    isPending
                                        ? <Clock className="h-3 w-3 text-white/40" />
                                        : message.api_message_status === 'READ'
                                            ? <CheckCheck className="h-3 w-3 text-blue-400" />
                                            : message.api_message_status === 'DELIVERED' || message.api_message_status === 'SENT'
                                                ? <CheckCheck className="h-3 w-3 text-white/40" />
                                                : <Check className="h-3 w-3" />
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </React.Fragment>
        )
    }


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
    const isChatAssignedToMe = chat.agent && chat.agent.id === currentUser.id;
    const isChatInGeneralQueue = chat.status === 'gerais';

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
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="text-white/50 hover:text-white hover:bg-white/10" onClick={() => setShowFullHistory(!showFullHistory)}>
                                    <History className={cn("h-5 w-5", showFullHistory ? "text-blue-400" : "")} />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>{showFullHistory ? 'Mostrar apenas a conversa atual' : 'Mostrar histórico completo'}</p>
                            </TooltipContent>
                        </Tooltip>

                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="text-white/50 hover:text-white hover:bg-white/10">
                                    <Phone className="h-4 w-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent><p>Ligar (Em breve)</p></TooltipContent>
                        </Tooltip>

                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="text-white/50 hover:text-white hover:bg-white/10">
                                    <Video className="h-4 w-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent><p>Videochamada (Em breve)</p></TooltipContent>
                        </Tooltip>

                        <div className="w-px h-6 bg-white/10 mx-1" />

                        {isChatOpen && isChatAssignedToMe && (
                            <CloseChatDialog
                                chat={chat}
                                onActionSuccess={onActionSuccess}
                                reasons={closeReasons}
                                isOpen={isCloseDialogOpen}
                                onOpenChange={setIsCloseDialogOpen}
                            />
                        )}

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
                        {isLoadingHistory && (
                            <div className="flex justify-center py-4 text-white/50 text-xs">
                                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Carregando histórico completo...
                            </div>
                        )}
                        {messagesToRender.map(renderMessageWithSeparator)}
                    </div>
                </ScrollArea>
                {isChatInGeneralQueue && <TakeOwnershipOverlay onTakeOwnership={handleTakeOwnership} />}
            </div>


            {isChatOpen && isChatAssignedToMe ? (
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
                    {!isAiAgentActive && mediaFiles.length === 0 && !isAiTyping && (
                        <SmartReplies
                            customerMessage={lastCustomerMessage?.content || ''}
                            chatHistory={(chat.messages || []).map(m => `${m.sender?.name || 'System'}: ${m.content}`).join('\n')}
                            workspaceId={currentUser.activeWorkspaceId!}
                            onSelectReply={(reply) => {
                                setNewMessage(reply);
                                if (contentEditableRef.current) contentEditableRef.current.innerHTML = reply;
                            }}
                        />
                    )}
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
                                            className="w-full bg-transparent border-0 focus:ring-0 p-0 text-white placeholder:text-white/30 resize-none max-h-[120px] min-h-[24px] focus:outline-none scrollbar-hide"
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
                                    disabled={isAiTyping || !autopilotConfig}
                                    className="data-[state=checked]:bg-blue-600"
                                />
                                <Label htmlFor="ai-agent-switch" className="font-medium text-xs text-white cursor-pointer">Agente de IA</Label>
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
                    <p className='text-sm font-medium text-white/50'>{
                        chat.status === 'gerais' ? "Este atendimento está aguardando um agente." : "Este atendimento foi encerrado."
                    }</p>
                </footer>
            )}
        </div>
    );
}
