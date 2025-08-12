
'use client';

import React from 'react';
import type { Contact } from '@/lib/types';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '../ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Separator } from '../ui/separator';
import { Mail, Phone, Building, Briefcase, CheckSquare, Edit, PlusCircle, Tag as TagIcon, Globe } from 'lucide-react';
import { Badge } from '../ui/badge';
import { mockTags } from '@/lib/mock-data';

interface CustomerProfileProps {
    contact: Contact | null;
    isOpen: boolean;
    setIsOpen: (isOpen: boolean) => void;
    onAction: (action: 'edit' | 'addActivity', contact: Contact) => void;
}

export default function CustomerProfile({ contact, isOpen, setIsOpen, onAction }: CustomerProfileProps) {
    if (!contact) return null;
    const { businessProfile } = contact;
    
    const getTagStyle = (tagValue: string) => {
        const tag = mockTags.find(t => t.value === tagValue);
        return tag ? { backgroundColor: tag.color, color: tag.color.startsWith('#FEE2E2') || tag.color.startsWith('#FEF9C3') ? '#000' : '#fff', borderColor: 'transparent' } : {};
    };

    return (
        <Sheet open={isOpen} onOpenChange={setIsOpen}>
            <SheetContent className="sm:max-w-lg p-0">
                <div className="flex flex-col h-full">
                    <SheetHeader className="p-6 border-b">
                         <SheetTitle className="sr-only">Detalhes do Contato</SheetTitle>
                         <SheetDescription className="sr-only">Exibindo detalhes para {contact.name}.</SheetDescription>
                         <div className="flex items-center mb-4">
                            <Avatar className="h-16 w-16 mr-4">
                                <AvatarImage src={contact.avatar} alt={contact.name} />
                                <AvatarFallback className="text-2xl">{contact.name.charAt(0)}</AvatarFallback>
                            </Avatar>
                            <div>
                                <h2 className="text-xl font-bold">{contact.name}</h2>
                                <p className="text-sm text-muted-foreground">{businessProfile?.companyName}</p>
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

                    <div className="flex-1 overflow-y-auto p-6 space-y-6">
                        {/* Contact Info */}
                        <section>
                            <h3 className="text-sm font-semibold text-primary mb-3">Informações de Contato</h3>
                            <div className="space-y-3 text-sm">
                                {contact.email && (<div className="flex items-center gap-3"><Mail className="h-4 w-4 text-muted-foreground" /><span>{contact.email}</span></div>)}
                                {contact.phone && (<div className="flex items-center gap-3"><Phone className="h-4 w-4 text-muted-foreground" /><span>{contact.phone}</span></div>)}
                                {businessProfile?.website && (<div className="flex items-center gap-3"><Globe className="h-4 w-4 text-muted-foreground" /><span>{businessProfile.website}</span></div>)}
                                {businessProfile?.companyName && (<div className="flex items-center gap-3"><Building className="h-4 w-4 text-muted-foreground" /><span>{businessProfile.companyName}</span></div>)}
                            </div>
                        </section>

                        <Separator />
                        
                        {/* Tags */}
                        <section>
                             <h3 className="text-sm font-semibold text-primary mb-3">Etiquetas (Tags)</h3>
                             <div className="flex flex-wrap gap-2">
                                {businessProfile?.tags.map(tag => (
                                    <Badge key={tag.id} style={getTagStyle(tag.value)}>{tag.label}</Badge>
                                ))}
                            </div>
                        </section>
                        
                        <Separator />

                        {/* Deals */}
                        <section>
                            <h3 className="text-sm font-semibold text-primary mb-3">Negócios</h3>
                            <div className="space-y-2">
                                {businessProfile?.deals && businessProfile.deals.length > 0 ? (
                                    businessProfile.deals.map(deal => (
                                        <div key={deal.id} className="p-3 border rounded-lg bg-secondary/50">
                                            <p className="font-semibold text-sm">{deal.name}</p>
                                            <div className="flex justify-between items-center text-xs mt-1">
                                                <span className="text-green-600 font-medium">{deal.value}</span>
                                                <Badge variant="outline" className="text-xs font-normal">{deal.stage}</Badge>
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <p className="text-xs text-muted-foreground p-2">Nenhum negócio ativo.</p>
                                )}
                            </div>
                        </section>

                        <Separator />

                         {/* Tasks */}
                         <section>
                             <h3 className="text-sm font-semibold text-primary mb-3">Tarefas</h3>
                             <div className="space-y-2">
                                {businessProfile?.tasks && businessProfile.tasks.length > 0 ? (
                                    businessProfile.tasks.map(task => (
                                        <div key={task.id} className="flex items-start gap-2 text-sm">
                                            <CheckSquare className={`h-4 w-4 mt-0.5 shrink-0 ${task.completed ? 'text-primary' : 'text-muted-foreground'}`}/>
                                            <p className={`font-medium ${task.completed ? 'line-through text-muted-foreground' : ''}`}>{task.description}</p>
                                        </div>
                                    ))
                                ) : (
                                    <p className="text-xs text-muted-foreground p-2">Nenhuma tarefa pendente.</p>
                                )}
                             </div>
                         </section>
                    </div>
                </div>
            </SheetContent>
        </Sheet>
    );
}