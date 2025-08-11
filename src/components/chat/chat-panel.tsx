
'use client';

import React, { useActionState, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Paperclip, Send, Smile, MoreVertical, Bot, Loader2, MessageSquare, LogOut, FileDown, Info, Check, CheckCheck, Trash2, File, PlayCircle, Mic, Download, Bold, Italic, Strikethrough, Code } from 'lucide-react';
import { type Chat, type Message, type User, Tag, MessageMetadata } from '@/lib/types';
import { nexusFlowInstances } from '@/lib/mock-data';
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
import { closeChatAction } from '@/actions/chats';
import { useFormStatus } from 'react-dom';
import { markMessagesAsReadAction, deleteMessageAction } from '@/actions/evolution-api';
import { sendAgentMessageAction, sendAutomatedMessageAction } from '@/actions/messages';
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


interface ChatPanelProps {
  chat: Chat | null;
  messages: Message[];
  currentUser: User;
  onActionSuccess: () => void;
  closeReasons: Tag[];
}

function CloseChatButton() {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" variant="destructive" disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Encerrar Atendimento
        </Button>
    )
}

function SendMessageButton({ disabled }: { disabled?: boolean }) {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" size="sm" className='h-8' disabled={pending || disabled}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
    )
}

function CloseChatDialog({ chat, onActionSuccess, reasons }: { chat: Chat, onActionSuccess: () => void, reasons: Tag[] }) {
    const [state, formAction] = useActionState(closeChatAction, { success: false });
    const [isOpen, setIsOpen] = React.useState(false);
    const { toast } = useToast();

    React.useEffect(() => {
        if(state.success) {
            toast({ title: "Atendimento encerrado com sucesso!"});
            setIsOpen(false);
            onActionSuccess();
        } else if (state.error) {
            toast({ title: "Erro ao encerrar", description: state.error, variant: 'destructive'});
        }
    }, [state, toast, onActionSuccess]);

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button variant="outline">
                    <LogOut className="mr-2 h-4 w-4" /> Encerrar Atendimento
                </Button>
            </DialogTrigger>
            <DialogContent>
                <form action={formAction}>
                    <input type="hidden" name="chatId" value={chat.id} />
                    <DialogHeader>
                        <DialogTitle>Encerrar Atendimento</DialogTitle>
                        <DialogDescription>
                            Selecione um motivo e adicione uma nota final para encerrar esta conversa.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="close-reason">Motivo do Encerramento</Label>
                             <Select name="reasonTagId">
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
                            <Textarea id="close-notes" name="notes" placeholder="Adicione uma observação sobre o encerramento..." />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="ghost" onClick={() => setIsOpen(false)}>Cancelar</Button>
                        <CloseChatButton />
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

function formatWhatsappText(text: string): string {
    if (!text) return '';
    // Escape HTML to prevent XSS, except for our allowed tags
    const escapeHtml = (unsafe: string) => {
        return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
    }

    // First, handle code blocks to prevent inner formatting
    let safeText = text.replace(/```(.*?)```/gs, (match, p1) => `<pre><code>${'\'\'\''}${escapeHtml(p1)}${'\'\'\''}</code></pre>`);

    // Then, format other elements, avoiding what's inside <code>
    safeText = safeText
        .replace(/(?<!<code>)\*(.*?)\*(?!<\/code>)/g, '<b>$1</b>')         // Bold
        .replace(/(?<!<code>)_(.*?)_(?!<\/code>)/g, '<i>$1</i>')         // Italic
        .replace(/(?<!<code>)~(.*?)~(?!<\/code>)/g, '<s>$1</s>')         // Strikethrough
        .replace(/(?<!<pre><code>)`(.*?)`(?!<\/code><\/pre>)/g, '<code>$1</code>');      // Inline code

    return safeText.replace(/\n/g, '<br />'); // Handle newlines
}

function MediaMessage({ message }: { message: Message }) {
    const { mediaUrl, mimetype = '', fileName, thumbnail } = message.metadata || {};

    if (!mediaUrl && !thumbnail) return <p>{message.content || 'Mídia inválida'}</p>;
    
    const renderMedia = () => {
        if (mimetype.startsWith('image/')) {
            return (
                 <Dialog>
                    <DialogTrigger asChild>
                        <Image
                            src={mediaUrl!}
                            alt={message.content || fileName || 'Imagem enviada'}
                            width={300}
                            height={300}
                            className="rounded-lg object-cover w-[300px] h-[300px] cursor-pointer hover:brightness-90 transition-all"
                        />
                    </DialogTrigger>
                    <DialogContent className="max-w-4xl p-2 bg-transparent border-none">
                       <DialogHeader>
                            <DialogTitle className="sr-only">Visualização de Imagem</DialogTitle>
                            <DialogDescription className="sr-only">Visualizando a imagem enviada no chat em tamanho maior.</DialogDescription>
                        </DialogHeader>
                        <Image
                            src={mediaUrl!}
                            alt={message.content || fileName || 'Imagem enviada'}
                            width={1024}
                            height={768}
                            className="rounded-lg object-contain w-full h-auto max-h-[80vh]"
                        />
                    </DialogContent>
                </Dialog>
            );
        }
        if (mimetype.startsWith('video/')) {
             return (
                <Dialog>
                    <DialogTrigger asChild>
                         <div className="relative group w-[300px] h-[300px] bg-slate-900 rounded-lg flex items-center justify-center cursor-pointer overflow-hidden shadow-md">
                            {thumbnail ? (
                                <Image
                                    src={thumbnail}
                                    alt="Video thumbnail"
                                    fill
                                    objectFit="cover"
                                    className="group-hover:brightness-75 transition-all"
                                />
                            ) : null}
                            <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent group-hover:from-black/60 transition-all z-10"></div>
                            <PlayCircle className="h-16 w-16 text-white/70 group-hover:text-white/90 z-20 group-hover:scale-110 transition-transform" />
                        </div>
                    </DialogTrigger>
                    <DialogContent className="max-w-4xl p-0 bg-black/50 border-none">
                         <DialogHeader>
                            <DialogTitle className="sr-only">Player de Vídeo</DialogTitle>
                            <DialogDescription className="sr-only">Reproduzindo o vídeo enviado no chat.</DialogDescription>
                        </DialogHeader>
                        <video controls autoPlay className="rounded-lg w-full h-auto max-h-[80vh]">
                            <source src={mediaUrl} type={mimetype} />
                            Seu navegador não suporta a tag de vídeo.
                        </video>
                    </DialogContent>
                </Dialog>
            );
        }
        if (mimetype.startsWith('audio/')) {
            return <audio controls src={mediaUrl} className="w-full max-w-xs" />;
        }
        if (mimetype === 'application/pdf' || mimetype.startsWith('application/')) {
            return (
                <a
                    href={mediaUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 p-3 rounded-lg border bg-secondary/50 hover:bg-secondary transition-colors max-w-xs"
                >
                    <File className="h-8 w-8 text-muted-foreground flex-shrink-0" />
                    <div className='min-w-0'>
                        <p className="font-medium truncate">{fileName || 'Documento'}</p>
                        <p className="text-xs text-muted-foreground">Clique para abrir ou baixar</p>
                    </div>
                    <Download className="h-5 w-5 text-muted-foreground ml-auto flex-shrink-0"/>
                </a>
            );
        }
        return <p>{message.content}</p>;
    };
    
    return (
        <div className='flex flex-col gap-1.5'>
            {renderMedia()}
            {message.content && (
                <p className="whitespace-pre-wrap text-sm" dangerouslySetInnerHTML={{ __html: formatWhatsappText(message.content) }} />
            )}
        </div>
    )
}

function FormattingToolbar() {
    const applyFormat = (format: 'bold' | 'italic' | 'strikethrough' | 'createLink') => {
        if (format === 'createLink') {
            const url = prompt("Enter the URL");
            if (url) {
                document.execCommand(format, false, url);
            }
        } else {
            document.execCommand(format, false, undefined);
        }
    };

    return (
        <div className="flex items-center gap-1 p-1 rounded-t-md border-b bg-muted/50">
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onMouseDown={e => { e.preventDefault(); applyFormat('bold'); }}><Bold className="h-4 w-4" /></Button>
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onMouseDown={e => { e.preventDefault(); applyFormat('italic'); }}><Italic className="h-4 w-4" /></Button>
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onMouseDown={e => { e.preventDefault(); applyFormat('strikethrough'); }}><Strikethrough className="h-4 w-4" /></Button>
        </div>
    )
}


export default function ChatPanel({ chat, messages: initialMessages, currentUser, onActionSuccess, closeReasons }: ChatPanelProps) {
  const [newMessage, setNewMessage] = useState('');
  const [mediaFiles, setMediaFiles] = useState<MediaFileType[]>([]);
  const [isAiAgentActive, setIsAiAgentActive] = useState(false);
  const [isAiTyping, setIsAiTyping] = useState(false);
  const [selectedAiModel, setSelectedAiModel] = useState('googleai/gemini-2.0-flash');
  
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const contentEditableRef = useRef<HTMLElement>(null);
  const processedMessageIds = useRef(new Set());
  
  const { toast } = useToast();
  
  const handleAiSwitchChange = (checked: boolean) => {
    console.log(`[AUTOPILOT] Piloto Automático ${checked ? 'ativado' : 'desativado'}.`);
    setIsAiAgentActive(checked);
  };

  useEffect(() => {
    if (scrollAreaRef.current) {
        const viewport = scrollAreaRef.current.querySelector('div[data-radix-scroll-area-viewport]');
        if (viewport) {
            viewport.scrollTop = viewport.scrollHeight;
        }
    }
  }, [initialMessages]);

  const lastMessage = initialMessages.length > 0 ? initialMessages[initialMessages.length - 1] : null;

  const handleSendMessage = async (content: string) => {
    if (!chat) return;

    if (mediaFiles.length > 0) {
        const mediaData = mediaFiles.map(mf => ({
            base64: mf.base64,
            mimetype: mf.type,
            filename: mf.name,
            mediatype: mf.mediatype,
            thumbnail: mf.thumbnail,
        }));
        const result = await sendMediaAction(chat.id, content, mediaData);
         if (result.success) {
            onActionSuccess();
        } else {
            toast({ title: 'Erro ao Enviar Mídia', description: result.error, variant: 'destructive' });
        }
    } else {
        if (!content.trim()) return;
        const result = await sendAgentMessageAction(chat.id, content);
        if (result.success) {
            onActionSuccess();
        } else {
            toast({ title: 'Erro ao Enviar Mensagem', description: result.error, variant: 'destructive' });
        }
    }

    setMediaFiles([]);
    setNewMessage('');
    if (contentEditableRef.current) contentEditableRef.current.innerHTML = '';
};

 const runAiAgent = async () => {
    if (!isAiAgentActive || !chat || !lastMessage || !chat.agent || lastMessage.sender?.id === currentUser.id || isAiTyping) {
        return;
    }

    try {
        setIsAiTyping(true);
        console.log('[AUTOPILOT] Verifying message:', lastMessage.content);
        const chatHistoryForAI = initialMessages.map(m => `${m.sender?.name || 'System'}: ${m.content}`).join('\n');
        const activeRules = nexusFlowInstances.filter(rule => rule.enabled);

        const result = await generateAgentResponse({
            customerMessage: lastMessage.content,
            chatHistory: chatHistoryForAI,
            rules: activeRules,
            knowledgeBase: "", 
            model: selectedAiModel,
        });

        console.log('[AUTOPILOT] AI Response received:', result);
        
        if (result && result.response) {
            const textToType = result.response;
            console.log('[AUTOPILOT] AI generated response text:', textToType);
            
            for (let i = 0; i <= textToType.length; i++) {
                await new Promise(resolve => setTimeout(resolve, 50));
                if(contentEditableRef.current) {
                    contentEditableRef.current.innerHTML = textToType.substring(0, i);
                    setNewMessage(textToType.substring(0, i));
                }
            }

            await new Promise(resolve => setTimeout(resolve, 500));
            console.log('[AUTOPILOT] Sending automated message...');
            const sendResult = await sendAutomatedMessageAction(chat.id, textToType, chat.agent.id);

            if (sendResult.success) {
                onActionSuccess();
            } else {
                toast({ title: 'Erro do Piloto Automático', description: sendResult.error, variant: 'destructive' });
            }
             setNewMessage('');
            if (contentEditableRef.current) contentEditableRef.current.innerHTML = '';
        }
    } catch (error: any) {
         console.error('Error generating AI agent response:', error);
         toast({
            title: 'Erro do Piloto Automático',
            description: error.message || 'Não foi possível gerar la resposta automática.',
            variant: 'destructive',
        });
    } finally {
        setIsAiTyping(false);
    }
  };


  useEffect(() => {
    if (isAiAgentActive && lastMessage && lastMessage.sender?.id !== currentUser.id) {
      runAiAgent();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMessage?.id, isAiAgentActive, chat?.id]);
  
  // Mark messages as read effect
  useEffect(() => {
    if (!chat || !chat.contact.phone_number_jid || !chat.instance_name) return;

    const unreadMessages = initialMessages.filter(m => 
        m.sender?.id === chat.contact.id && 
        m.api_message_status !== 'READ' && 
        m.message_id_from_api &&
        !processedMessageIds.current.has(m.id) // Check if not already processed
    );
      
    if (unreadMessages.length > 0) {
        const messagesToMark = unreadMessages.map(m => ({
            remoteJid: chat.contact.phone_number_jid!,
            fromMe: false,
            id: m.message_id_from_api!
        }));
          
        markMessagesAsReadAction(chat.instance_name, messagesToMark);

        unreadMessages.forEach(m => processedMessageIds.current.add(m.id));
    }
  }, [initialMessages, chat]);

  useEffect(() => {
    processedMessageIds.current.clear();
    setIsAiTyping(false);
  }, [chat?.id]);
  
  const handleDeleteMessage = async (messageId: string, instanceName?: string) => {
    if (!instanceName) {
        toast({ title: "Erro", description: "Não foi possível determinar a instância da mensagem.", variant: "destructive"});
        return;
    }
    const result = await deleteMessageAction(messageId, instanceName);
    if(result.error) {
      toast({ title: "Erro ao apagar mensagem", description: result.error, variant: "destructive"});
    } else {
      toast({ title: "Mensagem apagada com sucesso!"});
      onActionSuccess();
    }
  }

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
        }
        
        video.src = URL.createObjectURL(file);
    });
};

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

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
            id: `${'\'\'\''}${file.name}-${file.lastModified}${'\'\'\''}`,
            file: file,
            name: file.name,
            type: file.type,
            mediatype: mediatype,
            base64: base64,
            thumbnail: thumbnail,
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
          .replace(/<i>(.*?)<\/i>/g, '_$1_')
          .replace(/<s>(.*?)<\/s>/g, '~$1~')
          .replace(/<strike>(.*?)<\/strike>/g, '~$1~')
          .replace(/<br>/g, '\n')
          .replace(/&nbsp;/g, ' ')
          .replace(/<[^>]*>/g, '');
  };


  const handleFormSubmit = async (formData: FormData) => {
    const plainTextContent = htmlToWhatsappMarkdown(newMessage);
    handleSendMessage(plainTextContent);
  };

  const renderMessageContent = (message: Message) => {
    const isMedia = message.metadata?.mediaUrl || message.metadata?.thumbnail;
    if (isMedia) {
        return <MediaMessage message={message} />;
    }
    return <p className="whitespace-pre-wrap text-sm" dangerouslySetInnerHTML={{ __html: formatWhatsappText(message.content) }} />;
  };
  
    const onEmojiClick = (emojiData: EmojiClickData) => {
        const editableDiv = contentEditableRef.current;
        if (!editableDiv) return;

        editableDiv.focus();
        document.execCommand('insertText', false, emojiData.emoji);
    };


  const renderMessageWithSeparator = (message: Message, index: number) => {
    const prevMessage = initialMessages[index - 1];
    const showDateSeparator = !prevMessage || message.formattedDate !== prevMessage.formattedDate;

    const isFromMe = message.sender?.id === currentUser?.id;
    const isDeleted = message.status === 'deleted';

    return (
        <React.Fragment key={message.id}>
            {showDateSeparator && (
                <div className="relative my-6">
                    <Separator />
                    <div className="absolute left-1/2 -translate-x-1/2 -top-3 bg-muted/20 px-2">
                        <span className="text-xs font-medium text-muted-foreground">{message.formattedDate}</span>
                    </div>
                </div>
            )}
             {message.type === 'system' ? (
                <div className="flex justify-center items-center my-4">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground bg-secondary/70 rounded-full px-3 py-1">
                        <Info className="h-3.5 w-3.5" />
                        <span>{message.content}</span>
                        <span>-</span>
                        <span>{message.timestamp}</span>
                    </div>
                </div>
            ) : (
             <div className={`group flex items-start gap-3 animate-in fade-in ${isFromMe ? 'flex-row-reverse' : 'flex-row'}`}>
                {message.sender && (
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={message.sender.avatar} alt={message.sender.name || ''} data-ai-hint="person" />
                      <AvatarFallback>{message.sender.name?.charAt(0) || '?'}</AvatarFallback>
                    </Avatar>
                )}
                <div className={cn("flex flex-col", isFromMe ? 'items-end' : 'items-start')}>
                     <div className={cn("flex items-end", isFromMe ? 'flex-row-reverse' : 'flex-row')}>
                         <div
                            className={cn("break-words rounded-xl shadow-md p-3 max-w-lg",
                                isDeleted 
                                    ? 'bg-secondary/50 border'
                                    : (isFromMe 
                                        ? 'bg-primary text-primary-foreground' 
                                        : 'bg-card')
                            )}
                        >
                            {isDeleted ? (
                                <p className="whitespace-pre-wrap italic text-sm text-muted-foreground">🗑️ Mensagem apagada</p>
                            ) : renderMessageContent(message)}
                        </div>
                         {isFromMe && !isDeleted && (
                            <div className="flex-shrink-0 self-start">
                                <AlertDialog>
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <MoreVertical className="h-4 w-4" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent>
                                            <AlertDialogTrigger asChild>
                                                <DropdownMenuItem className="text-destructive" onSelect={e => e.preventDefault()}>
                                                    <Trash2 className="mr-2 h-4 w-4" />
                                                    Apagar para todos
                                                </DropdownMenuItem>
                                            </AlertDialogTrigger>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Apagar mensagem?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                Esta ação não pode ser desfeita. A mensagem será apagada para todos na conversa.
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                            <AlertDialogAction onClick={() => handleDeleteMessage(message.id, chat?.instance_name)}>Apagar</AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </div>
                        )}
                    </div>
                    <div className={cn("flex items-center text-xs text-muted-foreground mt-1", isFromMe ? 'flex-row-reverse gap-1' : 'flex-row gap-1')}>
                        <span className="mx-1">{message.timestamp}</span>
                        {message.from_me && !isDeleted && (
                            message.api_message_status === 'READ'
                            ? <CheckCheck className="h-4 w-4 text-sky-400" />
                            : message.api_message_status === 'DELIVERED' || message.api_message_status === 'SENT'
                            ? <CheckCheck className="h-4 w-4" />
                            : <Check className="h-4 w-4" />
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
        <main className="flex-1 flex flex-col items-center justify-center bg-muted/20 min-w-0 p-6">
            <div className="text-center">
                <MessageSquare className="h-16 w-16 mx-auto text-muted-foreground/50 mb-4" />
                <h2 className="text-2xl font-semibold">Selecione uma conversa</h2>
                <p className="mt-1 text-muted-foreground">Escolha uma conversa da lista para ver as mensagens aqui.</p>
            </div>
        </main>
    )
  }

  const isChatOpen = chat.status !== 'encerrados';

  return (
    <main className="flex-1 flex flex-col bg-muted/20 min-w-0">
      <header className="flex h-16 items-center justify-between border-b bg-card px-6 flex-shrink-0">
        <div className="flex items-center gap-3">
          <Avatar className="h-9 w-9 border">
            <AvatarImage src={chat.contact.avatar} alt={chat.contact.name} data-ai-hint="person" />
            <AvatarFallback>{chat.contact.name.charAt(0)}</AvatarFallback>
          </Avatar>
          <h2 className="font-semibold">{chat.contact.name}</h2>
        </div>
        <div className="flex items-center gap-2">
          {isChatOpen && (
            <CloseChatDialog chat={chat} onActionSuccess={onActionSuccess} reasons={closeReasons} />
          )}
          <Button variant="ghost" size="icon">
              <FileDown className="h-5 w-5"/>
          </Button>
          <ChatSummary chatHistory={initialMessages.map(m => `${'\'\'\''}${m.sender?.name || 'System'}: ${m.content}${'\'\'\''}`).join('\n')} />
          <Button variant="ghost" size="icon">
              <MoreVertical className="h-5 w-5"/>
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto" >
        <ScrollArea className="h-full" ref={scrollAreaRef}>
          <div className="space-y-1 p-6">
            {initialMessages.map(renderMessageWithSeparator)}
          </div>
        </ScrollArea>
      </div>


       {isChatOpen ? (
            <footer className="border-t bg-card p-4 flex-shrink-0">
                {mediaFiles.length > 0 && (
                    <MediaPreview mediaFiles={mediaFiles} setMediaFiles={setMediaFiles} />
                )}
                {!isAiAgentActive && mediaFiles.length === 0 && !isAiTyping && (
                    <SmartReplies 
                        customerMessage={lastMessage?.content || ''}
                        chatHistory={initialMessages.map(m => `${'\'\'\''}${m.sender?.name || 'System'}: ${m.content}${'\'\'\''}`).join('\n')}
                        onSelectReply={(reply) => {
                          setNewMessage(reply);
                          if(contentEditableRef.current) contentEditableRef.current.innerHTML = reply;
                        }}
                    />
                )}
                <div className="space-y-2">
                     <form action={handleFormSubmit}>
                        <input type="hidden" name="chatId" value={chat.id} />
                         <div className="relative overflow-hidden">
                            <div className='border rounded-lg'>
                                <FormattingToolbar />
                                <ContentEditable
                                    innerRef={contentEditableRef}
                                    html={newMessage}
                                    disabled={isAiTyping}
                                    onChange={(e) => setNewMessage(e.target.value)}
                                    className="pr-28 pl-4 py-3 min-h-14 bg-background focus:outline-none"
                                    tagName="div"
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault();
                                            if (e.currentTarget.closest('form')) {
                                               handleFormSubmit(new FormData(e.currentTarget.closest('form')!));
                                            }
                                        }
                                    }}
                                />
                            </div>
                            <div className="absolute right-2 bottom-2.5 flex items-center">
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" disabled={isAiTyping}><Smile className="h-5 w-5" /></Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0 border-none mb-2">
                                        <EmojiPicker onEmojiClick={onEmojiClick} />
                                    </PopoverContent>
                                </Popover>
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    onChange={handleFileChange}
                                    className="hidden"
                                    multiple
                                    accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx"
                                />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    disabled={isAiTyping}
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    <Paperclip className="h-5 w-5" />
                                </Button>
                                <SendMessageButton disabled={mediaFiles.length === 0 && !htmlToWhatsappMarkdown(newMessage).trim() || isAiTyping} />
                            </div>
                        </div>
                    </form>
                    <div className="flex items-center space-x-2">
                        <Bot className="h-5 w-5 text-muted-foreground" />
                        <Switch
                            id="ai-agent-switch"
                            checked={isAiAgentActive}
                            onCheckedChange={handleAiSwitchChange}
                            disabled={isAiTyping}
                        />
                        <Label htmlFor="ai-agent-switch" className="font-medium text-sm">Piloto Automático</Label>
                         {isAiTyping && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                    </div>
                </div>
            </footer>
       ) : (
            <footer className="border-t bg-card p-4 flex-shrink-0 text-center">
                <p className='text-sm font-medium text-muted-foreground'>Este atendimento foi encerrado.</p>
            </footer>
       )}
    </main>
  );
}
