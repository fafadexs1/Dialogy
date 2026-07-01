import React from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Chat, User, Tag } from '@/lib/types';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Phone,
    Mail,
    Hash,
    User as UserIcon,
    ArrowRightLeft,
    MessageSquarePlus,
    Copy,
    ExternalLink,
    Clock,
    Shield
} from 'lucide-react';
import { TransferChatDialog, ResumeConversationDialog } from './contact-panel';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface MobileContactPanelProps {
    isOpen: boolean;
    onClose: () => void;
    chat: (Chat & { unreadCount?: number }) | null;
    currentUser: User | null;
    onTransferSuccess: () => void;
    onContactUpdate: () => void;
}

export default function MobileContactPanel({
    isOpen,
    onClose,
    chat,
    currentUser,
    onTransferSuccess,
    onContactUpdate
}: MobileContactPanelProps) {
    if (!chat) return null;

    const { contact } = chat;

    const copyToClipboard = (text: string, label: string) => {
        navigator.clipboard.writeText(text);
        // Toast logic would go here ideally
    };

    return (
        <Sheet open={isOpen} onOpenChange={onClose}>
            <SheetContent
                side="bottom"
                className="flex h-[90vh] flex-col gap-0 overflow-hidden rounded-t-[32px] border-t border-slate-200/80 bg-white/98 p-0 shadow-2xl backdrop-blur-3xl dark:border-white/10 dark:bg-[#050507]/98"
            >
                {/* Hidden Header for Accessibility */}
                <SheetHeader className="hidden">
                    <SheetTitle>Detalhes do Contato</SheetTitle>
                    <SheetDescription>Informações e ações do contato selecionado</SheetDescription>
                </SheetHeader>

                {/* Handle Bar */}
                <div className="w-full h-6 flex items-center justify-center pt-2 shrink-0">
                    <div className="h-1 w-10 rounded-full bg-border" />
                </div>

                {/* Hero Section */}
                <div className="flex flex-col items-center px-6 pb-8 pt-2 shrink-0 relative">
                    <div className="relative mb-4 group">
                        <div className="absolute -inset-0.5 bg-gradient-to-br from-blue-500/20 to-purple-500/20 rounded-full blur opacity-75 group-hover:opacity-100 transition duration-500"></div>
                        <Avatar className="relative h-24 w-24 border-2 border-slate-200/80 bg-white ring-1 ring-slate-200/70 shadow-2xl dark:border-white/10 dark:bg-[#0B0B10] dark:ring-2 dark:ring-black/30">
                            <AvatarImage fallbackOnBlank src={contact.avatar_url || undefined} className="object-cover" />
                            <AvatarFallback className="bg-slate-100 text-2xl font-light text-slate-600 dark:bg-zinc-900 dark:text-zinc-300">
                                {contact.name?.substring(0, 2).toUpperCase()}
                            </AvatarFallback>
                        </Avatar>
                        {chat.status === 'atendimentos' && (
                            <div className="absolute bottom-1 right-1 h-5 w-5 rounded-full border-2 border-background bg-green-500 shadow-lg" />
                        )}
                    </div>

                    <h2 className="mb-1 text-center text-2xl font-medium tracking-tight text-foreground">
                        {contact.name || contact.phone || "Contato Desconhecido"}
                    </h2>

                    {contact.email && (
                        <p className="mb-4 text-sm font-light tracking-wide text-muted-foreground">
                            {contact.email}
                        </p>
                    )}

                    {/* Action Grid */}
                    <div className="grid grid-cols-2 gap-3 w-full max-w-xs mt-4">
                        <TransferChatDialog
                            chat={chat}
                            currentUser={currentUser}
                            onTransferSuccess={() => { onTransferSuccess(); onClose(); }}
                            trigger={
                                <Button
                                    variant="outline"
                                    className="group flex h-14 flex-col items-center justify-center gap-1 rounded-xl border border-border bg-background transition-all hover:bg-muted hover:border-border"
                                >
                                    <ArrowRightLeft className="h-5 w-5 text-blue-400 group-hover:scale-110 transition-transform" />
                                    <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Transferir</span>
                                </Button>
                            }
                        />

                        {chat.status === 'encerrados' && (
                            <ResumeConversationDialog
                                chat={chat}
                                currentUser={currentUser}
                                onSuccess={() => { onTransferSuccess(); onClose(); }}
                                trigger={
                                    <Button
                                        variant="outline"
                                        className="group flex h-14 flex-col items-center justify-center gap-1 rounded-xl border border-border bg-background transition-all hover:bg-muted hover:border-border"
                                    >
                                        <MessageSquarePlus className="h-5 w-5 text-green-400 group-hover:scale-110 transition-transform" />
                                        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Reabrir</span>
                                    </Button>
                                }
                            />
                        )}
                    </div>
                </div>

                {/* Info List - Scrollable */}
                <div className="flex-1 overflow-y-auto px-6 pb-12">
                    <div className="space-y-6">
                        {/* Tags Section */}
                        {contact.tags && contact.tags.length > 0 && (
                            <div className="space-y-3">
                                <LabelSection>Etiquetas</LabelSection>
                                <div className="flex flex-wrap gap-2">
                                    {contact.tags.map((tag: Tag) => (
                                        <Badge
                                            key={tag.id}
                                            variant="secondary"
                                            className="border-border bg-muted/60 px-3 py-1 text-xs font-normal text-foreground hover:bg-muted"
                                            style={{
                                                borderLeft: `2px solid ${tag.color}`
                                            }}
                                        >
                                            {tag.label}
                                        </Badge>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Details List */}
                        <div className="space-y-4">
                            <LabelSection>Detalhes</LabelSection>
                            <div className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-inner dark:border-white/10 dark:bg-black/40">
                                <InfoItem
                                    icon={<Hash className="h-4 w-4 text-purple-400" />}
                                    label="Protocolo"
                                    value={chat.protocol || 'N/A'}
                                    copyable
                                />
                                <div className="h-px w-full bg-border" />
                                <InfoItem
                                    icon={<Phone className="h-4 w-4 text-green-400" />}
                                    label="Telefone"
                                    value={contact.phone || 'N/A'}
                                    copyable
                                />
                                {chat.updatedAt && (
                                    <>
                                        <div className="h-px w-full bg-border" />
                                        <InfoItem
                                            icon={<Clock className="h-4 w-4 text-orange-400" />}
                                            label="Última Atividade"
                                            value={format(new Date(chat.updatedAt), "d 'de' MMM, HH:mm", { locale: ptBR })}
                                        />
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Meta Info */}
                        {(chat.metaContactUsername || chat.metaContactExternalId) && (
                            <div className="space-y-4">
                                <LabelSection>Meta / Integração</LabelSection>
                                <div className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-4 dark:border-white/10 dark:bg-black/40">
                                    <InfoItem
                                        icon={<ExternalLink className="h-4 w-4 text-blue-400" />}
                                        label="Username"
                                        value={chat.metaContactUsername || 'N/A'}
                                        copyable
                                    />
                                    <InfoItem
                                        icon={<Shield className="h-4 w-4 text-yellow-400" />}
                                        label="ID Externo"
                                        value={chat.metaContactExternalId || 'N/A'}
                                        copyable
                                        truncate
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </SheetContent>
        </Sheet>
    );
}

function LabelSection({ children }: { children: React.ReactNode }) {
    return (
        <h3 className="pl-1 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
            {children}
        </h3>
    );
}

function InfoItem({ icon, label, value, copyable, truncate }: { icon: React.ReactNode, label: string, value: string, copyable?: boolean, truncate?: boolean }) {
    const handleCopy = () => {
        if (copyable) {
            navigator.clipboard.writeText(value);
            // toast here
        }
    };

    return (
        <div className="flex items-center justify-between group">
            <div className="flex items-center gap-3 overflow-hidden">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/50">
                    {icon}
                </div>
                <div className="flex flex-col overflow-hidden">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
                    <span className={cn(
                        "text-sm font-medium text-foreground",
                        truncate && "truncate max-w-[150px]"
                    )}>{value}</span>
                </div>
            </div>
            {copyable && (
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleCopy}
                    className="h-8 w-8 text-muted-foreground opacity-0 transition-all hover:bg-muted hover:text-foreground group-hover:opacity-100"
                >
                    <Copy className="h-3.5 w-3.5" />
                </Button>
            )}
        </div>
    );
}
