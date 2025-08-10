'use client';

import React, { useActionState, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Paperclip, Send, Smile, MoreVertical, Bot, Loader2, MessageSquare, LogOut, FileDown, Info, Check, CheckCheck, Trash2, File, PlayCircle, Mic, Download } from 'lucide-react';
import { type Chat, type Message, type User, Tag } from '@/lib/types';
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
import { sendMessageAction, sendMediaAction } from '@/actions/messages';
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
} from "@/components/ui/alert-dialog";
import MediaPreview, { type MediaFileType } from './media-preview';

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

function MediaMessage({ message }: { message: Message }) {
    const { mediaUrl, mimetype = '', fileName, caption } = message.metadata || {};

    if (!mediaUrl) return <p>{message.content}</p>;

    const renderMedia = () => {
        if (mimetype.startsWith('image/')) {
            return (
                <Link href={mediaUrl} target="_blank" rel="noopener noreferrer">
                    <Image
                        src={mediaUrl}
                        alt={caption || fileName || 'Imagem enviada'}
                        width={300}
                        height={300}
                        className="rounded-lg object-cover max-w-xs"
                    />
                </Link>
            );
        }
        if (mimetype.startsWith('video/')) {
            return (
                <video controls className="rounded-lg max-w-xs">
                    <source src={mediaUrl} type={mimetype} />
                    Seu navegador não suporta a tag de vídeo.
                </video>
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
                    className="flex items-center gap-3 p-3 rounded-lg border bg-secondary/50 hover:bg-secondary transition-colors"
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
        <div className="space-y-2">
            {renderMedia()}
            {caption && <p className="text-sm pt-1">{caption}</p>}
        </div>
    );
}

export default function ChatPanel({ chat, messages: initialMessages, currentUser, onActionSuccess, closeReasons }: ChatPanelProps) {
  const [newMessage, setNewMessage] = useState('');
  const [mediaFiles, setMediaFiles] = useState<MediaFileType[]>([]);
  const [isAiAgentActive, setIsAiAgentActive] = useState(false);
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [selectedAiModel, setSelectedAiModel] = useState('googleai/gemini-2.0-flash');
  
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const { toast } = useToast();
  
  const [sendState, sendFormAction] = useActionState(sendMessageAction, { success: false, error: null });

  useEffect(() => {
        if (sendState.success) {
            formRef.current?.reset();
            setNewMessage('');
            onActionSuccess();
        } else if (sendState.error) {
            toast({ title: 'Erro ao Enviar Mensagem', description: sendState.error, variant: 'destructive' });
        }
    }, [sendState, toast, onActionSuccess]);

  useEffect(() => {
    if (scrollAreaRef.current) {
        const viewport = scrollAreaRef.current.querySelector('div[data-radix-scroll-area-viewport]');
        if (viewport) {
            viewport.scrollTop = viewport.scrollHeight;
        }
    }
  }, [initialMessages]);

  const chatHistoryForAI = initialMessages.map(m => `${m.sender?.name || 'System'}: ${m.content}`).join('\n');
  const lastCustomerMessage = initialMessages.filter(m => m.sender?.id !== currentUser?.id).pop();


  useEffect(() => {
    const runAiAgent = async () => {
        if (isAiAgentActive && lastCustomerMessage && chat && lastCustomerMessage.sender?.id !== currentUser?.id) {
            const lastMessageInState = initialMessages[initialMessages.length - 1];
            if (lastMessageInState.sender?.id === lastCustomerMessage.sender?.id) {
                setIsAiThinking(true);
                try {
                    const activeRules = nexusFlowInstances.filter(rule => rule.enabled);

                    const result = await generateAgentResponse({
                        customerMessage: lastCustomerMessage.content,
                        chatHistory: chatHistoryForAI,
                        rules: activeRules,
                        knowledgeBase: "", // mockKnowledgeBase was here
                        model: selectedAiModel,
                    });
                    
                    if (result && result.response && chat.agent?.id) {
                        // TODO: Send AI message through an action
                        console.log("AI would have sent:", result.response);
                    }

                } catch (error) {
                     console.error('Error generating AI agent response:', error);
                     toast({
                        title: 'Erro do Agente IA',
                        description: 'Não foi possível avaliar as regras de automação. Tente novamente.',
                        variant: 'destructive',
                    });
                } finally {
                    setIsAiThinking(false);
                }
            }
        }
    };
    runAiAgent();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessages, isAiAgentActive, lastCustomerMessage, chatHistoryForAI, toast, selectedAiModel, chat, currentUser?.id]);
  
  // Mark messages as read effect
  useEffect(() => {
      if (!chat || !chat.contact.phone_number_jid || !chat.instance_name) return;

      const unreadMessages = initialMessages.filter(m => m.sender?.id === chat.contact.id && m.api_message_status !== 'READ' && m.message_id_from_api);
      
      if (unreadMessages.length > 0) {
          const messagesToMark = unreadMessages.map(m => ({
              remoteJid: chat.contact.phone_number_jid!,
              fromMe: false, // Messages from contact are not fromMe
              id: m.message_id_from_api!
          }));
          
          markMessagesAsReadAction(chat.instance_name, messagesToMark);
      }
  }, [initialMessages, chat]);
  
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
      onActionSuccess(); // Re-fetch data
    }
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    const filePromises = files.map(file => {
        return new Promise<MediaFileType>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const base64 = (e.target?.result as string).split(',')[1];
                let mediatype: MediaFileType['mediatype'] = 'document';
                if (file.type.startsWith('image/')) mediatype = 'image';
                if (file.type.startsWith('video/')) mediatype = 'video';
                
                resolve({
                    id: `${file.name}-${file.lastModified}`,
                    file: file,
                    name: file.name,
                    type: file.type,
                    mediatype: mediatype,
                    base64: base64,
                });
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    });

    Promise.all(filePromises).then(newFiles => {
        setMediaFiles(prev => [...prev, ...newFiles]);
    });
    
    // Reset file input to allow selecting the same file again
    event.target.value = '';
  };

  const handleFormSubmit = async (formData: FormData) => {
    if (mediaFiles.length > 0) {
        // Handle media sending
        if (!chat) return;
        const caption = formData.get('content') as string;
        const mediaData = mediaFiles.map(mf => ({
            base64: mf.base64,
            mimetype: mf.type,
            filename: mf.name,
            mediatype: mf.mediatype,
        }));
        
        const result = await sendMediaAction(chat.id, caption, mediaData);
        if (result.success) {
            setMediaFiles([]);
            setNewMessage('');
            onActionSuccess();
        } else {
            toast({ title: 'Erro ao Enviar Mídia', description: result.error, variant: 'destructive' });
        }
    } else {
        // Handle text message sending
        sendFormAction(formData);
    }
  };

  const renderMessageContent = (message: Message) => {
    if (message.status === 'deleted') {
      return <p className="whitespace-pre-wrap">🗑️ Mensagem apagada</p>;
    }
    if (message.metadata?.mediaUrl) {
      return <MediaMessage message={message} />;
    }
    return <p className="whitespace-pre-wrap">{message.content}</p>;
  };


  const renderMessageWithSeparator = (message: Message, index: number) => {
    const prevMessage = initialMessages[index - 1];
    const showDateSeparator = !prevMessage || message.formattedDate !== prevMessage.formattedDate;

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
             <div
                className={`flex items-end gap-3 animate-in fade-in group ${
                  message.sender?.id === currentUser?.id ? 'flex-row-reverse' : 'flex-row'
                }`}
              >
                {message.sender && (
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={message.sender.avatar} alt={message.sender.name || ''} data-ai-hint="person" />
                      <AvatarFallback>{message.sender.name?.charAt(0) || '?'}</AvatarFallback>
                    </Avatar>
                )}

                <div
                  className={`flex items-center gap-2 ${ message.sender?.id === currentUser?.id ? 'flex-row-reverse' : 'flex-row'}`}
                >
                    {message.sender?.id === currentUser.id && message.status !== 'deleted' && (
                        <div className="flex-shrink-0">
                            <AlertDialog>
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-7 w-7">
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
                
                    <div
                    className={`max-w-xl rounded-xl px-4 py-3 text-sm shadow-md break-words ${
                        message.sender?.id === currentUser?.id
                        ? 'rounded-br-none bg-primary text-primary-foreground'
                        : 'rounded-bl-none bg-card'
                    } ${message.status === 'deleted' ? 'bg-secondary/50 border italic' : ''}`}
                    >
                        {renderMessageContent(message)}
                        <div className={`flex items-center justify-end gap-1 mt-2 ${
                            message.sender?.id === currentUser.id
                                ? 'text-primary-foreground/70'
                                : 'text-muted-foreground'
                            }`}>
                            <p className="text-xs">{message.timestamp}</p>
                            {message.sender?.id === currentUser.id && message.status !== 'deleted' && (
                                message.api_message_status === 'READ'
                                ? <CheckCheck className="h-4 w-4 text-sky-400" />
                                : message.api_message_status === 'DELIVERED'
                                ? <CheckCheck className="h-4 w-4" />
                                : <Check className="h-4 w-4" />
                            )}
                        </div>
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
          <ChatSummary chatHistory={chatHistoryForAI} />
          <Button variant="ghost" size="icon">
              <MoreVertical className="h-5 w-5"/>
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto" >
        <ScrollArea className="h-full" ref={scrollAreaRef}>
          <div className="space-y-4 p-6">
            {initialMessages.map(renderMessageWithSeparator)}
            {isAiThinking && (
              <div className="flex items-end gap-3 flex-row-reverse animate-in fade-in">
                {chat.agent ? (
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={chat.agent.avatar} alt={chat.agent.name || ''} data-ai-hint="person" />
                    <AvatarFallback>{chat.agent.name?.charAt(0)}</AvatarFallback>
                  </Avatar>
                ) : <div className="w-8" />}
                <div className="max-w-xl rounded-xl px-4 py-3 text-sm shadow-md rounded-br-none bg-primary text-primary-foreground">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Avaliando regras...</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>


       {isChatOpen ? (
            <footer className="border-t bg-card p-4 flex-shrink-0">
                {mediaFiles.length > 0 ? (
                    <MediaPreview mediaFiles={mediaFiles} setMediaFiles={setMediaFiles} />
                ) : !isAiAgentActive && (
                    <SmartReplies 
                        customerMessage={lastCustomerMessage?.content || ''}
                        chatHistory={chatHistoryForAI}
                        onSelectReply={(reply) => setNewMessage(reply)}
                    />
                )}
                <div className="flex items-center gap-4 mt-2">
                     <form
                        ref={formRef}
                        action={handleFormSubmit}
                        className="relative flex-1"
                    >
                        <input type="hidden" name="chatId" value={chat.id} />
                        <Input
                            name="content"
                            placeholder={mediaFiles.length > 0 ? "Adicionar uma legenda..." : "Digite sua mensagem..."}
                            className="pr-24"
                            value={newMessage}
                            onChange={(e) => setNewMessage(e.target.value)}
                            disabled={isAiAgentActive}
                        />
                        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center">
                            <Button type="button" variant="ghost" size="icon" disabled={isAiAgentActive}><Smile className="h-5 w-5" /></Button>
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
                                disabled={isAiAgentActive}
                                onClick={() => fileInputRef.current?.click()}
                            >
                                <Paperclip className="h-5 w-5" />
                            </Button>
                            <SendMessageButton disabled={mediaFiles.length === 0 && !newMessage.trim()} />
                        </div>
                    </form>
                    <div className="flex items-center space-x-2">
                        <Bot className="h-5 w-5 text-muted-foreground" />
                        <Switch
                            id="ai-agent-switch"
                            checked={isAiAgentActive}
                            onCheckedChange={setIsAiAgentActive}
                        />
                        <Label htmlFor="ai-agent-switch" className="font-medium text-sm">Piloto Automático</Label>
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
