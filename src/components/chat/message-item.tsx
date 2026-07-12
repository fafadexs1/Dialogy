'use client';

import React, { memo } from 'react';
import { formatInTimeZone } from 'date-fns-tz';
import { ptBR } from 'date-fns/locale';
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
    Image as ImageIcon,
    Video,
    Download,
    StickyNote,
    MapPin,
    User,
    Phone,
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
import { cn, formatMessageDate, formatWhatsappText } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { AudioPlayer } from './audio-player';
import { MediaViewer } from './media-viewer';
import { useToast } from '@/hooks/use-toast';
import { resolveClientMediaUrl } from '@/lib/storage-url';

function formatDuration(seconds: number): string {
    if (!seconds) return '0:00';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

type FailureDetailsView = {
    summary: string;
    code?: string | number;
    status?: string;
    source?: string;
    capturedAt?: string;
};

function normalizeFailureDetails(message: Message): FailureDetailsView {
    const sendError = typeof message.metadata?.send_error === 'string'
        ? message.metadata.send_error.trim()
        : '';
    const details = message.metadata?.send_error_details as Record<string, unknown> | undefined;

    const reason = typeof details?.reason === 'string' ? details.reason.trim() : '';
    const providerMessage = typeof details?.provider_message === 'string' ? details.provider_message.trim() : '';
    const code = (typeof details?.code === 'string' || typeof details?.code === 'number') ? details.code : undefined;
    const status = typeof details?.status === 'string' ? details.status : undefined;
    const source = typeof details?.source === 'string' ? details.source : undefined;
    const capturedAt = typeof details?.captured_at === 'string' ? details.captured_at : undefined;

    const parts: string[] = [];
    if (sendError) parts.push(sendError);
    if (reason && reason !== sendError) parts.push(reason);
    if (providerMessage && providerMessage !== reason && providerMessage !== sendError) parts.push(providerMessage);
    if (code !== undefined) parts.push(`Cód. ${code}`);

    return {
        summary: parts.length > 0 ? parts.join(' | ') : 'WhatsApp retornou falha de entrega para esta mensagem.',
        code,
        status,
        source,
        capturedAt,
    };
}

function formatReplyTypeLabel(type?: Message['type']): string {
    switch (type) {
        case 'image':
            return 'Imagem';
        case 'video':
            return 'Video';
        case 'audio':
            return 'Audio';
        case 'document':
            return 'Documento';
        case 'location':
            return 'Localizacao';
        default:
            return 'Mensagem';
    }
}

function resolveReplyPreview(message: Message, quotedMessage?: Message): {
    author: string;
    content: string;
} | null {
    const hasReplyReference = Boolean(
        quotedMessage ||
        (typeof message.metadata?.replyToMessageId === 'string' && message.metadata.replyToMessageId.trim().length > 0) ||
        (typeof message.metadata?.replyToMessageIdFromApi === 'string' && message.metadata.replyToMessageIdFromApi.trim().length > 0) ||
        (typeof message.metadata?.replyToContent === 'string' && message.metadata.replyToContent.trim().length > 0)
    );
    if (!hasReplyReference) return null;

    const replyToContent =
        typeof quotedMessage?.content === 'string' && quotedMessage.content.trim().length > 0
            ? quotedMessage.content.trim()
            : (typeof message.metadata?.replyToContent === 'string' && message.metadata.replyToContent.trim().length > 0
                ? message.metadata.replyToContent.trim()
                : undefined);

    const replyToType = quotedMessage?.type || message.metadata?.replyToType;
    const content = replyToContent || formatReplyTypeLabel(replyToType);
    if (!content) return null;

    const resolvedFromMe = typeof quotedMessage?.from_me === 'boolean'
        ? quotedMessage.from_me
        : (typeof message.metadata?.replyToFromMe === 'boolean' ? message.metadata.replyToFromMe : undefined);

    return {
        author: resolvedFromMe === true ? 'Voce' : resolvedFromMe === false ? 'Contato' : 'Mensagem original',
        content,
    };
}

function LocationMessage({ message }: { message: Message }) {
    const { latitude, longitude, address, locationName, mapUrl, thumbnail, locationDescription } = message.metadata || {};
    const thumbnailSrc = resolveClientMediaUrl(
        typeof thumbnail === 'string' && thumbnail.length > 0 ? thumbnail : undefined,
        { kind: 'image' }
    );
    const hasCoords = typeof latitude === 'number' && typeof longitude === 'number';
    const resolvedMapUrl = mapUrl || (hasCoords ? `https://www.google.com/maps?q=${latitude},${longitude}` : undefined);
    const hasLink = Boolean(resolvedMapUrl);
    const linkHref = resolvedMapUrl || '#';
    const title = locationName || address || message.content || 'Localização compartilhada';
    const subtitle = address || locationDescription || (hasCoords ? `Coordenadas: ${latitude?.toFixed(5)}, ${longitude?.toFixed(5)}` : undefined);

    return (
        <a href={linkHref} target={hasLink ? "_blank" : undefined} rel={hasLink ? "noopener noreferrer" : undefined} className="block min-w-0 max-w-full">
            <div className="w-[320px] max-w-full overflow-hidden rounded-2xl border border-border bg-card transition-colors hover:border-primary/40 dark:border-white/10 dark:bg-[#111318] dark:hover:border-blue-400/40">
                {thumbnailSrc ? (
                    <div className="relative">
                        <img
                            src={thumbnailSrc}
                            alt={title}
                            width={320}
                            height={180}
                            className="w-full h-auto object-cover"
                            loading="lazy"
                            draggable={false}
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

type SharedContactView = {
    displayName?: string;
    fullName?: string;
    organization?: string;
    phones: string[];
    vcard?: string;
};

function normalizeSharedContacts(message: Message): SharedContactView[] {
    const metadata = message.metadata || {};
    if (Array.isArray(metadata.sharedContacts) && metadata.sharedContacts.length > 0) {
        return metadata.sharedContacts.map((contact: any) => ({
            displayName: typeof contact?.displayName === 'string' ? contact.displayName : undefined,
            fullName: typeof contact?.fullName === 'string' ? contact.fullName : undefined,
            organization: typeof contact?.organization === 'string' ? contact.organization : undefined,
            phones: Array.isArray(contact?.phones)
                ? contact.phones.filter((phone: unknown): phone is string => typeof phone === 'string' && phone.trim().length > 0)
                : [],
            vcard: typeof contact?.vcard === 'string' ? contact.vcard : undefined,
        }));
    }

    const singleName = typeof metadata.sharedContactName === 'string' ? metadata.sharedContactName : undefined;
    const singlePhones = Array.isArray(metadata.sharedContactPhones)
        ? metadata.sharedContactPhones.filter((phone): phone is string => typeof phone === 'string' && phone.trim().length > 0)
        : [];
    const singleVcard = typeof metadata.sharedContactVcard === 'string' ? metadata.sharedContactVcard : undefined;

    if (!singleName && singlePhones.length === 0 && !singleVcard) return [];

    return [{
        displayName: singleName,
        phones: singlePhones,
        vcard: singleVcard,
    }];
}

function normalizePhoneHref(phone: string): string {
    const trimmed = phone.trim();
    if (!trimmed) return '#';
    const digits = trimmed.replace(/\D/g, '');
    if (!digits) return '#';
    return trimmed.startsWith('+') ? `tel:+${digits}` : `tel:${digits}`;
}

function SharedContactMessage({ message }: { message: Message }) {
    const contacts = normalizeSharedContacts(message);
    if (contacts.length === 0) {
        return (
            <p className="text-sm whitespace-pre-wrap">
                {message.content || 'Contato compartilhado'}
            </p>
        );
    }

    return (
        <div className="w-[340px] max-w-full min-w-0 space-y-2">
            <div className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] uppercase tracking-wide text-muted-foreground dark:border-white/10 dark:bg-white/10 dark:text-white/70">
                <User className="h-3 w-3" />
                <span>Contato compartilhado</span>
            </div>
            {contacts.slice(0, 3).map((contact, index) => {
                const title = contact.displayName || contact.fullName || `Contato ${index + 1}`;
                return (
                    <div
                        key={`${title}-${index}`}
                        className="rounded-xl border border-border/60 bg-background/70 p-3 shadow-sm dark:border-white/10 dark:bg-black/20"
                    >
                        <p className="text-sm font-semibold text-foreground dark:text-white">{title}</p>
                        {contact.organization && (
                            <p className="text-xs text-muted-foreground dark:text-white/70">{contact.organization}</p>
                        )}
                        {contact.phones.length > 0 ? (
                            <div className="mt-2 space-y-1">
                                {contact.phones.map((phone) => (
                                    <a
                                        key={`${title}-${phone}`}
                                        href={normalizePhoneHref(phone)}
                                        className="inline-flex items-center gap-1 text-xs text-blue-500 hover:underline dark:text-blue-300"
                                    >
                                        <Phone className="h-3 w-3" />
                                        <span>{phone}</span>
                                    </a>
                                ))}
                            </div>
                        ) : (
                            <p className="mt-2 text-xs text-muted-foreground dark:text-white/60">Sem telefone no contato.</p>
                        )}
                    </div>
                );
            })}
            {contacts.length > 3 && (
                <p className="text-[11px] text-muted-foreground dark:text-white/60">
                    +{contacts.length - 3} contatos adicionais
                </p>
            )}
        </div>
    );
}

function SafeMediaImage({ src, alt, className, width, height, onClick }: { src: string, alt: string, className?: string, width: number, height: number, onClick?: () => void }) {
    const [hasError, setHasError] = React.useState(false);
    const resolvedSrc = React.useMemo(() => resolveClientMediaUrl(src, { kind: 'image' }), [src]);

    React.useEffect(() => {
        setHasError(false);
    }, [resolvedSrc]);

    if (hasError || !resolvedSrc) {
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
        <img
            src={resolvedSrc}
            alt={alt}
            width={width}
            height={height}
            className={className}
            onError={() => setHasError(true)}
            onClick={onClick}
            loading="lazy"
            draggable={false}
        />
    );
}

function VideoThumbnail({ videoSrc, thumbnailSrc, className }: { videoSrc: string; thumbnailSrc?: string; className?: string }) {
    const [hasError, setHasError] = React.useState(false);

    React.useEffect(() => {
        setHasError(false);
    }, [videoSrc, thumbnailSrc]);

    if (thumbnailSrc) {
        return (
            <SafeMediaImage
                src={thumbnailSrc}
                alt="Vídeo"
                width={320}
                height={180}
                className={className}
            />
        );
    }

    if (hasError) {
        return (
            <SafeMediaImage
                src="/placeholder-video.png"
                alt="Vídeo"
                width={320}
                height={180}
                className={className}
            />
        );
    }

    return (
        <video
            src={videoSrc}
            muted
            playsInline
            preload="metadata"
            aria-label="Prévia do vídeo"
            className={className}
            onLoadedMetadata={(event) => {
                const preview = event.currentTarget;
                if (Number.isFinite(preview.duration) && preview.duration > 0.1) {
                    preview.currentTime = Math.min(0.1, preview.duration / 2);
                }
            }}
            onError={() => setHasError(true)}
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
    const rawMediaUrl = validUrl(mediaUrl);
    const rawThumbnail = validUrl(thumbnail);
    const mediaAssetUrl = resolveClientMediaUrl(rawMediaUrl || rawThumbnail, { kind: 'media' });
    const imageAssetUrl = resolveClientMediaUrl(rawMediaUrl || rawThumbnail, { kind: 'image' });
    const safeThumbnail = resolveClientMediaUrl(rawThumbnail, { kind: 'image' });
    const urlToUse = effectiveMimeType.startsWith('image/')
        ? (imageAssetUrl || mediaAssetUrl)
        : mediaAssetUrl;

    const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const isLongPressRef = React.useRef(false);

    const startPress = React.useCallback(() => {
        isLongPressRef.current = false;
        timerRef.current = setTimeout(() => {
            isLongPressRef.current = true;
            if (urlToUse) window.open(urlToUse, '_blank');
            if (typeof window !== 'undefined' && window.navigator && window.navigator.vibrate) {
                window.navigator.vibrate(50);
            }
        }, 600);
    }, [urlToUse]);

    const cancelPress = React.useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    if (!urlToUse) return <p>{message.content || 'Mídia inválida'}</p>;

    const renderMedia = () => {
        if (effectiveMimeType.startsWith('image/')) {
            return (
                <MediaViewer src={urlToUse} type="image" alt={message.content || fileName || 'Imagem enviada'} fileName={fileName} chatId={message.chat_id}>
                    <div
                        className="group relative w-[min(78vw,320px)] max-w-full cursor-pointer overflow-hidden rounded-xl border border-black/10 bg-black/10 shadow-sm dark:border-white/10"
                        onMouseDown={startPress}
                        onMouseUp={cancelPress}
                        onMouseLeave={cancelPress}
                        onTouchStart={startPress}
                        onTouchEnd={cancelPress}
                        onClick={(e) => {
                            if (isLongPressRef.current) {
                                e.preventDefault();
                                e.stopPropagation();
                            }
                        }}
                    >
                        <SafeMediaImage
                            src={urlToUse}
                            alt={message.content || fileName || 'Imagem enviada'}
                            width={320}
                            height={320}
                            className="block max-h-[420px] w-full object-cover transition-transform duration-300 group-hover:scale-[1.025]"
                        />
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-black/65 via-black/15 to-transparent px-3 pb-2 pt-10 text-white">
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-white/90">
                                <ImageIcon className="h-3.5 w-3.5" />
                                Imagem
                            </span>
                            <span className="text-[10px] text-white/70">Toque para ampliar</span>
                        </div>
                    </div>
                </MediaViewer>
            );
        }

        if (effectiveMimeType.startsWith('video/')) {
            return (
                <MediaViewer src={urlToUse} type="video" alt={message.content || fileName || 'Vídeo enviado'} fileName={fileName} chatId={message.chat_id}>
                    <div className="group relative aspect-video w-[min(78vw,320px)] max-w-full cursor-pointer overflow-hidden rounded-xl border border-black/10 bg-black/20 shadow-sm dark:border-white/10">
                        <VideoThumbnail
                            videoSrc={urlToUse}
                            thumbnailSrc={safeThumbnail || undefined}
                            className="h-full w-full object-cover brightness-[0.82] transition-all duration-300 group-hover:scale-[1.025] group-hover:brightness-[0.72]"
                        />
                        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                            <div className="rounded-full border border-white/25 bg-black/70 p-3">
                                <PlayCircle className="h-8 w-8 fill-white/15 text-white" />
                            </div>
                        </div>
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-center justify-between gap-3 bg-gradient-to-t from-black/70 via-black/20 to-transparent px-3 pb-2 pt-10 text-white">
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-white/90">
                                <Video className="h-3.5 w-3.5" />
                                Vídeo
                            </span>
                            <span className="rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-medium text-white/90">
                                {duration ? formatDuration(duration) : 'Reproduzir'}
                            </span>
                        </div>
                    </div>
                </MediaViewer>
            );
        }

        if (effectiveMimeType.startsWith('audio/')) {
            return <AudioPlayer
                src={mediaAssetUrl}
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
                href={mediaAssetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-[300px] max-w-full min-w-0 items-center gap-3 rounded-lg bg-muted/50 p-3 transition-colors hover:bg-muted/80 dark:bg-white/10 dark:hover:bg-white/20"
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
        <div className="flex max-w-full min-w-0 flex-col gap-2">
            {renderMedia()}
            {message.content && (
                <p
                    className={cn(
                        "whitespace-pre-wrap break-words rounded-xl px-3 py-2 text-sm leading-relaxed shadow-sm [overflow-wrap:anywhere]",
                        message.from_me
                            ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white"
                            : "border border-slate-200/80 bg-white text-slate-800 dark:border-white/10 dark:bg-[#111318] dark:text-zinc-100"
                    )}
                    dangerouslySetInnerHTML={{ __html: formatWhatsappText(message.content, { isOutgoing: Boolean(message.from_me) }) }}
                />
            )}
        </div>
    )
}

type TemplateOrderDetails = {
    currency?: string;
    total_amount?: { value?: number; offset?: number };
    order?: {
        items?: Array<{
            name?: string;
            amount?: { value?: number; offset?: number };
            quantity?: number;
        }>;
    };
    payment_settings?: Array<{ type?: string }>;
};

function getTemplateOrderDetails(message: Message): TemplateOrderDetails | undefined {
    const orderDetailsComponent = message.metadata?.templateComponents?.find((component) =>
        component.type?.toLowerCase() === 'button' &&
        component.sub_type?.toLowerCase() === 'order_details'
    );

    return orderDetailsComponent?.parameters?.find((parameter) => parameter.action?.order_details)?.action?.order_details;
}

function formatTemplateAmount(amount: { value?: number; offset?: number } | undefined, currency = 'BRL'): string | undefined {
    const value = Number(amount?.value);
    const offset = Number(amount?.offset) || 100;
    if (!Number.isFinite(value) || !Number.isFinite(offset) || offset === 0) return undefined;

    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency,
    }).format(value / offset);
}

function TemplateOrderDetailsPreview({ details, isFromMe }: { details: TemplateOrderDetails; isFromMe: boolean }) {
    const firstItem = details.order?.items?.[0];
    const amount = formatTemplateAmount(details.total_amount || firstItem?.amount, details.currency || 'BRL');
    const isPix = details.payment_settings?.some((setting) => setting.type === 'pix_dynamic_code');

    return (
        <div className={cn(
            'mt-3 overflow-hidden rounded-xl border text-xs',
            isFromMe ? 'border-white/20 bg-white/10' : 'border-border bg-background/60 dark:border-white/10 dark:bg-black/20'
        )}>
            <div className="space-y-2 p-3">
                <div className="flex items-center gap-2 font-medium">
                    <FileIcon className="h-4 w-4" />
                    <span>{isPix ? 'Pagamento via PIX' : 'Detalhes do pedido'}</span>
                </div>
                {firstItem?.name && (
                    <p className={cn('truncate', isFromMe ? 'text-white/80' : 'text-muted-foreground')}>
                        {firstItem.name}
                    </p>
                )}
                {amount && (
                    <div className="flex items-center justify-between gap-4 font-semibold">
                        <span>Total</span>
                        <span>{amount}</span>
                    </div>
                )}
            </div>
            <div className={cn(
                'flex items-center justify-center gap-2 border-t px-3 py-2 font-medium',
                isFromMe ? 'border-white/20 text-white' : 'border-border text-primary dark:border-white/10'
            )}>
                <Copy className="h-3.5 w-3.5" />
                <span>{isPix ? 'Copiar codigo PIX' : 'Ver detalhes do pedido'}</span>
            </div>
        </div>
    );
}

interface MessageItemProps {
    message: Message;
    quotedMessage?: Message;
    prevMessage?: Message;
    workspaceTimezone: string;
    onDelete: (messageId: string, instanceName?: string) => void;
    currentUserId: string;
    instanceName?: string;
    onForward?: (message: Message) => void;
    onRetry?: (message: Message) => void;
}

const MessageItem = memo(({ message, quotedMessage, prevMessage, workspaceTimezone, onDelete, currentUserId, instanceName, onForward, onRetry }: MessageItemProps) => {
    const { toast } = useToast();

    const resolveDayLabel = (msg?: Message): string => {
        if (!msg) return '';
        const createdAt = new Date(msg.createdAt);
        if (Number.isNaN(createdAt.getTime())) {
            return msg.formattedDate || '';
        }
        return formatMessageDate(createdAt, workspaceTimezone);
    };

    const messageDayLabel = resolveDayLabel(message);
    const prevMessageDayLabel = resolveDayLabel(prevMessage);
    const showDateSeparator = !prevMessage || messageDayLabel !== prevMessageDayLabel;

    const isFromMe = !!message.from_me;
    const isDeleted = message.status === 'deleted';
    const status = (message.api_message_status || '').toUpperCase();
    const isFailed = status === 'FAILED' || status === 'ERROR';
    const isInternalNote = message.metadata?.isInternalNote;
    const isAiAnalysis = message.metadata?.isAiAnalysis;
    const isToolExecution = message.metadata?.isToolExecution;
    const isPrearmedTool = isToolExecution && message.metadata?.agentToolStatus === 'prearmed';
    const messageMimeType = message.metadata?.mimetype?.toLowerCase() || '';
    const isVisualMediaMessage =
        !isDeleted &&
        !isInternalNote &&
        !isAiAnalysis &&
        !isToolExecution &&
        (
            message.type === 'image' ||
            message.type === 'video' ||
            messageMimeType.startsWith('image/') ||
            messageMimeType.startsWith('video/')
        );
    const failureDetails = normalizeFailureDetails(message);
    const replyPreview = resolveReplyPreview(message, quotedMessage);
    const statusTitle = isFailed
        ? `Falha ao enviar: ${failureDetails.summary}`
        : (message.api_message_status || 'Sem status');
    const failedCapturedAtLabel = (() => {
        if (!failureDetails.capturedAt) return undefined;
        const parsed = new Date(failureDetails.capturedAt);
        if (Number.isNaN(parsed.getTime())) return undefined;
        return formatInTimeZone(parsed, workspaceTimezone, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
    })();
    const senderName = message.sender?.name || (isFromMe ? 'Você' : 'Contato');
    const senderAvatar = (message.sender as any)?.avatar || (message.sender as any)?.avatar_url || undefined;
    const senderInitial = senderName.trim().charAt(0).toUpperCase() || '?';
    const timeLabel = (() => {
        const createdAt = new Date(message.createdAt);
        if (!Number.isNaN(createdAt.getTime())) {
            return formatInTimeZone(createdAt, workspaceTimezone, 'HH:mm', { locale: ptBR });
        }

        if (typeof message.timestamp === 'string' && message.timestamp.trim().length > 0) {
            const parsedTimestamp = new Date(message.timestamp);
            if (!Number.isNaN(parsedTimestamp.getTime())) {
                return formatInTimeZone(parsedTimestamp, workspaceTimezone, 'HH:mm', { locale: ptBR });
            }

            return message.timestamp;
        }

        return '--:--';
    })();

    const renderMessageContent = (message: Message, isFromMe = false) => {
        const orderDetails = getTemplateOrderDetails(message);
        const hasSharedContacts =
            (Array.isArray(message.metadata?.sharedContacts) && message.metadata.sharedContacts.length > 0) ||
            !!message.metadata?.sharedContactName ||
            (Array.isArray(message.metadata?.sharedContactPhones) && message.metadata.sharedContactPhones.length > 0);

        if (hasSharedContacts) {
            return <SharedContactMessage message={message} />;
        }

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

        if (!message.content?.trim() && !orderDetails) {
            return <span className="text-xs italic text-muted-foreground">Mensagem sem conteúdo</span>;
        }

        return (
            <div className="min-w-0">
                {message.content?.trim() && (
                    <p
                        className="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]"
                        dangerouslySetInnerHTML={{ __html: formatWhatsappText(message.content, { isOutgoing: isFromMe }) }}
                    />
                )}
                {orderDetails && <TemplateOrderDetailsPreview details={orderDetails} isFromMe={isFromMe} />}
            </div>
        );
    };

    return (
        <React.Fragment>
            {showDateSeparator && (
                <div className="relative my-5">
                    <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-border/50"></div>
                    </div>
                    <div className="relative flex justify-center">
                        <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-medium text-slate-500 dark:border-white/10 dark:bg-[#111318] dark:text-white/60">{messageDayLabel || message.formattedDate}</span>
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
                        <Avatar className="h-8 w-8 shrink-0 border border-slate-200/80 bg-white shadow-sm dark:border-white/10 dark:bg-[#0B0B10]">
                            <AvatarImage fallbackOnBlank src={senderAvatar} alt={senderName} data-ai-hint="person" />
                            <AvatarFallback className="bg-slate-100 text-slate-600 text-xs font-medium dark:bg-zinc-900 dark:text-zinc-300">{senderInitial}</AvatarFallback>
                        </Avatar>
                        <div className={cn("flex min-w-0 flex-1 flex-col", isFromMe ? 'items-end' : 'items-start')}>
                            <div className={cn("flex w-full min-w-0 items-end gap-1", isFromMe ? 'flex-row-reverse' : 'flex-row')}>
                                <div
                                    data-message-bubble
                                    data-message-direction={isFromMe ? 'outgoing' : 'incoming'}
                                    className={cn(
                                        "relative w-fit min-w-0 max-w-[88%] break-words [overflow-wrap:anywhere] sm:max-w-[78%] md:max-w-[min(72%,560px)]",
                                        !isVisualMediaMessage && "rounded-[18px] p-3 shadow-[0_8px_24px_-22px_rgba(15,23,42,0.45)] md:p-3.5",
                                        isDeleted
                                            ? 'border border-border/50 bg-muted/30 italic text-muted-foreground'
                                            : isPrearmedTool
                                                ? 'border border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-200'
                                            : isToolExecution
                                                ? 'border border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-200'
                                            : isAiAnalysis
                                                ? 'border border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
                                            : isInternalNote
                                                    ? 'border border-yellow-500/20 bg-yellow-500/10 text-yellow-700'
                                                : isVisualMediaMessage
                                                    ? ''
                                                : (isFromMe
                                                    ? 'rounded-tr-md border border-blue-500/20 bg-blue-600 text-white'
                                                    : 'rounded-tl-sm border border-slate-200 bg-white text-slate-800 dark:border-white/10 dark:bg-[#111318] dark:text-zinc-100')
                                    )}
                                >
                                    {(isInternalNote || isAiAnalysis || isToolExecution) && (
                                        <div className={cn(
                                            "flex items-center gap-1 text-xs mb-1 font-medium uppercase tracking-wider",
                                            isPrearmedTool
                                                ? "text-violet-500/80"
                                            : isToolExecution
                                                ? "text-sky-500/80"
                                                : isAiAnalysis
                                                    ? "text-emerald-500/80"
                                                    : "text-yellow-500/70"
                                        )}>
                                            <StickyNote className="h-3 w-3" /> {isToolExecution ? 'Execução de Tool' : isAiAnalysis ? 'Análise Inteligente' : 'Nota Interna'}
                                        </div>
                                    )}
                                    {!isDeleted && replyPreview && (
                                        <div
                                            className={cn(
                                                "mb-2 rounded-xl border-l-2 px-2 py-1",
                                                isFromMe
                                                    ? 'border-white/80 bg-white/20 text-white'
                                                    : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200'
                                            )}
                                        >
                                            <p
                                                className={cn(
                                                    "text-[10px] uppercase tracking-wide font-semibold",
                                                    isFromMe ? 'text-white/85' : 'text-blue-600 dark:text-blue-300'
                                                )}
                                            >
                                                {replyPreview.author}
                                            </p>
                                            <p className={cn("text-xs line-clamp-2", isFromMe ? 'text-white' : 'text-slate-600 dark:text-zinc-300')}>
                                                {replyPreview.content}
                                            </p>
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
                                className={cn("mt-1.5 flex items-center text-[11px] font-medium text-slate-500 dark:text-zinc-500", isFromMe ? 'flex-row-reverse gap-1.5' : 'flex-row gap-1.5')}
                                title={statusTitle}
                            >
                                <span className="mx-1">
                                    {timeLabel}
                                </span>
                                {message.from_me && !isDeleted && (
                                    <div className="flex items-center gap-1">
                                        {isFailed ? (
                                            <>
                                                <TooltipProvider>
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <div className="inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-red-400">
                                                                <XCircle className="h-3 w-3" />
                                                                <span>Falha</span>
                                                            </div>
                                                        </TooltipTrigger>
                                                        <TooltipContent className="max-w-[340px] border-red-500/20 bg-red-950/90 text-red-50">
                                                            <div className="space-y-1">
                                                                <p className="text-xs font-semibold uppercase tracking-wide text-red-200">Falha de entrega</p>
                                                                <p className="text-xs leading-relaxed">{failureDetails.summary}</p>
                                                                {failureDetails.code !== undefined && (
                                                                    <p className="text-[11px] text-red-200/90">Código: {failureDetails.code}</p>
                                                                )}
                                                                {message.message_id_from_api && (
                                                                    <p className="text-[11px] text-red-200/80 break-all">ID API: {message.message_id_from_api}</p>
                                                                )}
                                                                {failedCapturedAtLabel && (
                                                                    <p className="text-[11px] text-red-200/80">Registrado em {failedCapturedAtLabel}</p>
                                                                )}
                                                                {failureDetails.source && (
                                                                    <p className="text-[10px] text-red-200/60 uppercase tracking-wide">Origem: {failureDetails.source}</p>
                                                                )}
                                                            </div>
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                                {onRetry && !isInternalNote && !isAiAnalysis && !isToolExecution && (
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
