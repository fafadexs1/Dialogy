'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Search, Loader2, ShieldCheck, Mail, Calendar, Building, Key, Copy, Check, ShieldAlert } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { getUsers, toggleSuperAdmin, createSuperAdminInvite, deleteUser } from '@/actions/superadmin-users';
import type { User } from '@/lib/types';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { getPlanLabel } from '@/lib/plans-types';


export default function UsersPage() {
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [selectedUser, setSelectedUser] = useState<User | null>(null);
    const [inviteCode, setInviteCode] = useState<string | null>(null);
    const [inviteLoading, setInviteLoading] = useState(false);
    const { toast } = useToast();

    // Simple debounce implementation if hook not found, but trying standard pattern
    const [debouncedSearch, setDebouncedSearch] = useState(search);

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search), 500);
        return () => clearTimeout(timer);
    }, [search]);

    const fetchUsers = useCallback(async () => {
        setLoading(true);
        const res = await getUsers(page, 20, debouncedSearch);
        if (res.error) {
            toast({ title: 'Erro ao carregar usuários', description: res.error, variant: 'destructive' });
        } else {
            setUsers(res.users);
            setTotal(res.total);
        }
        setLoading(false);
    }, [page, debouncedSearch, toast]);

    useEffect(() => {
        fetchUsers();
    }, [fetchUsers]);

    const handleToggleSuperAdmin = async (userId: string, currentStatus: boolean | undefined) => {
        const newStatus = !currentStatus;
        // Optimistic update
        setUsers(users.map(u => u.id === userId ? { ...u, is_superadmin: newStatus } : u));

        const res = await toggleSuperAdmin(userId, newStatus);
        if (!res.success) {
            // Revert on failure
            setUsers(users.map(u => u.id === userId ? { ...u, is_superadmin: currentStatus } : u));
            toast({ title: 'Erro ao atualizar permissão', description: res.error, variant: 'destructive' });
        } else {
            toast({ title: `Permissão de Superadmin ${newStatus ? 'concedida' : 'removida'} com sucesso.` });
        }
    }

    const handleGenerateInvite = async (workspaceId: string) => {
        setInviteLoading(true);
        setInviteCode(null);
        const res = await createSuperAdminInvite(workspaceId);
        if (res.error) {
            toast({ title: 'Erro ao criar convite', description: res.error, variant: 'destructive' });
        } else {
            setInviteCode(res.code || null);
            toast({ title: 'Convite criado com sucesso!', description: 'O código expira em 24 horas.' });
        }
        setInviteLoading(false);
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-2">
                <h1 className="text-2xl font-bold flex items-center gap-2">
                    <ShieldCheck className="h-6 w-6 text-primary" />
                    Gerenciamento de Usuários
                </h1>
                <p className="text-muted-foreground">Visualize e gerencie as permissões de acesso dos usuários da plataforma.</p>
            </div>

            <Card>
                <CardHeader className="pb-4">
                    <div className="flex items-center justify-between">
                        <CardTitle>Todos os Usuários ({total})</CardTitle>
                        <div className="relative w-full max-w-sm">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                type="search"
                                placeholder="Buscar por nome ou email..."
                                className="pl-8"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Usuário</TableHead>
                                    <TableHead>Workspaces</TableHead>
                                    <TableHead>Email</TableHead>
                                    <TableHead>Membro Desde</TableHead>
                                    <TableHead>Superadmin</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {loading ? (
                                    <TableRow>
                                        <TableCell colSpan={5} className="h-24 text-center">
                                            <div className="flex justify-center items-center gap-2">
                                                <Loader2 className="h-6 w-6 animate-spin" /> Carregando...
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ) : users.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                                            Nenhum usuário encontrado.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    users.map((user) => (
                                        <TableRow key={user.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedUser(user)}>
                                            <TableCell>
                                                <div className="flex items-center gap-3">
                                                    <Avatar>
                                                        <AvatarImage src={user.avatar_url || user.avatar} />
                                                        <AvatarFallback>{user.firstName?.charAt(0) || user.name?.charAt(0) || 'U'}</AvatarFallback>
                                                    </Avatar>
                                                    <span className="font-medium">{user.name}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className="font-mono">
                                                    {user.workspaces?.length || 0}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="hidden md:table-cell">
                                                <div className="flex items-center gap-2 text-muted-foreground">
                                                    <Mail className="h-3 w-3" /> {user.email}
                                                </div>
                                            </TableCell>
                                            <TableCell className="hidden md:table-cell text-muted-foreground text-sm">
                                                {user.memberSince ? format(new Date(user.memberSince), "d 'de' MMM, yyyy", { locale: ptBR }) : '-'}
                                            </TableCell>
                                            <TableCell onClick={(e) => e.stopPropagation()}>
                                                <div className="flex items-center gap-2">
                                                    <Switch
                                                        checked={user.is_superadmin || false}
                                                        onCheckedChange={() => handleToggleSuperAdmin(user.id, user.is_superadmin)}
                                                    />
                                                    {user.is_superadmin ? (
                                                        <Badge variant="default" className="bg-amber-600 hover:bg-amber-700">Admin</Badge>
                                                    ) : (
                                                        <span className="text-xs text-muted-foreground">User</span>
                                                    )}
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>

                    {/* Pagination Controls */}
                    <div className="flex items-center justify-end space-x-2 py-4">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                            disabled={page === 1 || loading}
                        >
                            Anterior
                        </Button>
                        <div className="text-sm text-muted-foreground">
                            Página {page}
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPage(p => p + 1)}
                            disabled={users.length < 20 || loading}
                        >
                            Próxima
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <Sheet open={!!selectedUser} onOpenChange={(open) => !open && setSelectedUser(null)}>
                <SheetContent className="sm:max-w-xl">
                    <SheetHeader>
                        <SheetTitle>Detalhes do Usuário</SheetTitle>
                        <SheetDescription>Informações detalhadas e workspaces de {selectedUser?.name}</SheetDescription>
                    </SheetHeader>
                    {selectedUser && (
                        <div className="mt-6 space-y-6">
                            <div className="flex items-center gap-4">
                                <Avatar className="h-16 w-16">
                                    <AvatarImage src={selectedUser.avatar_url || selectedUser.avatar} />
                                    <AvatarFallback>{selectedUser.firstName?.charAt(0) || 'U'}</AvatarFallback>
                                </Avatar>
                                <div>
                                    <h3 className="text-lg font-bold">{selectedUser.name}</h3>
                                    <p className="text-sm text-muted-foreground">{selectedUser.email}</p>
                                    <p className="text-xs text-muted-foreground mt-1">ID: {selectedUser.id}</p>
                                </div>
                            </div>
                            <div className="border-t pt-4">
                                <h4 className="font-semibold mb-4 flex items-center gap-2">
                                    <Building className="h-4 w-4" /> Workspaces ({selectedUser.workspaces?.length || 0})
                                </h4>
                                <div className="space-y-3">
                                    {selectedUser.workspaces && selectedUser.workspaces.length > 0 ? (
                                        selectedUser.workspaces.map(ws => (
                                            <Card key={ws.id} className="overflow-hidden">
                                                <div className="p-3 flex flex-col gap-2 bg-muted/20">
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-medium text-sm">{ws.name}</span>
                                                            <Badge variant="outline" className="text-[10px] h-5 capitalize bg-background">
                                                                {getPlanLabel((ws as any).plan)}
                                                            </Badge>
                                                            {(ws as any).role && (
                                                                <Badge variant="secondary" className="text-[10px] h-5 capitalize">
                                                                    {(ws as any).role}
                                                                </Badge>
                                                            )}
                                                        </div>
                                                        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => handleGenerateInvite(ws.id)} disabled={inviteLoading}>
                                                            <Key className="h-3 w-3" /> Convite
                                                        </Button>
                                                    </div>
                                                </div>
                                                {inviteCode && (
                                                    <div className="p-3 bg-green-50 border-t flex items-center justify-between">
                                                        <div className="text-xs text-green-800">
                                                            <span className="font-semibold">Código:</span> {inviteCode}
                                                        </div>
                                                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => {
                                                            navigator.clipboard.writeText(inviteCode);
                                                            toast({ title: 'Copiado!' });
                                                        }}>
                                                            <Copy className="h-3 w-3" />
                                                        </Button>
                                                    </div>
                                                )}
                                            </Card>
                                        ))
                                    ) : (
                                        <p className="text-sm text-muted-foreground">Este usuário não possui workspaces.</p>
                                    )}
                                </div>
                            </div>

                            <div className="border-t pt-4">
                                <h4 className="font-semibold mb-4 text-red-600 flex items-center gap-2">
                                    <ShieldAlert className="h-4 w-4" /> Zona de Perigo
                                </h4>
                                <div className="p-4 border border-red-200 bg-red-50 rounded-md">
                                    <h5 className="font-medium text-red-900">Banir / Excluir Usuário</h5>
                                    <p className="text-sm text-red-700 mt-1 mb-3">
                                        Esta ação excluirá permanentemente o usuário do sistema e impedirá seu acesso. As workspaces que ele possui também podem ser afetadas.
                                    </p>
                                    <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                            <Button variant="destructive" size="sm">
                                                Excluir Conta Permanentemente
                                            </Button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                            <AlertDialogHeader>
                                                <AlertDialogTitle>Você tem certeza absoluta?</AlertDialogTitle>
                                                <AlertDialogDescription>
                                                    Esta ação não pode ser desfeita. Isso excluirá permanentemente a conta do usuário
                                                    <strong> {selectedUser.name} </strong>
                                                    ({selectedUser.email}) e removerá seus dados de nossos servidores.
                                                </AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter>
                                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                                <AlertDialogAction
                                                    className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
                                                    onClick={async () => {
                                                        const res = await deleteUser(selectedUser.id);
                                                        if (res.success) {
                                                            toast({ title: 'Usuário excluído com sucesso.' });
                                                            setSelectedUser(null);
                                                            fetchUsers();
                                                        } else {
                                                            toast({ title: 'Erro ao excluir', description: res.error, variant: 'destructive' });
                                                        }
                                                    }}
                                                >
                                                    Sim, excluir usuário
                                                </AlertDialogAction>
                                            </AlertDialogFooter>
                                        </AlertDialogContent>
                                    </AlertDialog>
                                </div>
                            </div>
                        </div>
                    )}
                </SheetContent>
            </Sheet>
        </div >
    )
}
