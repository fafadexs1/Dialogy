'use client';

import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
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

    // Normalizar dados entre User e WorkspaceMember
    const name = member.name;
    const email = member.email;
    const avatar = member.avatar || ('avatar_url' in member ? member.avatar_url : '');
    const role = 'role' in member ? (typeof member.role === 'string' ? member.role : member.role?.name) : 'Agente';
    const team = 'team' in member ? member.team : null;
    const memberSince = member.memberSince ? new Date(member.memberSince) : new Date();

    // Mock data for visual appeal if real data is missing
    const responseTime = '2m';
    const satisfaction = '4.9';

    return (
        <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <SheetContent className="w-[400px] sm:w-[540px] p-0 border-l border-white/10 bg-[#0f1117] text-white">
                <SheetTitle className="sr-only">Perfil de {name}</SheetTitle>
                <div className="relative h-48 bg-gradient-to-b from-blue-600/20 to-[#0f1117]">
                    {/* Cover / Header Background */}
                    <div className="absolute inset-0 bg-[url('/grid-pattern.svg')] opacity-20" />

                    <div className="absolute -bottom-12 left-6">
                        <div className="relative">
                            <Avatar className="h-24 w-24 border-4 border-[#0f1117] shadow-xl">
                                <AvatarImage src={avatar} alt={name} className="object-cover" />
                                <AvatarFallback className="bg-blue-600 text-xl font-bold">{name.charAt(0)}</AvatarFallback>
                            </Avatar>
                            <div className={`absolute bottom-1 right-1 h-5 w-5 rounded-full border-4 border-[#0f1117] ${isOnline ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-gray-500'}`} />
                        </div>
                    </div>
                </div>

                <div className="mt-16 px-6 space-y-6">
                    <div className="space-y-1">
                        <h2 className="text-2xl font-bold">{name}</h2>
                        <div className="flex items-center gap-2 text-white/60 text-sm">
                            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-xs font-medium">
                                <Shield className="w-3 h-3" />
                                {role}
                            </span>
                            {team && (
                                <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-xs font-medium">
                                    <Users className="w-3 h-3" />
                                    {team}
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="p-3 rounded-xl bg-white/5 border border-white/10 flex flex-col items-center justify-center text-center gap-1">
                            <Clock className="w-5 h-5 text-blue-400 mb-1" />
                            <span className="text-sm font-medium">{responseTime}</span>
                            <span className="text-xs text-white/40">Tempo Médio</span>
                        </div>
                        <div className="p-3 rounded-xl bg-white/5 border border-white/10 flex flex-col items-center justify-center text-center gap-1">
                            <MessageSquare className="w-5 h-5 text-green-400 mb-1" />
                            <span className="text-sm font-medium">{satisfaction}/5</span>
                            <span className="text-xs text-white/40">Satisfação</span>
                        </div>
                    </div>

                    <div className="space-y-4 pt-4">
                        <h3 className="text-sm font-medium text-white/50 uppercase tracking-wider">Informações de Contato</h3>

                        <div className="space-y-3">
                            <div className="flex items-center gap-3 p-3 rounded-lg hover:bg-white/5 transition-colors group cursor-pointer">
                                <div className="h-10 w-10 rounded-full bg-blue-500/10 flex items-center justify-center group-hover:bg-blue-500/20 transition-colors">
                                    <Mail className="w-5 h-5 text-blue-400" />
                                </div>
                                <div>
                                    <p className="text-sm font-medium text-white/90">{email}</p>
                                    <p className="text-xs text-white/50">Endereço de E-mail</p>
                                </div>
                            </div>

                            {'phone' in member && member.phone && (
                                <div className="flex items-center gap-3 p-3 rounded-lg hover:bg-white/5 transition-colors group cursor-pointer">
                                    <div className="h-10 w-10 rounded-full bg-green-500/10 flex items-center justify-center group-hover:bg-green-500/20 transition-colors">
                                        <Phone className="w-5 h-5 text-green-400" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-white/90">{member.phone}</p>
                                        <p className="text-xs text-white/50">Telefone</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    <Separator className="bg-white/10" />

                    <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm text-white/60">
                            <Calendar className="w-4 h-4" />
                            <span>Membro desde {format(memberSince, "d 'de' MMMM 'de' yyyy", { locale: ptBR })}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-white/60">
                            <Globe className="w-4 h-4" />
                            <span>Fuso horário: Brasília (GMT-3)</span>
                        </div>
                    </div>
                </div>

                <div className="absolute bottom-6 left-6 right-6">
                    <Button className="w-full h-12 bg-white text-black hover:bg-gray-200 font-medium rounded-xl">
                        Fechar
                    </Button>
                </div>
            </SheetContent>
        </Sheet>
    );
}
