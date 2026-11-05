'use client';

import React, { useEffect, useState } from 'react';
import type { Contact, Tag, CustomFieldDefinition, Deal } from '@/lib/types';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '../ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Mail, Building, Edit, PlusCircle, Smartphone, Target, DollarSign, Loader2 } from 'lucide-react';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import { getTags, getCustomFieldDefinitions } from '@/actions/crm';
import { getDealsByContact } from '@/actions/deals';
import { useAuth } from '@/hooks/use-auth';
import ContactTimeline from './contact-timeline';
import DealForm from './deal-form';
import LeadScoreBadge from './lead-score-badge';
import { badgeColorStyle } from '@/lib/color-contrast';

interface CustomerProfileProps {
    contact: Contact | null;
    isOpen: boolean;
    setIsOpen: (isOpen: boolean) => void;
    onAction: (action: 'edit' | 'addActivity', contact: Contact) => void;
    onMutate: () => void;
}

function formatBRL(value: number): string {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function CustomerProfile({ contact, isOpen, setIsOpen, onAction, onMutate }: CustomerProfileProps) {
    const user = useAuth();
    const [tags, setTags] = useState<Tag[]>([]);
    const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDefinition[]>([]);
    const [deals, setDeals] = useState<Deal[]>([]);
    const [dealsLoading, setDealsLoading] = useState(false);
    const [dealFormOpen, setDealFormOpen] = useState(false);

    useEffect(() => {
        if (isOpen && user?.activeWorkspaceId) {
            getTags(user.activeWorkspaceId).then(res => setTags(res.tags || []));
            getCustomFieldDefinitions(user.activeWorkspaceId).then(res => setCustomFieldDefs(res.fields || []));
        }
        if (isOpen && contact?.id) {
            setDealsLoading(true);
            getDealsByContact(contact.id)
                .then(res => setDeals(res.deals || []))
                .finally(() => setDealsLoading(false));
        }
    }, [isOpen, user?.activeWorkspaceId, contact]);

    if (!contact) return null;

    const getTagStyle = (tagValue: string) => {
        const tag = tags.find(t => t.value === tagValue);
        const style = badgeColorStyle(tag?.color);
        return style ? { ...style, borderColor: 'transparent' } : {};
    };

    const customFieldsToDisplay = customFieldDefs.filter(def => contact.custom_fields && contact.custom_fields[def.id]);
    const openDeals = deals.filter(d => d.won === null || d.won === undefined);
    const closedDeals = deals.filter(d => d.won !== null && d.won !== undefined);
    const totalOpenValue = openDeals.reduce((sum, d) => sum + d.value, 0);

    return (
        <>
            <Sheet open={isOpen} onOpenChange={setIsOpen}>
                <SheetContent className="w-full border-l border-[#dfe8dd] bg-[#f6f8f4] p-0 sm:max-w-[560px] dark:border-white/10 dark:bg-[#0e1711]">
                    <div className="flex h-full flex-col">
                        <SheetHeader className="border-b border-[#dfe8dd] bg-[#133523] p-6 text-white dark:border-white/10">
                            <SheetTitle className="sr-only">Detalhes de {contact.name}</SheetTitle>
                            <SheetDescription className="sr-only">Exibindo detalhes para {contact.name}.</SheetDescription>
                            <p className="text-left text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-200/70">Perfil do contato</p>
                            <div className="mb-4 flex items-center pt-2">
                                <Avatar className="mr-4 h-16 w-16 border-2 border-white/30 shadow-lg">
                                    <AvatarImage src={contact.avatar_url || undefined} alt={contact.name} />
                                    <AvatarFallback className="bg-emerald-100 text-2xl font-semibold text-[#164e34]">{contact.name.charAt(0)}</AvatarFallback>
                                </Avatar>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h2 className="text-xl font-semibold tracking-tight text-white">{contact.name}</h2>
                                        <LeadScoreBadge score={contact.lead_score} size="md" />
                                    </div>
                                    {contact.owner && <p className="mt-1 text-sm text-emerald-100/65">Responsável: {contact.owner.name}</p>}
                                </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <Button variant="outline" size="sm" className="rounded-xl border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={() => onAction('edit', contact)}>
                                    <Edit className="mr-2 h-4 w-4" /> Editar
                                </Button>
                                <Button size="sm" className="rounded-xl bg-emerald-300 text-[#102f1d] hover:bg-emerald-200" onClick={() => onAction('addActivity', contact)}>
                                    <PlusCircle className="mr-2 h-4 w-4" /> Atividade
                                </Button>
                                <Button variant="outline" size="sm" className="rounded-xl border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={() => setDealFormOpen(true)}>
                                    <Target className="mr-2 h-4 w-4" /> Novo Deal
                                </Button>
                            </div>
                        </SheetHeader>

                        <ScrollArea className="flex-1">
                            <div className="space-y-5 p-6">
                                {/* Contact Info */}
                                <section className="rounded-2xl border border-[#e1e9df] bg-white p-5 dark:border-white/10 dark:bg-white/[0.04]">
                                    <h3 className="mb-3 text-sm font-semibold text-[#174f34] dark:text-emerald-300">Informações de contato</h3>
                                    <div className="space-y-3 text-sm">
                                        {contact.email && (<div className="flex items-center gap-3"><Mail className="h-4 w-4 text-muted-foreground" /><span>{contact.email}</span></div>)}
                                        {contact.phone_number_jid && (<div className="flex items-center gap-3"><Smartphone className="h-4 w-4 text-muted-foreground" /><span>{contact.phone_number_jid}</span></div>)}
                                        {contact.address && (<div className="flex items-center gap-3"><Building className="h-4 w-4 text-muted-foreground" /><span>{contact.address}</span></div>)}
                                    </div>
                                </section>


                                {/* Tags */}
                                <section className="rounded-2xl border border-[#e1e9df] bg-white p-5 dark:border-white/10 dark:bg-white/[0.04]">
                                    <h3 className="mb-3 text-sm font-semibold text-[#174f34] dark:text-emerald-300">Etiquetas</h3>
                                    <div className="flex flex-wrap gap-2">
                                        {contact.tags?.map(tag => (
                                            <Badge key={tag.id} style={getTagStyle(tag.value)}>{tag.label}</Badge>
                                        ))}
                                        {(!contact.tags || contact.tags.length === 0) && (
                                            <p className="text-xs text-muted-foreground">Nenhuma tag adicionada.</p>
                                        )}
                                    </div>
                                </section>


                                {/* Deals */}
                                <section className="rounded-2xl border border-[#e1e9df] bg-white p-5 dark:border-white/10 dark:bg-white/[0.04]">
                                    <div className="flex items-center justify-between mb-3">
                                        <h3 className="text-sm font-semibold text-[#174f34] dark:text-emerald-300">Negócios</h3>
                                        {totalOpenValue > 0 && (
                                            <Badge variant="outline" className="text-[10px] font-semibold text-emerald-600 border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-400">
                                                <DollarSign className="h-3 w-3 mr-0.5" />
                                                {formatBRL(totalOpenValue)}
                                            </Badge>
                                        )}
                                    </div>
                                    {dealsLoading ? (
                                        <div className="flex justify-center py-3">
                                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                        </div>
                                    ) : deals.length > 0 ? (
                                        <div className="space-y-2">
                                            {openDeals.map(deal => (
                                                <div key={deal.id} className="rounded-xl border border-[#e5ece3] bg-[#f8faf6] p-3 text-sm dark:border-white/10 dark:bg-white/[0.04]">
                                                    <div className="flex items-center justify-between">
                                                        <span className="font-medium">{deal.title}</span>
                                                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">{formatBRL(deal.value)}</span>
                                                    </div>
                                                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                                                        <Badge variant="secondary" className="text-[10px]">{deal.stage}</Badge>
                                                        <span>{deal.probability}% prob.</span>
                                                    </div>
                                                </div>
                                            ))}
                                            {closedDeals.length > 0 && (
                                                <details className="text-xs text-muted-foreground">
                                                    <summary className="cursor-pointer hover:text-foreground transition-colors py-1">
                                                        {closedDeals.length} deal(s) encerrado(s)
                                                    </summary>
                                                    <div className="space-y-1.5 mt-1.5">
                                                        {closedDeals.map(deal => (
                                                            <div key={deal.id} className="p-2 border rounded-lg bg-muted/30 flex justify-between items-center">
                                                                <span className={deal.won ? 'text-emerald-600' : 'text-red-500'}>{deal.title}</span>
                                                                <span>{formatBRL(deal.value)}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </details>
                                            )}
                                        </div>
                                    ) : (
                                        <p className="text-xs text-muted-foreground">Nenhum deal registrado.</p>
                                    )}
                                </section>


                                {/* Custom Fields */}
                                {customFieldsToDisplay.length > 0 && (
                                    <>
                                        <section className="rounded-2xl border border-[#e1e9df] bg-white p-5 dark:border-white/10 dark:bg-white/[0.04]">
                                            <h3 className="mb-3 text-sm font-semibold text-[#174f34] dark:text-emerald-300">Informações adicionais</h3>
                                            <div className="space-y-3 text-sm">
                                                {customFieldsToDisplay.map(def => (
                                                    <div key={def.id} className="flex flex-col">
                                                        <span className="text-muted-foreground">{def.label}</span>
                                                        <span className="font-medium">{contact.custom_fields?.[def.id]}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </section>
                                    </>
                                )}

                                {/* Timeline */}
                                <section className="rounded-2xl border border-[#e1e9df] bg-white p-5 dark:border-white/10 dark:bg-white/[0.04]">
                                    <h3 className="mb-3 text-sm font-semibold text-[#174f34] dark:text-emerald-300">Histórico</h3>
                                    <ContactTimeline contactId={contact.id} compact maxItems={20} />
                                </section>
                            </div>
                        </ScrollArea>
                    </div>
                </SheetContent>
            </Sheet>

            {/* Deal Form */}
            {user?.activeWorkspaceId && (
                <DealForm
                    isOpen={dealFormOpen}
                    setIsOpen={setDealFormOpen}
                    workspaceId={user.activeWorkspaceId}
                    contactId={contact.id}
                    contactName={contact.name}
                    onSaved={() => {
                        getDealsByContact(contact.id).then(res => setDeals(res.deals || []));
                        onMutate();
                    }}
                />
            )}
        </>
    );
}
