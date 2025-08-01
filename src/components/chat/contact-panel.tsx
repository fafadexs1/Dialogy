'use client';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { type User } from '@/lib/types';
import { Mail, Phone } from 'lucide-react';

interface ContactPanelProps {
  contact: User;
}

export default function ContactPanel({ contact }: ContactPanelProps) {
  const isOnline = contact.lastSeen === 'Online';
  return (
    <div className="hidden w-full max-w-xs flex-col border-l bg-card lg:flex">
      <div className="flex h-16 items-center border-b px-4">
        <h3 className="font-semibold">Informações do Contato</h3>
      </div>
      <div className="flex flex-col items-center p-6 text-center">
        <Avatar className="h-20 w-20 border">
          <AvatarImage src={contact.avatar} alt={contact.name} data-ai-hint="person" />
          <AvatarFallback>{contact.name.charAt(0)}</AvatarFallback>
        </Avatar>
        <h2 className="mt-4 text-xl font-bold">{contact.name}</h2>
        <p className="text-sm text-muted-foreground">{isOnline ? 
            <span className="flex items-center justify-center gap-1.5 text-green-600">
                <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                </span>
                Online
            </span> : 
            `Visto por último ${contact.lastSeen}`
        }</p>
      </div>
      <Separator />
      <div className="p-6 space-y-4 text-sm">
        {contact.email && (
            <div className="flex items-center gap-3">
            <Mail className="h-4 w-4 text-muted-foreground" />
            <span>{contact.email}</span>
            </div>
        )}
        {contact.phone && (
            <div className="flex items-center gap-3">
            <Phone className="h-4 w-4 text-muted-foreground" />
            <span>{contact.phone}</span>
            </div>
        )}
      </div>
      <Separator />
      <div className="p-6">
        <Button className="w-full" variant="outline">Ver Perfil Completo</Button>
      </div>
    </div>
  );
}
