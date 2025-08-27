
'use client';

import React, { useState, useEffect, useActionState } from 'react';
import type { User, Role, WorkspaceMember } from '@/lib/types';
import { Loader2, ShieldAlert, MoreVertical, Edit, UserX, BarChart, AlertCircle, DollarSign, Users, Save, Copy } from 'lucide-react';
import { getWorkspaceMembers, removeMemberAction, updateMemberRoleAction } from '@/actions/members';
import { getRolesAndPermissions } from '@/actions/permissions';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
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
import { toast } from '@/hooks/use-toast';
import { AlertDialogTrigger } from '@radix-ui/react-alert-dialog';
import { useFormStatus } from 'react-dom';

function CopyButton({ textToCopy }: { textToCopy: string }) {
    const { toast } = useToast();
    const handleCopy = () => {
        navigator.clipboard.writeText(textToCopy);
        toast({ title: 'Copiado!', description: 'O ID foi copiado para a área de transferência.' });
    };
    return <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCopy}><Copy className="h-3 w-3" /></Button>;
}

function EditRoleDialog({ member, workspaceId, roles, onMutate, children }: { member: WorkspaceMember, workspaceId: string, roles: Role[], onMutate: () => void, children: React.ReactNode }) {
    const [isOpen, setIsOpen] = useState(false);
    const [state, formAction] = useActionState(updateMemberRoleAction, { success: false, error: undefined });

    useEffect(() => {
        if(state.success) {
            toast({ title: "Função Atualizada!", description: `A função de ${member.name} foi alterada.`});
            setIsOpen(false);
            onMutate();
        } else if (state.error) {
            toast({ title: "Erro ao Atualizar", description: state.error, variant: 'destructive'});
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state]);

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>{children}</DialogTrigger>
            <DialogContent>
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
                            <SelectTrigger>
                                <SelectValue placeholder="Selecione uma função" />
                            </SelectTrigger>
                            <SelectContent>
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
            <Save className="mr-2 h-4 w-4"/> Salvar
        </Button>
    )
}

function MemberActions({ member, workspaceId, roles, onMutate }: { member: WorkspaceMember, workspaceId: string, roles: Role[], onMutate: () => void }) {
    
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
                    <Button variant="ghost" size="icon">
                        <MoreVertical className="h-4 w-4" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    <EditRoleDialog member={member} workspaceId={workspaceId} roles={roles} onMutate={onMutate}>
                        <DropdownMenuItem onSelect={e => e.preventDefault()}>
                            <Edit className="mr-2 h-4 w-4" />
                            Editar Função
                        </DropdownMenuItem>
                    </EditRoleDialog>
                    <DropdownMenuItem disabled>
                        <BarChart className="mr-2 h-4 w-4" />
                        Ver Histórico de Uso
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
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Tem certeza?</AlertDialogTitle>
                    <AlertDialogDescription>
                        Esta ação removerá permanentemente **{member.name}** do workspace. O usuário perderá todo o acesso. Esta ação não pode ser desfeita.
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
    const [user, setUser] = useState<User | null>(null);
    const [members, setMembers] = useState<WorkspaceMember[]>([]);
    const [roles, setRoles] = useState<Role[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchUser = async () => {
            const res = await fetch('/api/user');
            if(res.ok) {
                setUser(await res.json());
            } else {
                 setLoading(false);
                 setError("Falha ao carregar dados do usuário.");
            }
        };
        fetchUser();
    }, []);

    const fetchData = React.useCallback(async (workspaceId: string) => {
        if (!workspaceId) return;
        setLoading(true);
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
            fetchData(user.activeWorkspaceId);
        }
    }, [user, fetchData]);

    if (loading || !user) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loader2 className="h-8 w-8 animate-spin text-primary"/>
            </div>
        );
    }
    
    const activeWorkspace = user?.workspaces?.find(ws => ws.id === user.activeWorkspaceId);

    return (
        <div className="flex flex-col flex-1 h-full">
            <header className="p-4 sm:p-6 border-b flex-shrink-0 bg-background">
                <h1 className="text-2xl font-bold flex items-center gap-2"><ShieldAlert /> Gerenciar Membros</h1>
                <p className="text-muted-foreground">Gerencie os membros do seu workspace, suas permissões e status.</p>
            </header>
            <main className="flex-1 overflow-y-auto bg-muted/40 p-4 sm:p-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Membros do Workspace</CardTitle>
                        <CardDescription>
                            Total de {members.length} membros no workspace: <span className='font-semibold'>{activeWorkspace?.name || ''}</span>
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {error ? (
                             <div className="text-center py-10 text-destructive">
                                <AlertCircle className="mx-auto h-12 w-12" />
                                <h2 className="mt-4 text-xl font-bold">Falha ao carregar membros</h2>
                                <p className="text-muted-foreground">{error}</p>
                                <Button onClick={() => user?.activeWorkspaceId && fetchData(user.activeWorkspaceId)} className="mt-4">Tentar Novamente</Button>
                            </div>
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className='w-[30%]'>Membro</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead>Função</TableHead>
                                        <TableHead>Equipe</TableHead>
                                        <TableHead>Membro Desde</TableHead>
                                        <TableHead>Uso (Piloto Automático)</TableHead>
                                        <TableHead className="text-right">Ações</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {members.map((member) => (
                                        <TableRow key={member.id}>
                                            <TableCell>
                                                <div className="flex items-center gap-3">
                                                    <Avatar>
                                                        <AvatarImage src={member.avatar} alt={member.name} />
                                                        <AvatarFallback>{member.name.charAt(0)}</AvatarFallback>
                                                    </Avatar>
                                                    <div>
                                                        <p className="font-medium">{member.name}</p>
                                                        <div className="flex items-center gap-1">
                                                            <p className="text-xs text-muted-foreground">{member.email}</p>
                                                        </div>
                                                        <div className="flex items-center gap-1 mt-1">
                                                            <span className="text-xs font-mono text-muted-foreground">ID: {member.id}</span>
                                                            <CopyButton textToCopy={member.id} />
                                                        </div>
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant={member.online ? 'default' : 'secondary'} className={member.online ? 'bg-green-500/20 text-green-700 border-transparent' : ''}>
                                                    {member.online ? 'Online' : 'Offline'}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="outline">{member.role}</Badge>
                                            </TableCell>
                                             <TableCell>
                                                <Badge variant="secondary" className="flex items-center gap-1.5 w-fit">
                                                    <Users className="h-3 w-3"/>
                                                    {member.team}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>
                                                <span className="text-sm text-muted-foreground">{member.memberSince}</span>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-1 font-medium text-muted-foreground">
                                                  <DollarSign className="h-4 w-4 text-green-500" />
                                                  <span>
                                                    {(member.autopilotUsage || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                                  </span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right">
                                               {activeWorkspace && <MemberActions member={member} workspaceId={activeWorkspace.id} roles={roles} onMutate={() => fetchData(activeWorkspace.id)} />}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </CardContent>
                </Card>
            </main>
        </div>
    )
}
