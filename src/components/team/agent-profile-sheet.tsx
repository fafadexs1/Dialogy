'use client';

import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { User, WorkspaceMember } from '@/lib/types';
import { Mail, Phone, Calendar, Shield, Users, MessageSquare, Clock, Globe } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface AgentProfileSheetProps {
    member: User | WorkspaceMember | null;
    isOpen: boolean;
    onClose: () => void;
    isOnline?: boolean;
}

export function AgentProfileSheet({ member, isOpen, onClose, isOnline }: AgentProfileSheetProps) {
    if (!member) return null;

    const name = member.name;
    const email = member.email;
    const avatar = member.avatar || ('avatar_url' in member ? member.avatar_url : '');
    const role = 'role' in member ? (typeof member.role === 'string' ? member.role : member.role?.name) : 'Agente';
    const team = 'team' in member ? member.team : null;
    const memberSince = member.memberSince ? new Date(member.memberSince) : new Date();

    const responseTime = '2m';
    const satisfaction = '4.9';

    return (
        <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <SheetContent className="w-[400px] border-l border-slate-200 bg-white p-0 text-slate-950 sm:w-[540px]">
                <SheetTitle className="sr-only">Perfil de {name}</SheetTitle>
                <div className="relative h-48 bg-gradient-to-b from-blue-50 via-white to-white">
                    <div className="absolute inset-0 bg-[url('/grid-pattern.svg')] opacity-10" />

                    <div className="absolute -bottom-12 left-6">
                        <div className="relative">
                            <Avatar className="h-24 w-24 border-4 border-white shadow-xl">
                                <AvatarImage src={avatar} alt={name} className="object-cover" />
                                <AvatarFallback className="bg-blue-600 text-xl font-bold text-white">{name.charAt(0)}</AvatarFallback>
                            </Avatar>
                            <div className={`absolute bottom-1 right-1 h-5 w-5 rounded-full border-4 border-white ${isOnline ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.35)]' : 'bg-slate-300'}`} />
                        </div>
                    </div>
                </div>

                <div className="mt-16 space-y-6 px-6">
                    <div className="space-y-1">
                        <h2 className="text-2xl font-bold">{name}</h2>
                        <div className="flex items-center gap-2 text-sm text-slate-500">
                            <span className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs font-medium">
                                <Shield className="h-3 w-3" />
                                {role}
                            </span>
                            {team && (
                                <span className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs font-medium">
                                    <Users className="h-3 w-3" />
                                    {team}
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
                            <Clock className="mb-1 h-5 w-5 text-blue-400" />
                            <span className="text-sm font-medium">{responseTime}</span>
                            <span className="text-xs text-slate-500">Tempo Medio</span>
                        </div>
                        <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
                            <MessageSquare className="mb-1 h-5 w-5 text-green-400" />
                            <span className="text-sm font-medium">{satisfaction}/5</span>
                            <span className="text-xs text-slate-500">Satisfacao</span>
                        </div>
                    </div>

                    <div className="space-y-4 pt-4">
                        <h3 className="text-sm font-medium uppercase tracking-wider text-slate-500">Informacoes de Contato</h3>

                        <div className="space-y-3">
                            <div className="group flex cursor-pointer items-center gap-3 rounded-lg p-3 transition-colors hover:bg-slate-50">
                                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-500/10 transition-colors group-hover:bg-blue-500/20">
                                    <Mail className="h-5 w-5 text-blue-400" />
                                </div>
                                <div>
                                    <p className="text-sm font-medium text-slate-900">{email}</p>
                                    <p className="text-xs text-slate-500">Endereco de E-mail</p>
                                </div>
                            </div>

                            {'phone' in member && member.phone && (
                                <div className="group flex cursor-pointer items-center gap-3 rounded-lg p-3 transition-colors hover:bg-slate-50">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-500/10 transition-colors group-hover:bg-green-500/20">
                                        <Phone className="h-5 w-5 text-green-400" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-slate-900">{member.phone}</p>
                                        <p className="text-xs text-slate-500">Telefone</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    <Separator className="bg-slate-200" />

                    <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm text-slate-500">
                            <Calendar className="h-4 w-4" />
                            <span>Membro desde {format(memberSince, "d 'de' MMMM 'de' yyyy", { locale: ptBR })}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-slate-500">
                            <Globe className="h-4 w-4" />
                            <span>Fuso horario: Brasilia (GMT-3)</span>
                        </div>
                    </div>
                </div>

                <div className="absolute bottom-6 left-6 right-6">
                    <Button className="h-12 w-full rounded-xl bg-slate-950 font-medium text-white hover:bg-slate-800" onClick={onClose}>
                        Fechar
                    </Button>
                </div>
            </SheetContent>
        </Sheet>
    );
}
