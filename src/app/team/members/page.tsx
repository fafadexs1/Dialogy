
'use client';

import React, { useState, useEffect } from 'react';
import { MainLayout } from '@/components/layout/main-layout';
import { useAuth } from '@/hooks/use-auth';
import { Loader2, ShieldAlert, MoreVertical, Edit, UserX, UserCheck, DollarSign, BarChart, AlertCircle } from 'lucide-react';
import type { WorkspaceMember } from '@/lib/types';
import { getWorkspaceMembers, removeMemberAction } from '@/actions/members';
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from '@/hooks/use-toast';

function MemberActions({ member, workspaceId, onMutate }: { member: WorkspaceMember, workspaceId: string, onMutate: () => void }) {
    
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
                    <DropdownMenuItem disabled>
                        <Edit className="mr-2 h-4 w-4" />
                        Editar Função
                    </DropdownMenuItem>
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
    const user = useAuth();
    const [members, setMembers] = useState<WorkspaceMember[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchData = React.useCallback(async () => {
        if (!user?.activeWorkspaceId) return;
        setLoading(true);
        setError(null);
        try {
            const { members, error: fetchError } = await getWorkspaceMembers(user.activeWorkspaceId);
            if (fetchError) {
                throw new Error(fetchError);
            }
            setMembers(members || []);
        } catch (err: any) {
            setError(err.message || "Não foi possível buscar os membros.");
        } finally {
            setLoading(false);
        }
    }, [user?.activeWorkspaceId]);

    useEffect(() => {
        if (user) {
            fetchData();
        }
    }, [user, fetchData]);

    if (!user || loading) {
        return (
            <MainLayout user={user ?? undefined}>
                <div className="flex items-center justify-center h-full">
                    <Loader2 className="h-8 w-8 animate-spin text-primary"/>
                </div>
            </MainLayout>
        );
    }
    
    const activeWorkspace = user.workspaces?.find(ws => ws.id === user.activeWorkspaceId);

    return (
        <MainLayout user={user}>
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
                                    <Button onClick={fetchData} className="mt-4">Tentar Novamente</Button>
                                </div>
                            ) : (
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className='w-[35%]'>Membro</TableHead>
                                            <TableHead>Status</TableHead>
                                            <TableHead>Função</TableHead>
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
                                                            <p className="text-sm text-muted-foreground">{member.email}</p>
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
                                                    <span className="text-sm text-muted-foreground">{member.memberSince || 'N/A'}</span>
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
                                                   <MemberActions member={member} workspaceId={activeWorkspace!.id} onMutate={fetchData} />
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
        </MainLayout>
    )
}

    