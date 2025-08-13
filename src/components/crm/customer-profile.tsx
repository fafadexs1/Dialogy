

'use client';

import React, { useEffect, useState } from 'react';
import type { Contact, Tag, Activity, CustomFieldDefinition } from '@/lib/types';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '../ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Separator } from '../ui/separator';
import { Mail, Phone, Building, Briefcase, CheckSquare, Edit, PlusCircle, Tag as TagIcon, Globe, Clock, Smartphone } from 'lucide-react';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import { getTags, getCustomFieldDefinitions } from '@/actions/crm';
import { useAuth } from '@/hooks/use-auth';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface CustomerProfileProps {
    contact: Contact | null;
    isOpen: boolean;
    setIsOpen: (isOpen: boolean) => void;
    onAction: (action: 'edit' | 'addActivity', contact: Contact) => void;
    onMutate: () => void;
}

export default function CustomerProfile({ contact, isOpen, setIsOpen, onAction, onMutate }: CustomerProfileProps) {
    const user = useAuth();
    const [tags, setTags] = useState<Tag[]>([]);
    const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDefinition[]>([]);
    
    useEffect(() => {
        if(isOpen && user?.activeWorkspaceId) {
            getTags(user.activeWorkspaceId).then(res => setTags(res.tags || []));
            getCustomFieldDefinitions(user.activeWorkspaceId).then(res => setCustomFieldDefs(res.fields || []));
            onMutate(); // Re-fetch data when panel opens
        }
    }, [isOpen, user?.activeWorkspaceId, onMutate]);
    
    if (!contact) return null;
    
    const getTagStyle = (tagValue: string) => {
        const tag = tags.find(t => t.value === tagValue);
        return tag ? { backgroundColor: tag.color, color: tag.color.startsWith('#FEE2E2') || tag.color.startsWith('#FEF9C3') ? '#000' : '#fff', borderColor: 'transparent' } : {};
    };
    
    const customFieldsToDisplay = customFieldDefs.filter(def => contact.custom_fields && contact.custom_fields[def.id]);


    return (
        <Sheet open={isOpen} onOpenChange={setIsOpen}>
            <SheetContent className="sm:max-w-lg p-0">
                <div className="flex flex-col h-full">
                     <SheetHeader className="p-6 border-b">
                        <SheetTitle className="sr-only">Detalhes de {contact.name}</SheetTitle>
                        <SheetDescription className="sr-only">Exibindo detalhes para {contact.name}.</SheetDescription>
                         <div className="flex items-center mb-4 pt-4">
                            <Avatar className="h-16 w-16 mr-4">
                                <AvatarImage src={contact.avatar_url} alt={contact.name} />
                                <AvatarFallback className="text-2xl">{contact.name.charAt(0)}</AvatarFallback>
                            </Avatar>
                            <div>
                                <h2 className="text-xl font-bold">{contact.name}</h2>
                                {contact.owner && <p className='text-sm text-muted-foreground'>Proprietário: {contact.owner.name}</p>}
                            </div>
                        </div>
                         <div className="flex items-center gap-2">
                             <Button variant="outline" size="sm" onClick={() => onAction('edit', contact)}>
                                <Edit className="mr-2 h-4 w-4" /> Editar
                            </Button>
                             <Button size="sm" onClick={() => onAction('addActivity', contact)}>
                                <PlusCircle className="mr-2 h-4 w-4" /> Adicionar Atividade
                            </Button>
                        </div>
                    </SheetHeader>

                    <ScrollArea className="flex-1">
                        <div className="p-6 space-y-6">
                            {/* Contact Info */}
                            <section>
                                <h3 className="text-sm font-semibold text-primary mb-3">Informações de Contato</h3>
                                <div className="space-y-3 text-sm">
                                    {contact.email && (<div className="flex items-center gap-3"><Mail className="h-4 w-4 text-muted-foreground" /><span>{contact.email}</span></div>)}
                                    {contact.phone_number_jid && (<div className="flex items-center gap-3"><Smartphone className="h-4 w-4 text-muted-foreground" /><span>{contact.phone_number_jid}</span></div>)}
                                    {contact.address && (<div className="flex items-center gap-3"><Building className="h-4 w-4 text-muted-foreground" /><span>{contact.address}</span></div>)}
                                </div>
                            </section>

                            <Separator />
                            
                            {/* Tags */}
                            <section>
                                <h3 className="text-sm font-semibold text-primary mb-3">Etiquetas (Tags)</h3>
                                <div className="flex flex-wrap gap-2">
                                    {contact.tags?.map(tag => (
                                        <Badge key={tag.id} style={getTagStyle(tag.value)}>{tag.label}</Badge>
                                    ))}
                                     {(!contact.tags || contact.tags.length === 0) && (
                                        <p className="text-xs text-muted-foreground">Nenhuma tag adicionada.</p>
                                    )}
                                </div>
                            </section>
                            
                            <Separator />

                             {/* Custom Fields */}
                             {customFieldsToDisplay.length > 0 && (
                                <>
                                <section>
                                    <h3 className="text-sm font-semibold text-primary mb-3">Informações Adicionais</h3>
                                    <div className="space-y-3 text-sm">
                                        {customFieldsToDisplay.map(def => (
                                            <div key={def.id} className="flex flex-col">
                                                <span className="text-muted-foreground">{def.label}</span>
                                                <span className="font-medium">{contact.custom_fields?.[def.id]}</span>
                                            </div>
                                        ))}
                                    </div>
                                </section>
                                <Separator />
                                </>
                             )}
                            
                             {/* Activity History */}
                            <section>
                                <h3 className="text-sm font-semibold text-primary mb-3">Histórico de Atividades</h3>
                                <div className="space-y-3">
                                    {contact.activities && contact.activities.length > 0 ? (
                                        contact.activities.map((activity: Activity, index: number) => (
                                            <div key={activity.id || index} className="p-3 border rounded-lg bg-secondary/50 text-sm">
                                                <p className="font-semibold capitalize">{activity.type.replace(/-/g, ' ')}</p>
                                                <p className="text-muted-foreground mt-1">{activity.notes}</p>
                                                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
                                                    <Clock className="h-3 w-3" />
                                                    <span>{format(new Date(activity.date), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</span>
                                                </div>
                                            </div>
                                        ))
                                    ) : (
                                        <p className="text-xs text-muted-foreground p-2">Nenhuma atividade registrada.</p>
                                    )}
                                </div>
                            </section>
                        </div>
                    </ScrollArea>
                </div>
            </SheetContent>
        </Sheet>
    );
}
