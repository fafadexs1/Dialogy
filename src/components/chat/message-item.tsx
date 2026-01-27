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
    ArrowRightLeft,
    XCircle
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
            <div className="overflow-hidden rounded-2xl border border-border bg-card/50 backdrop-blur-sm hover:border-primary/40 transition-all max-w-[85vw] md:max-w-[320px] shadow-sm dark:border-white/10 dark:bg-white/5 dark:hover:border-blue-400/40 dark:shadow-lg dark:shadow-black/20">
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
                    <p className="text-sm font-semibold text-foreground flex items-center gap-2 dark:text-white">
                        <MapPin className="h-4 w-4 text-blue-300" />
                        <span className="line-clamp-2">{title}</span>
                    </p>
                    {subtitle && <p className="text-xs text-muted-foreground dark:text-white/70">{subtitle}</p>}
                    {hasCoords && (
                        <p className="text-[11px] text-muted-foreground/70 dark:text-white/50">
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

function SafeMediaImage({ src, alt, className, width, height, onClick }: { src: string, alt: string, className?: string, width: number, height: number, onClick?: () => void }) {
    const [hasError, setHasError] = React.useState(false);

    if (hasError) {
        return (
            <div
                className={cn("flex flex-col items-center justify-center bg-muted/30 border border-border rounded-lg p-4 text-muted-foreground", className)}
                style={{ width: width, height: height > 200 ? 200 : height }}
                onClick={onClick}
            >
                <div className="bg-muted/50 p-3 rounded-full mb-2">
                    <FileIcon className="h-6 w-6 opacity-50" />
                </div>
                <span className="text-xs font-medium text-center opacity-70">Mídia indisponível</span>
                <span className="text-[10px] opacity-50 text-center">Arquivo expirado ou não encontrado</span>
            </div>
        );
    }

    return (
        <Image
            src={src}
            alt={alt}
            width={width}
            height={height}
            className={className}
            onError={() => setHasError(true)}
            onClick={onClick}
        />
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
    const safeThumbnail = validUrl(thumbnail);

    if (!urlToUse) return <p>{message.content || 'Mídia inválida'}</p>;

    const renderMedia = () => {
        if (effectiveMimeType.startsWith('image/')) {
            return (
                <MediaViewer src={urlToUse} type="image" alt={message.content || fileName || 'Imagem enviada'} fileName={fileName}>
                    <div className="cursor-pointer">
                        <SafeMediaImage
                            src={urlToUse}
                            alt={message.content || fileName || 'Imagem enviada'}
                            width={300}
                            height={300}
                            className="rounded-lg object-cover w-full max-w-[80vw] md:max-w-[300px] h-auto hover:brightness-90 transition-all"
                        />
                    </div>
                </MediaViewer>
            );
        }

        if (effectiveMimeType.startsWith('video/')) {
            return (
                <MediaViewer src={urlToUse} type="video" alt={message.content || fileName || 'Vídeo enviado'} fileName={fileName}>
                    <div className="relative group cursor-pointer">
                        <SafeMediaImage
                            src={safeThumbnail || '/placeholder-video.png'}
                            alt="Vídeo"
                            width={300}
                            height={200}
                            className="rounded-lg object-cover w-full max-w-[80vw] md:max-w-[300px] h-auto brightness-75 group-hover:brightness-90 transition-all"
                        />
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="bg-black/50 rounded-full p-3 backdrop-blur-sm group-hover:scale-110 transition-transform">
                                <PlayCircle className="h-8 w-8 text-white" />
                            </div>
                        </div>
                        <div className="absolute bottom-2 right-2 bg-black/60 px-2 py-1 rounded text-xs text-white font-medium pointer-events-none">
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
                className="flex items-center gap-3 bg-muted/50 p-3 rounded-lg hover:bg-muted/80 transition-colors max-w-[80vw] md:max-w-[300px] dark:bg-white/10 dark:hover:bg-white/20"
            >
                <FileIcon className="h-8 w-8 opacity-70 flex-shrink-0" />
                <div className='min-w-0 flex-1'>
                    <p className="font-medium truncate opacity-90">{fileName || 'Documento'}</p>
                    <p className="text-xs opacity-70">Clique para abrir ou baixar</p>
                </div>
                <Download className="h-5 w-5 opacity-70 ml-auto flex-shrink-0" />
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
    onRetry?: (message: Message) => void;
}

const MessageItem = memo(({ message, prevMessage, workspaceTimezone, onDelete, currentUserId, instanceName, onForward, onRetry }: MessageItemProps) => {
    const { toast } = useToast();
    const showDateSeparator = !prevMessage || message.formattedDate !== prevMessage.formattedDate;

    const isFromMe = !!message.from_me;
    const isDeleted = message.status === 'deleted';
    const status = (message.api_message_status || '').toUpperCase();
    const isFailed = status === 'FAILED';
    const isInternalNote = message.metadata?.isInternalNote;
    const failureReason = typeof message.metadata?.send_error === 'string' ? message.metadata.send_error : undefined;
    const statusTitle = isFailed && failureReason ? `Falha ao enviar: ${failureReason}` : (message.api_message_status || 'Sem status');

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
                        <div className="w-full border-t border-border/50"></div>
                    </div>
                    <div className="relative flex justify-center">
                        <span className="bg-muted/80 backdrop-blur-md px-3 py-1 text-xs font-medium text-muted-foreground rounded-full border border-border shadow-sm dark:bg-white/5 dark:text-white/60 dark:border-white/10">{message.formattedDate}</span>
                    </div>
                </div>
            )}
            {
                message.type === 'system' ? (
                    <div className="flex justify-center items-center my-6">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-full px-3 py-1 border border-border dark:text-white/60 dark:bg-white/5 dark:border-white/10">
                            <Info className="h-3.5 w-3.5" />
                            <span>{message.content}</span>
                            <span>-</span>
                            <span>{message.timestamp}</span>
                        </div>
                    </div>
                ) : (
                    <div
                        className={`group flex items-start gap-3 ${isFromMe ? 'flex-row-reverse' : 'flex-row'}`}
                    >
                        {message.sender && (
                            <Avatar className="h-8 w-8 border border-white/10 ring-1 ring-white/5">
                                <AvatarImage src={(message.sender as any).avatar || (message.sender as any).avatar_url || undefined} alt={message.sender.name || ''} data-ai-hint="person" />
                                <AvatarFallback className="bg-muted text-muted-foreground text-xs dark:bg-white/10 dark:text-white/70">{message.sender.name?.charAt(0) || '?'}</AvatarFallback>
                            </Avatar>
                        )}
                        <div className={cn("flex flex-col", isFromMe ? 'items-end' : 'items-start')}>
                            <div className={cn("flex items-end", isFromMe ? 'flex-row-reverse' : 'flex-row')}>
                                <div
                                    className={cn(
                                        "break-words rounded-[22px] md:rounded-2xl p-3 md:p-3 max-w-[85%] md:max-w-lg shadow-sm md:shadow-lg relative",
                                        isDeleted
                                            ? 'bg-muted/30 text-muted-foreground italic border border-border/50 dark:bg-white/5 dark:text-white/50 dark:border-white/10'
                                            : isInternalNote
                                                ? 'bg-yellow-500/10 border border-yellow-500/20 text-yellow-600 dark:text-yellow-200'
                                                : (isFromMe
                                                    ? 'bg-blue-600 text-white rounded-tr-sm shadow-md dark:bg-gradient-to-br dark:from-blue-600 dark:to-violet-600 dark:border dark:border-white/10'
                                                    : 'bg-white dark:bg-white/10 backdrop-blur-md border border-border/50 dark:border-white/10 text-foreground dark:text-white rounded-tl-sm shadow-sm')
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
                                                <TooltipContent className="bg-popover border-border text-popover-foreground text-xs dark:bg-black/90 dark:border-white/10 dark:text-white">
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
                                                    <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground hover:bg-muted/50 dark:text-white/50 dark:hover:text-white dark:hover:bg-white/10">
                                                        <MoreVertical className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent className="bg-popover border-border text-popover-foreground dark:bg-black/90 dark:border-white/10 dark:text-white">
                                                    <DropdownMenuItem
                                                        className="cursor-pointer focus:bg-accent focus:text-accent-foreground dark:hover:bg-white/10 dark:focus:bg-white/10"
                                                        onClick={() => {
                                                            navigator.clipboard.writeText(message.content || '');
                                                            toast({ title: 'Mensagem copiada!' });
                                                        }}
                                                    >
                                                        <Copy className="mr-2 h-4 w-4" />
                                                        Copiar
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem
                                                        className="cursor-pointer focus:bg-accent focus:text-accent-foreground dark:hover:bg-white/10 dark:focus:bg-white/10"
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
                                            <AlertDialogContent className="bg-background border-border text-foreground dark:bg-black/90 dark:border-white/10 dark:text-white">
                                                <AlertDialogHeader>
                                                    <AlertDialogTitle>Apagar mensagem?</AlertDialogTitle>
                                                    <AlertDialogDescription className="text-muted-foreground dark:text-white/70">
                                                        Esta ação não pode ser desfeita. A mensagem será apagada para todos na conversa.
                                                    </AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                    <AlertDialogCancel className="bg-muted border-input text-muted-foreground hover:bg-accent hover:text-accent-foreground dark:bg-white/10 dark:border-white/10 dark:text-white dark:hover:bg-white/20">Cancelar</AlertDialogCancel>
                                                    <AlertDialogAction onClick={() => onDelete(message.id, instanceName)} className="bg-red-600 hover:bg-red-700 text-white border-none">Apagar</AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    </div>
                                )}
                            </div>
                            <div
                                className={cn("flex items-center text-[10px] text-muted-foreground/60 mt-1.5 dark:text-white/40", isFromMe ? 'flex-row-reverse gap-1' : 'flex-row gap-1')}
                                title={statusTitle}
                            >
                                <span className="mx-1">
                                    {formatInTimeZone(new Date(message.createdAt), workspaceTimezone, 'HH:mm', { locale: ptBR })}
                                </span>
                                {message.from_me && !isDeleted && (
                                    <div className="flex items-center gap-1">
                                        {isFailed ? (
                                            <>
                                                <XCircle className="h-3 w-3 text-red-400" />
                                                <span className="text-red-400">Falha</span>
                                                {onRetry && !isInternalNote && (
                                                    <Button
                                                        type="button"
                                                        variant="link"
                                                        size="sm"
                                                        className="h-auto px-1 text-red-400 hover:text-red-300"
                                                        onClick={() => onRetry(message)}
                                                    >
                                                        Reenviar
                                                    </Button>
                                                )}
                                            </>
                                        ) : (
                                            (() => {
                                                // Case-insensitive pending check
                                                if (message.optimistic) return null; // Optimistic: No icon (immediate feedback)

                                                if (status === 'PENDING') return <Check className="h-3 w-3 text-muted-foreground/40 dark:text-white/40" />; // Saved in DB: Single Check

                                                if (status === 'READ' || status === 'PLAYED') return <CheckCheck className="h-3 w-3 text-blue-500 dark:text-blue-400" />; // Read: Blue Double Check
                                                if (status === 'DELIVERED') return <CheckCheck className="h-3 w-3 text-muted-foreground/40 dark:text-white/40" />; // Delivered: Gray Double Check
                                                if (status === 'SENT') return <CheckCheck className="h-3 w-3 text-muted-foreground/40 dark:text-white/40" />; // Sent to API: Gray Double Check

                                                // Fallback
                                                return <Check className="h-3 w-3" />;
                                            })()
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )
            }
        </React.Fragment >
    );
});

MessageItem.displayName = 'MessageItem';

export default MessageItem;
