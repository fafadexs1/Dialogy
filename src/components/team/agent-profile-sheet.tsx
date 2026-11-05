'use client';

import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { type User, type WorkspaceMember } from '@/lib/types';
import { ArrowUpRight, CalendarDays, Clock3, Mail, Phone, ShieldCheck, Users } from 'lucide-react';
import { format, formatDistanceToNow, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { sendTeamReaction } from '@/actions/team-reactions';
import { REACTIONS, type ReactionKind } from '@/lib/team-reactions/catalog';
import { listWorkspaceGifs } from '@/actions/workspace-gifs';
import type { WorkspaceGif } from '@/lib/team-reactions/gifs';
import { useCurrentUser } from '@/hooks/use-online-status';
import { useToast } from '@/hooks/use-toast';

interface AgentProfileSheetProps {
    member: User | WorkspaceMember | null;
    isOpen: boolean;
    onClose: () => void;
    isOnline?: boolean;
    joinedAt?: string;
}

export function AgentProfileSheet({ member, isOpen, onClose, isOnline, joinedAt }: AgentProfileSheetProps) {
    const reducedMotion = useReducedMotion();
    const currentUser = useCurrentUser();
    const {toast} = useToast();
    const [sending, setSending] = useState<string | null>(null);
    const [gifs, setGifs] = useState<WorkspaceGif[]>([]);
    const [gifError, setGifError] = useState('');
    useEffect(() => {
        if (!isOpen || !currentUser?.activeWorkspaceId) return;
        let active = true;
        setGifError('');
        listWorkspaceGifs(currentUser.activeWorkspaceId).then(result => { if (active) { setGifs(result.gifs); setGifError(result.error || ''); } }).catch(() => { if (active) { setGifs([]); setGifError('Não foi possível carregar os GIFs.'); } });
        return () => { active = false; };
    }, [isOpen, currentUser?.activeWorkspaceId]);
    const [reactionMessage, setReactionMessage] = useState('');
    const [personalMessage, setPersonalMessage] = useState('');
    async function sendReaction(kind: ReactionKind | 'gif', gifId?: string) {
        if (!member || !currentUser?.activeWorkspaceId || sending) return;
        setSending(gifId || kind); setReactionMessage('');
        try {
            const result = await sendTeamReaction({ workspaceId: currentUser.activeWorkspaceId, targetId: member.id, kind, message: personalMessage, ...(gifId ? {gifId} : {}) });
            setReactionMessage(result.success ? 'Enviado! A surpresa está a caminho ✨' : result.error || 'Não foi possível enviar.');
            if (result.success) { setPersonalMessage(''); toast({title:'Surpresa enviada!',description:'O serviço aceitou o envio; a exibição depende da conexão da pessoa.'}); }
            else toast({title:'Não foi possível enviar',description:result.error || 'Tente novamente.',variant:'destructive'});
        } catch { setReactionMessage('Não foi possível enviar agora.'); toast({title:'Não foi possível enviar',description:'Verifique sua conexão e tente novamente.',variant:'destructive'}); }
        finally { setSending(null); }
    }
    const [now, setNow] = useState(0);
    useEffect(() => {
        if (!isOpen) return;
        const update = () => setNow(Date.now());
        update();
        const timer = setInterval(update, 60000);
        return () => clearInterval(timer);
    }, [isOpen]);
    if (!member) return null;

    const name = member.name || 'Pessoa da equipe';
    const avatar = member.avatar || ('avatar_url' in member ? member.avatar_url : '');
    const role = typeof member.role === 'string' ? member.role : member.role?.name;
    const team = member.team;
    const phone = 'phone' in member ? member.phone : undefined;
    const joinedDate = joinedAt ? new Date(joinedAt) : null;
    const memberDate = member.memberSince ? parseISO(member.memberSince) : null;
    const since = now && joinedDate && !Number.isNaN(joinedDate.getTime()) ? formatDistanceToNow(joinedDate, { addSuffix: true, locale: ptBR }) : null;
    const entrance = reducedMotion ? {} : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.45, ease: 'easeOut' as const } };

    return (
        <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <SheetContent aria-describedby="agent-profile-description" className="w-[min(100vw,400px)] max-w-none overflow-y-auto border-l border-zinc-200 bg-white p-0 text-zinc-950 sm:max-w-[400px] dark:border-white/10 dark:bg-[#0d0d0f] dark:text-zinc-100">
                <SheetTitle className="sr-only">Perfil de {name}</SheetTitle>
                <SheetDescription id="agent-profile-description" className="sr-only">Presença e informações de contato da pessoa da equipe.</SheetDescription>
                <motion.div {...entrance} className="relative min-h-full">
                    <div className="px-7 pt-8">
                        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.2em] text-zinc-400 dark:text-zinc-500"><span className="h-px w-5 bg-zinc-300 dark:bg-zinc-600" />Equipe / Perfil</div>
                        <div className="relative mt-8 flex flex-col items-center text-center">
                            <div aria-hidden="true" className="pointer-events-none absolute top-[-20px] h-36 w-36 rounded-full border border-zinc-100 dark:border-white/[.05]" />
                            <div aria-hidden="true" className="pointer-events-none absolute top-[-12px] h-32 w-32 rounded-full border border-dashed border-zinc-200/80 motion-safe:animate-[spin_30s_linear_infinite] dark:border-white/10" />
                            <div className="relative mt-1">
                                <Avatar className="h-24 w-24 border-[4px] border-white shadow-[0_12px_32px_rgba(0,0,0,.12)] ring-1 ring-zinc-200 dark:border-[#0d0d0f] dark:ring-white/15"><AvatarImage fallbackOnBlank src={avatar} alt={name} className="object-cover" /><AvatarFallback className="bg-zinc-800 text-2xl font-medium text-white dark:bg-zinc-700">{name.charAt(0).toUpperCase()}</AvatarFallback></Avatar>
                                <span className={`absolute bottom-0 right-0 h-5 w-5 rounded-full border-[4px] border-white dark:border-[#0d0d0f] ${isOnline ? 'bg-emerald-500' : 'bg-zinc-400'}`} />
                            </div>
                            <div className="mt-7 inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-[10px] font-semibold text-zinc-600 dark:border-white/10 dark:bg-white/[.04] dark:text-zinc-300"><span className={`h-1.5 w-1.5 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-zinc-400'}`} />{isOnline ? 'Online agora' : 'Presença indisponível'}</div>
                            <h2 className="mt-3 max-w-full break-words text-[25px] font-semibold leading-tight tracking-[-.035em]">{name}</h2>
                            <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">{role || 'Pessoa da equipe'}{team ? ` · ${team}` : ''}</p>
                        </div>
                    </div>
                    <div className="mt-7 px-6 pb-8">
                        <div className="flex items-center gap-3 rounded-2xl border border-zinc-200/80 bg-zinc-50/80 p-4 dark:border-white/[.08] dark:bg-white/[.035]">
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-zinc-500 shadow-sm ring-1 ring-zinc-100 dark:bg-white/[.06] dark:text-zinc-300 dark:ring-white/[.05]"><Clock3 className="h-[18px] w-[18px]" /></span>
                            <span className="min-w-0 flex-1"><span className="block text-[11px] text-zinc-500 dark:text-zinc-400">Presença nesta sessão</span><span className="mt-0.5 block text-sm font-semibold">{isOnline ? (since ? `Online ${since}` : 'Online agora') : 'Indisponível no momento'}</span></span>
                            {isOnline && <span className="relative flex h-2 w-2"><span className="absolute h-2 w-2 rounded-full bg-emerald-400 opacity-40 motion-safe:animate-ping" /><span className="relative h-2 w-2 rounded-full bg-emerald-500" /></span>}
                        </div>
                        {isOnline && <div className="mt-7 rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 via-white to-amber-50 p-4 dark:border-emerald-900/40 dark:from-emerald-950/30 dark:via-zinc-900 dark:to-amber-950/20">
                            <div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Uma pausa para sorrir ✨</h3><p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{currentUser?.id === member.id ? 'Teste uma surpresa na sua própria tela.' : `Mande uma surpresa animada para aparecer na tela de ${name.split(' ')[0]}.`}</p></div><span className="text-xl">💌</span></div>
                            <div className="mt-4"><label htmlFor="reaction-personal-message" className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">Mensagem opcional</label><textarea id="reaction-personal-message" value={personalMessage} onChange={event => setPersonalMessage(event.target.value)} maxLength={140} placeholder="Escreva algo carinhoso ou divertido..." rows={2} className="mt-1.5 w-full resize-none rounded-xl border border-emerald-100 bg-white/80 px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-emerald-400 dark:border-white/10 dark:bg-zinc-900"/><p className="text-right text-[10px] text-zinc-400">{personalMessage.length}/140</p></div>
                            <div className="mt-4 grid grid-cols-4 gap-2">{(Object.keys(REACTIONS) as ReactionKind[]).map(kind => <button type="button" key={kind} disabled={!!sending} onClick={() => void sendReaction(kind)} title={REACTIONS[kind].description} className="group flex min-w-0 flex-col items-center gap-1 rounded-xl border border-white bg-white/80 px-1 py-2.5 shadow-sm transition hover:-translate-y-1 hover:shadow-md disabled:opacity-50 motion-reduce:transform-none dark:border-white/10 dark:bg-white/5"><span className="text-2xl transition group-hover:scale-125 motion-reduce:transform-none">{REACTIONS[kind].emoji}</span><span className="truncate text-[10px] font-semibold text-zinc-600 dark:text-zinc-300">{kind === 'pum' ? 'Pum!' : kind === 'applause' ? 'Aplausos' : kind === 'party' ? 'Festa' : 'Café'}</span></button>)}</div>
                            {gifs.length > 0 && <div className="mt-4"><p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">GIFs da equipe</p><div className="grid max-h-52 grid-cols-3 gap-2 overflow-y-auto">{gifs.map(gif => <button type="button" key={gif.id} disabled={!!sending} onClick={() => void sendReaction('gif',gif.id)} title={`Enviar ${gif.name}`} className="group overflow-hidden rounded-xl border border-white bg-white/80 text-left shadow-sm disabled:opacity-50 dark:border-white/10 dark:bg-white/5"><img src={gif.url} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-20 w-full object-cover transition group-hover:scale-105 motion-reduce:transform-none"/><span className="block truncate px-2 py-1.5 text-[10px] font-medium">{gif.name}</span></button>)}</div></div>}
                            {gifError && <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">{gifError}</p>}
                            <p className="mt-3 text-[11px] text-zinc-500 dark:text-zinc-400" role="status">{reactionMessage || 'A surpresa pode tocar som na tela da pessoa.'}</p>
                        </div>}
                        <div className="mt-8"><div className="flex items-center gap-3"><h3 className="text-[10px] font-semibold uppercase tracking-[.17em] text-zinc-400 dark:text-zinc-500">Sobre</h3><span className="h-px flex-1 bg-zinc-100 dark:bg-white/[.08]" /></div>
                            <div className="mt-2 divide-y divide-zinc-100 dark:divide-white/[.07]">
                                <div className="flex items-center gap-3 py-3.5"><ShieldCheck className="h-4 w-4 shrink-0 text-zinc-400" /><span className="flex-1 text-xs text-zinc-500 dark:text-zinc-400">Perfil</span><span className="max-w-[60%] truncate text-right text-sm font-medium">{role || 'Não informado'}</span></div>
                                <div className="flex items-center gap-3 py-3.5"><Users className="h-4 w-4 shrink-0 text-zinc-400" /><span className="flex-1 text-xs text-zinc-500 dark:text-zinc-400">Equipe</span><span className="max-w-[60%] truncate text-right text-sm font-medium">{team || 'Não informada'}</span></div>
                                {memberDate && !Number.isNaN(memberDate.getTime()) && <div className="flex items-center gap-3 py-3.5"><CalendarDays className="h-4 w-4 shrink-0 text-zinc-400" /><span className="flex-1 text-xs text-zinc-500 dark:text-zinc-400">Na equipe desde</span><span className="text-right text-sm font-medium">{format(memberDate, "d 'de' MMMM 'de' yyyy", { locale: ptBR })}</span></div>}
                            </div>
                        </div>
                        <div className="mt-6"><div className="flex items-center gap-3"><h3 className="text-[10px] font-semibold uppercase tracking-[.17em] text-zinc-400 dark:text-zinc-500">Contato</h3><span className="h-px flex-1 bg-zinc-100 dark:bg-white/[.08]" /></div>
                            <div className="mt-3 space-y-2">{member.email ? <a href={`mailto:${member.email}`} className="group flex items-center gap-3 rounded-xl border border-zinc-200 p-3 transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:border-white/10 dark:hover:bg-white/[.05]"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 dark:bg-white/[.06] dark:text-zinc-400"><Mail className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block text-[10px] text-zinc-400">E-mail</span><span className="block truncate text-sm font-medium">{member.email}</span></span><ArrowUpRight className="h-4 w-4 text-zinc-400 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 motion-reduce:transform-none" /></a> : !phone && <p className="text-xs text-zinc-400">Nenhum contato informado.</p>}{phone && <a href={`tel:${phone}`} className="group flex items-center gap-3 rounded-xl border border-zinc-200 p-3 transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:border-white/10 dark:hover:bg-white/[.05]"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 dark:bg-white/[.06] dark:text-zinc-400"><Phone className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block text-[10px] text-zinc-400">Telefone</span><span className="block truncate text-sm font-medium">{phone}</span></span><ArrowUpRight className="h-4 w-4 text-zinc-400" /></a>}</div>
                        </div>
                    </div>
                </motion.div>
            </SheetContent>
        </Sheet>
    );
}
