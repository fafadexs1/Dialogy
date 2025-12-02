'use client';

import React, { memo } from 'react';
import { formatInTimeZone } from 'date-fns-tz';
import { ptBR } from 'date-fns/locale';
import Image from 'next/image';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
    MoreVertical,
    Info,
    Check,
    CheckCheck,
    Trash2,
    File as FileIcon,
    PlayCircle,
    Download,
    StickyNote,
    MapPin,
    Copy,
    Clock,
    ArrowRightLeft
} from 'lucide-react';
import { type Message } from '@/lib/types';
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
import { cn, formatWhatsappText } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { AudioPlayer } from './audio-player';
import { MediaViewer } from './media-viewer';
import { useToast } from '@/hooks/use-toast';

function formatDuration(seconds: number): string {
    if (!seconds) return '0:00';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function LocationMessage({ message }: { message: Message }) {
    const { latitude, longitude, address, locationName, mapUrl, thumbnail, locationDescription } = message.metadata || {};
    const thumbnailSrc = typeof thumbnail === 'string' && thumbnail.length > 0 ? thumbnail : undefined;
    const hasCoords = typeof latitude === 'number' && typeof longitude === 'number';
    const resolvedMapUrl = mapUrl || (hasCoords ? `https://www.google.com/maps?q=${latitude},${longitude}` : undefined);
    const hasLink = Boolean(resolvedMapUrl);
    const linkHref = resolvedMapUrl || '#';
    const title = locationName || address || message.content || 'Localização compartilhada';
    const subtitle = address || locationDescription || (hasCoords ? `Coordenadas: ${latitude?.toFixed(5)}, ${longitude?.toFixed(5)}` : undefined);

    return (
        <a href={linkHref} target={hasLink ? "_blank" : undefined} rel={hasLink ? "noopener noreferrer" : undefined} className="block">
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm hover:border-blue-400/40 transition-all max-w-[320px] shadow-lg shadow-black/20">
                {thumbnailSrc ? (
                    <div className="relative">
                        <Image
                            src={thumbnailSrc}
                            alt={title}
                            width={320}
                            height={180}
                            className="w-full h-auto object-cover"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/25 to-transparent" />
                        <div className="absolute bottom-3 left-3 flex items-center gap-2 text-white text-xs font-semibold">
                            <MapPin className="h-4 w-4" />
                            <span>Ver no mapa</span>
                        </div>
                    </div>
                ) : (
                    <div className="flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-blue-600/40 to-indigo-600/40 text-white">
                        <MapPin className="h-4 w-4" />
                        <span className="text-xs font-semibold">Localização compartilhada</span>
                    </div>
                )}
                <div className="p-3 space-y-1">
                    <p className="text-sm font-semibold text-white flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-blue-300" />
                        <span className="line-clamp-2">{title}</span>
                    </p>
                    {subtitle && <p className="text-xs text-white/70">{subtitle}</p>}
                    {hasCoords && (
                        <p className="text-[11px] text-white/50">
                            {latitude?.toFixed(5)}, {longitude?.toFixed(5)}
                        </p>
                    )}
                    {resolvedMapUrl && (
                        <p className="text-[11px] text-blue-300 underline underline-offset-2">Abrir no Google Maps</p>
                    )}
                </div>
            </div>
        </a>
    );
}

function MediaMessage({ message, workspaceId }: { message: Message, workspaceId: string }) {
    const { mediaUrl, mimetype = '', fileName, thumbnail, duration, waveform } = message.metadata || {};

    let effectiveMimeType = mimetype;
    if (!effectiveMimeType && message.type) {
        if (message.type === 'image') effectiveMimeType = 'image/jpeg';
        else if (message.type === 'video') effectiveMimeType = 'video/mp4';
        else if (message.type === 'audio') effectiveMimeType = 'audio/mp4';
    }

    const validUrl = (url: any) => typeof url === 'string' && url.length > 0 ? url : undefined;
    let urlToUse = validUrl(mediaUrl) || validUrl(thumbnail);

    if (!urlToUse) return <p>{message.content || 'Mídia inválida'}</p>;

    const renderMedia = () => {
        if (effectiveMimeType.startsWith('image/')) {
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

        if (effectiveMimeType.startsWith('video/')) {
            return (
                <MediaViewer src={urlToUse} type="video" alt={message.content || fileName || 'Vídeo enviado'} fileName={fileName}>
                    <div className="relative group cursor-pointer">
                        <Image
                            src={thumbnail || '/placeholder-video.png'}
                            alt="Vídeo"
                            width={300}
                            height={200}
                            className="rounded-lg object-cover w-full max-w-[300px] h-auto brightness-75 group-hover:brightness-90 transition-all"
                        />
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="bg-black/50 rounded-full p-3 backdrop-blur-sm group-hover:scale-110 transition-transform">
                                <PlayCircle className="h-8 w-8 text-white" />
                            </div>
                        </div>
                        <div className="absolute bottom-2 right-2 bg-black/60 px-2 py-1 rounded text-xs text-white font-medium">
                            {duration ? formatDuration(duration) : 'Vídeo'}
                        </div>
                    </div>
                </MediaViewer>
            );
        }

        if (effectiveMimeType.startsWith('audio/')) {
            return <AudioPlayer
                src={urlToUse}
                messageId={message.id}
                initialTranscription={message.transcription}
                duration={duration}
                waveform={waveform}
                isFromMe={Boolean(message.from_me)}
                workspaceId={workspaceId}
                chatId={message.chat_id}
            />;
        }

        return (
            <a
                href={urlToUse}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 bg-white/10 p-3 rounded-lg hover:bg-white/20 transition-colors max-w-[300px]"
            >
                <FileIcon className="h-8 w-8 text-white/70 flex-shrink-0" />
                <div className='min-w-0'>
                    <p className="font-medium truncate text-white">{fileName || 'Documento'}</p>
                    <p className="text-xs text-white/50">Clique para abrir ou baixar</p>
                </div>
                <Download className="h-5 w-5 text-white/50 ml-auto flex-shrink-0" />
            </a>
        );
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

interface MessageItemProps {
    message: Message;
    prevMessage?: Message;
    workspaceTimezone: string;
    onDelete: (messageId: string, instanceName?: string) => void;
    currentUserId: string;
    instanceName?: string;
    onForward?: (message: Message) => void;
}

const MessageItem = memo(({ message, prevMessage, workspaceTimezone, onDelete, currentUserId, instanceName, onForward }: MessageItemProps) => {
    const { toast } = useToast();
    const showDateSeparator = !prevMessage || message.formattedDate !== prevMessage.formattedDate;

    const isFromMe = !!message.from_me;
    const isDeleted = message.status === 'deleted';
    const isPending = message.api_message_status === 'PENDING';
    const isInternalNote = message.metadata?.isInternalNote;

    const renderMessageContent = (message: Message, isFromMe = false) => {
        const isLocationMessage =
            message.type === 'location' ||
            (typeof message.metadata?.latitude === 'number' && typeof message.metadata?.longitude === 'number');

        if (isLocationMessage) {
            return <LocationMessage message={message} />;
        }

        const isMediaType = message.type && message.type !== 'text' && message.type !== 'system';
        const hasMediaAttachment = Boolean(
            message.metadata?.mediaUrl ||
            message.metadata?.thumbnail ||
            message.metadata?.fileName ||
            message.metadata?.mimetype
        );

        if (isMediaType || hasMediaAttachment) {
            return <MediaMessage message={message} workspaceId={message.workspace_id} />;
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

    return (
        <React.Fragment>
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
                <div className="flex justify-center items-center my-6">
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
                                ) : (
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <div className="cursor-default">
                                                    {renderMessageContent(message, isFromMe)}
                                                </div>
                                            </TooltipTrigger>
                                            <TooltipContent className="bg-black/90 border-white/10 text-white text-xs">
                                                {formatInTimeZone(new Date(message.createdAt), workspaceTimezone, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                                            </TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                )}
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
                                                <DropdownMenuItem
                                                    className="cursor-pointer hover:bg-white/10 focus:bg-white/10"
                                                    onClick={() => onForward && onForward(message)}
                                                >
                                                    <ArrowRightLeft className="mr-2 h-4 w-4" />
                                                    Encaminhar
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
                                                <AlertDialogAction onClick={() => onDelete(message.id, instanceName)} className="bg-red-600 hover:bg-red-700 text-white border-none">Apagar</AlertDialogAction>
                                            </AlertDialogFooter>
                                        </AlertDialogContent>
                                    </AlertDialog>
                                </div>
                            )}
                        </div>
                        <div className={cn("flex items-center text-[10px] text-white/40 mt-1.5", isFromMe ? 'flex-row-reverse gap-1' : 'flex-row gap-1')}>
                            <span className="mx-1">
                                {formatInTimeZone(new Date(message.createdAt), workspaceTimezone, 'HH:mm', { locale: ptBR })}
                            </span>
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
    );
});

MessageItem.displayName = 'MessageItem';

export default MessageItem;
