'use client';

import React, { useState, useEffect, useActionState } from 'react';
import type { Role, WorkspaceMember } from '@/lib/types';
import { Loader2, MoreHorizontal, Edit, UserX, AlertCircle, Users, Save, Copy, HeartHandshake, ChevronRight, UserPlus, ArrowUpRight, Search, ShieldCheck, SlidersHorizontal, X } from 'lucide-react';
import Link from 'next/link';
import { getWorkspaceMembers, removeMemberAction, updateMemberRoleAction } from '@/actions/members';
import { getRolesAndPermissions } from '@/actions/permissions';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator,
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
} from "@/components/ui/alert-dialog";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogFooter,
    DialogDescription,
    DialogClose
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { AlertDialogTrigger } from '@radix-ui/react-alert-dialog';
import { useFormStatus } from 'react-dom';
import { useCurrentUser } from '@/hooks/use-online-status';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { filterWorkspaceMembers, groupWorkspaceMembers, type MemberStatusFilter } from '@/lib/team-members';
import shared from '../team-page.module.css';
import styles from './members-page.module.css';

function EditRoleDialog({ member, workspaceId, roles, onMutate, children }: { member: WorkspaceMember, workspaceId: string, roles: Role[], onMutate: () => void, children: React.ReactNode }) {
    const [isOpen, setIsOpen] = useState(false);
    const [state, formAction] = useActionState(updateMemberRoleAction, { success: false, error: undefined });
    const { toast } = useToast();

    useEffect(() => {
        if (state.success) {
            toast({ title: "Função Atualizada!", description: `A função de ${member.name} foi alterada.` });
            setIsOpen(false);
            onMutate();
        } else if (state.error) {
            toast({ title: "Erro ao Atualizar", description: state.error, variant: 'destructive' });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state]);

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>{children}</DialogTrigger>
            <DialogContent className={shared.surface}>
                <DialogHeader>
                    <DialogTitle>Editar Função de {member.name}</DialogTitle>
                    <DialogDescription>Selecione a nova função para este membro.</DialogDescription>
                </DialogHeader>
                <form action={formAction}>
                    <input type="hidden" name="memberId" value={member.id} />
                    <input type="hidden" name="workspaceId" value={workspaceId} />
                    <div className="py-4">
                        <Label htmlFor="role">Função</Label>
                        <Select name="roleId" defaultValue={member.roleId}>
                            <SelectTrigger id="role">
                                <SelectValue placeholder="Selecione uma função" />
                            </SelectTrigger>
                            <SelectContent className={shared.surface}>
                                {roles.map(role => (
                                    <SelectItem key={role.id} value={role.id}>{role.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <DialogFooter>
                        <DialogClose asChild><Button type="button" variant="outline">Cancelar</Button></DialogClose>
                        <SubmitButton />
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

function SubmitButton() {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <Save className="mr-2 h-4 w-4" /> Salvar
        </Button>
    )
}

function MemberActions({ member, workspaceId, roles, onMutate }: { member: WorkspaceMember, workspaceId: string, roles: Role[], onMutate: () => void }) {
    const { toast } = useToast();

    const handleRemoveMember = async () => {
        const result = await removeMemberAction(member.id, workspaceId);
        if (result.error) {
            toast({ title: "Erro ao Remover", description: result.error, variant: "destructive" });
        } else {
            toast({ title: "Membro Removido", description: `${member.name} foi removido do workspace.` });
            onMutate();
        }
    };

    return (
        <AlertDialog>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label={`Ações de ${member.name}`} className={styles.actionsButton}>
                        <MoreHorizontal className="h-4 w-4" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className={cn(shared.surface, styles.actionMenu)}>
                    <EditRoleDialog member={member} workspaceId={workspaceId} roles={roles} onMutate={onMutate}>
                        <DropdownMenuItem onSelect={e => e.preventDefault()}>
                            <Edit className="mr-2 h-4 w-4" />
                            Editar Função
                        </DropdownMenuItem>
                    </EditRoleDialog>
                    <DropdownMenuItem onSelect={() => { void navigator.clipboard.writeText(member.id).then(() => toast({ title: 'ID copiado!' })).catch(() => toast({ title: 'Não foi possível copiar o ID', variant: 'destructive' })); }}>
                        <Copy className="mr-2 h-4 w-4" />
                        Copiar ID do membro
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <AlertDialogTrigger asChild>
                        <DropdownMenuItem className="text-destructive" onSelect={(e) => e.preventDefault()}>
                            <UserX className="mr-2 h-4 w-4" />
                            Remover do Workspace
                        </DropdownMenuItem>
                    </AlertDialogTrigger>
                </DropdownMenuContent>
            </DropdownMenu>
            <AlertDialogContent className={shared.surface}>
                <AlertDialogHeader>
                    <AlertDialogTitle>Tem certeza?</AlertDialogTitle>
                    <AlertDialogDescription>
                        Esta ação removerá <strong>{member.name}</strong> do workspace. Essa pessoa perderá o acesso e precisará de um novo convite para voltar.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={handleRemoveMember}>Remover</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}


export default function ManageMembersPage() {
    const user = useCurrentUser();
    const [members, setMembers] = useState<WorkspaceMember[]>([]);
    const [roles, setRoles] = useState<Role[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState<MemberStatusFilter>('all');
    const [roleFilter, setRoleFilter] = useState('all');

    const fetchData = React.useCallback(async (workspaceId: string) => {
        if (!workspaceId) return;
        setError(null);
        try {
            const [membersResult, rolesResult] = await Promise.all([
                getWorkspaceMembers(workspaceId),
                getRolesAndPermissions(workspaceId)
            ]);

            if (membersResult.error) {
                throw new Error(membersResult.error);
            }
            setMembers(membersResult.members || []);

            if (rolesResult.error) {
                throw new Error(rolesResult.error);
            }
            setRoles(rolesResult.roles || []);

        } catch (err: any) {
            setError(err.message || "Não foi possível buscar os dados.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (user?.activeWorkspaceId) {
            setLoading(true);
            fetchData(user.activeWorkspaceId);
        }
    }, [user?.activeWorkspaceId, fetchData]);

    if (loading || !user) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    const activeWorkspace = user?.workspaces?.find(ws => ws.id === user.activeWorkspaceId);

    const directory = groupWorkspaceMembers(members);
    const visibleMembers = filterWorkspaceMembers(directory, search, status, roleFilter);
    const onlineCount = directory.filter(member => member.online).length;
    const roleCount = new Set(directory.map(member => member.roleId).filter(Boolean)).size;
    const hasFilters = Boolean(search || status !== 'all' || roleFilter !== 'all');
    const clearFilters = () => { setSearch(''); setStatus('all'); setRoleFilter('all'); };

    return (
        <div className={cn(shared.page, shared.surface)}>
            <header className={shared.pageHeader}>
                <div className={shared.headerTop}>
                    <nav className={shared.breadcrumb} aria-label="Localização"><span>Workspace</span><ChevronRight size={12} /><Link href="/team">Equipes</Link><ChevronRight size={12} /><span aria-current="page">Membros</span></nav>
                    <span className={shared.headerLabel}><HeartHandshake size={14} /> Feito de pessoas</span>
                </div>
                <div className={shared.welcomeRow}>
                    <div><span className={shared.eyebrow}>CADA PESSOA IMPORTA</span><h1>Boas conexões têm<br className="hidden sm:block" /> pessoas por trás<span className={shared.titleDot}>.</span></h1><p>Conheça quem está com você e dê espaço para cada talento.</p></div>
                    <Button asChild className={shared.createButton}><Link href="/team/invite"><UserPlus size={17} /> Convidar pessoa <ArrowUpRight size={16} /></Link></Button>
                </div>
                <div className={shared.workspaceSummary}>
                    <span><Users size={15} /><strong>{directory.length}</strong> {directory.length === 1 ? 'pessoa no workspace' : 'pessoas no workspace'}</span>
                    <span><span className={styles.onlineDot} /><strong>{onlineCount}</strong> {onlineCount === 1 ? 'pessoa online' : 'pessoas online'}</span>
                    <span><ShieldCheck size={15} /><strong>{roleCount}</strong> {roleCount === 1 ? 'função' : 'funções'}</span>
                    <span className={shared.summaryHint}>{activeWorkspace?.name || 'Seu workspace'}</span>
                </div>
            </header>
            <main className={styles.content}>
                <div className={styles.directoryHeading}>
                    <div><h2>Pessoas do workspace</h2><p>Talentos diferentes. Um mesmo propósito.</p></div>
                    <Link href="/team" className={styles.textLink}>Organizar equipes <ArrowUpRight size={14} /></Link>
                </div>
                <section className={styles.directory} aria-label="Diretório de membros">
                    <div className={styles.toolbar}>
                        <div className={styles.searchField}><Search size={17} /><Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Encontre uma pessoa, equipe ou e-mail..." aria-label="Buscar membros" />{search && <Button variant="ghost" size="icon" aria-label="Limpar busca" onClick={() => setSearch('')}><X size={14} /></Button>}</div>
                        <Select value={roleFilter} onValueChange={setRoleFilter}>
                            <SelectTrigger className={styles.roleFilter} aria-label="Filtrar por função"><SlidersHorizontal size={14} /><SelectValue placeholder="Todas as funções" /></SelectTrigger>
                            <SelectContent className={shared.surface}><SelectItem value="all">Todas as funções</SelectItem>{roles.map(role => <SelectItem key={role.id} value={role.id}>{role.name}</SelectItem>)}</SelectContent>
                        </Select>
                    </div>
                    <div className={styles.statusBar}>
                        <div className={styles.statusFilters} role="group" aria-label="Filtrar por status">
                            <button type="button" aria-pressed={status === 'all'} onClick={() => setStatus('all')}>Todas as pessoas <span>{directory.length}</span></button>
                            <button type="button" aria-pressed={status === 'online'} onClick={() => setStatus('online')}><span className={styles.onlineDot} /> Online <span>{onlineCount}</span></button>
                            <button type="button" aria-pressed={status === 'offline'} onClick={() => setStatus('offline')}>Offline <span>{directory.length - onlineCount}</span></button>
                        </div>
                        {hasFilters && <Button variant="ghost" size="sm" className={styles.clearFilters} onClick={clearFilters}><X size={12} /> Limpar filtros</Button>}
                    </div>
                    {error ? (
                        <div className={styles.emptyState} role="alert"><span className={shared.emptyIcon}><AlertCircle size={27} /></span><h3>Não conseguimos reunir todo mundo</h3><p>{error}</p><Button onClick={() => user.activeWorkspaceId && fetchData(user.activeWorkspaceId)} variant="outline">Tentar novamente</Button></div>
                    ) : visibleMembers.length ? (
                        <Table className={styles.membersTable} aria-label="Pessoas do workspace">
                            <TableHeader><TableRow><TableHead>Pessoa</TableHead><TableHead>Status</TableHead><TableHead>Função</TableHead><TableHead>Equipe</TableHead><TableHead>Por aqui desde</TableHead><TableHead><span className="sr-only">Ações</span></TableHead></TableRow></TableHeader>
                            <TableBody>
                                {visibleMembers.map(member => (
                                    <TableRow key={member.id} className={styles.memberRow}>
                                        <TableCell className={styles.personCell}><div className={styles.person}>
                                            <Avatar className={styles.personAvatar}><AvatarImage src={member.avatar || undefined} alt={member.name} /><AvatarFallback>{member.name.split(' ').filter(Boolean).filter((_, i, parts) => i === 0 || i === parts.length - 1).map(part => part[0]).join('').slice(0, 2)}</AvatarFallback></Avatar>
                                            <div className={styles.personInfo}><div className={styles.personName}><span>{member.name}</span>{member.id === user.id && <span className={styles.youLabel}>Você</span>}</div><p>{member.email}</p></div>
                                        </div></TableCell>
                                        <TableCell className={styles.statusCell}><span className={cn(styles.presence, member.online && styles.isOnline)}><span />{member.online ? 'Online' : 'Offline'}</span></TableCell>
                                        <TableCell className={styles.roleCell}><span className={styles.mobileLabel}>Função</span><span className={styles.roleBadge}><ShieldCheck size={12} />{member.role}</span></TableCell>
                                        <TableCell className={styles.teamCell}><span className={styles.mobileLabel}>Equipe</span>{member.teams.length ? <div className={styles.teamNames}>{member.teams.map(team => <span key={team}><Users size={12} />{team}</span>)}</div> : <span className={styles.noTeam}>Ainda sem equipe</span>}</TableCell>
                                        <TableCell className={styles.dateCell}><span className={styles.mobileLabel}>Por aqui desde</span>{member.memberSince}</TableCell>
                                        <TableCell className={styles.actionCell}>{user.activeWorkspaceId && <MemberActions member={member} workspaceId={user.activeWorkspaceId} roles={roles} onMutate={() => fetchData(user.activeWorkspaceId!)} />}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    ) : (
                        <div className={styles.emptyState}><span className={shared.emptyIcon}>{hasFilters ? <Search size={27} /> : <HeartHandshake size={29} />}</span><h3>{hasFilters ? 'Ainda não encontramos essa pessoa' : 'Sempre cabe mais um talento'}</h3><p>{hasFilters ? 'Tente outro nome, e-mail ou ajuste os filtros para encontrar quem procura.' : 'Convide alguém para somar e construir boas conversas com você.'}</p>{hasFilters ? <Button variant="outline" onClick={clearFilters}>Limpar filtros</Button> : <Button asChild><Link href="/team/invite"><UserPlus size={15} className="mr-2" /> Convidar pessoa</Link></Button>}</div>
                    )}
                    {!error && <div className={styles.listFooter}><span>{visibleMembers.length} de {directory.length} {directory.length === 1 ? 'pessoa' : 'pessoas'}</span><span><HeartHandshake size={13} /> Melhor quando é junto.</span></div>}
                </section>
                <div className={styles.permissionsNote}><ShieldCheck size={17} /><p>Cada função define o que uma pessoa pode acessar no workspace.</p><Link href="/team/permissions">Ver permissões <ArrowUpRight size={13} /></Link></div>
            </main>
        </div>
    );
}
