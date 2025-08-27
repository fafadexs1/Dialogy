
'use client';

import React, { useState, useEffect, useOptimistic, useActionState, useRef } from 'react';
import { MainAppLayout } from '@/components/layout/main-app-layout';
import type { User, Role, Permission } from '@/lib/types';
import { Loader2, Fingerprint, PlusCircle, Trash2, Edit, Check, Settings, AlertCircle, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { getRolesAndPermissions, updateRolePermissionAction, createRoleAction, updateRoleAction, deleteRoleAction } from '@/actions/permissions';
import { toast } from '@/hooks/use-toast';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useFormStatus } from 'react-dom';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
} from "@/components/ui/alert-dialog"

// --- Dialog Forms ---
function RoleFormButton({isEditing}: {isEditing: boolean}) {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <Save className="mr-2 h-4 w-4"/> 
            {isEditing ? 'Salvar Alterações' : 'Salvar Papel'}
        </Button>
    )
}

function RoleForm({ 
    workspaceId, 
    onSuccess, 
    initialData,
    action,
}: { 
    workspaceId: string, 
    onSuccess: () => void,
    initialData?: Role | null,
    action: (prevState: any, formData: FormData) => Promise<{ success: boolean; error?: string; }>
}) {
    const formRef = useRef<HTMLFormElement>(null);
    const [state, formAction] = useActionState(action, { success: false, error: undefined });

    useEffect(() => {
        if (state.success) {
            toast({ title: "Sucesso!", description: `Papel ${initialData ? 'atualizado' : 'criado'} com sucesso.` });
            onSuccess();
        }
    }, [state, onSuccess, initialData]);

    return (
        <form ref={formRef} action={formAction}>
            <input type="hidden" name="workspaceId" value={workspaceId} />
            {initialData && <input type="hidden" name="roleId" value={initialData.id} />}
            <div className="space-y-4 py-4">
                <div className="space-y-2">
                    <Label htmlFor="name">Nome do Papel</Label>
                    <Input id="name" name="name" placeholder="Ex: Gerente de Vendas" required defaultValue={initialData?.name} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="description">Descrição</Label>
                    <Input id="description" name="description" placeholder="Ex: Pode visualizar e editar negócios" defaultValue={initialData?.description} />
                </div>
                {state.error && (
                    <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>Erro</AlertTitle>
                        <AlertDescription>{state.error}</AlertDescription>
                    </Alert>
                )}
            </div>
            <DialogFooter>
                <DialogClose asChild><Button type="button" variant="outline">Cancelar</Button></DialogClose>
                <RoleFormButton isEditing={!!initialData} />
            </DialogFooter>
        </form>
    );
}

// --- Permissions Matrix Component ---

function PermissionsMatrix({ 
    initialRoles, 
    initialPermissions,
    workspaceId,
    onMutate
}: { 
    initialRoles: Role[], 
    initialPermissions: Permission[],
    workspaceId: string,
    onMutate: () => void;
}) {
    const [optimisticRoles, setOptimisticRoles] = useOptimistic(
        initialRoles,
        (state, { roleId, permissionId, checked }: { roleId: string, permissionId: string, checked: boolean }) => {
            return state.map(role => {
                if (role.id === roleId) {
                    const newPermissions = checked
                        ? [...role.permissions, initialPermissions.find(p => p.id === permissionId)!]
                        : role.permissions.filter(p => p.id !== permissionId);
                    return { ...role, permissions: newPermissions };
                }
                return role;
            });
        }
    );

    const handlePermissionChange = async (roleId: string, permissionId: string, checked: boolean) => {
        setOptimisticRoles({ roleId, permissionId, checked });
        const result = await updateRolePermissionAction(roleId, permissionId, checked);
        if (result.error) {
            toast({ title: "Erro ao Salvar", description: result.error, variant: "destructive" });
            onMutate(); // Re-fetch to revert optimistic update
        }
    };
    
    const handleDeleteRole = async (roleId: string) => {
        const result = await deleteRoleAction(roleId, workspaceId);
         if (result.error) {
            toast({ title: "Erro ao Remover", description: result.error, variant: "destructive" });
        } else {
            toast({ title: "Sucesso!", description: "Papel removido com sucesso." });
            onMutate();
        }
    }

    const permissionCategories = initialPermissions.reduce((acc, p) => {
        if (!acc[p.category]) acc[p.category] = [];
        acc[p.category].push(p);
        return acc;
    }, {} as Record<string, Permission[]>);

    return (
        <Card>
            <CardHeader>
                <CardTitle>Matriz de Permissões</CardTitle>
                <CardDescription>Marque as caixas para conceder permissões a cada papel (role). As alterações são salvas automaticamente.</CardDescription>
            </CardHeader>
            <CardContent>
                <ScrollArea className="w-full whitespace-nowrap">
                    <div className="relative overflow-auto border rounded-lg">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/50">
                                <tr className="[&_th]:h-12 [&_th]:px-4 [&_th]:text-left [&_th]:align-middle [&_th]:font-medium [&_th]:text-muted-foreground">
                                    <th className="sticky left-0 bg-muted/50 z-10 min-w-48">Permissão</th>
                                    {optimisticRoles.map(role => (
                                        <th key={role.id} className="text-center min-w-48">
                                            <div className='flex items-center justify-center gap-2'>
                                                {role.name}
                                                {role.name !== 'Administrador' && (
                                                <Dialog>
                                                     <DropdownMenu>
                                                        <DropdownMenuTrigger asChild>
                                                            <Button variant="ghost" size="icon" className="h-7 w-7"><Settings className="h-4 w-4"/></Button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent>
                                                            <DialogTrigger asChild>
                                                                <DropdownMenuItem><Edit className="mr-2 h-4 w-4"/>Editar Papel</DropdownMenuItem>
                                                            </DialogTrigger>
                                                             <AlertDialog>
                                                                <AlertDialogTrigger asChild>
                                                                     <DropdownMenuItem className="text-destructive" onSelect={(e) => e.preventDefault()}>
                                                                        <Trash2 className="mr-2 h-4 w-4"/>Remover Papel
                                                                    </DropdownMenuItem>
                                                                </AlertDialogTrigger>
                                                                <AlertDialogContent>
                                                                    <AlertDialogHeader>
                                                                        <AlertDialogTitle>Tem certeza?</AlertDialogTitle>
                                                                        <AlertDialogDescription>
                                                                            Esta ação não pode ser desfeita. Isso removerá permanentemente o papel "{role.name}".
                                                                        </AlertDialogDescription>
                                                                    </AlertDialogHeader>
                                                                    <AlertDialogFooter>
                                                                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                                                        <AlertDialogAction onClick={() => handleDeleteRole(role.id)}>Remover</AlertDialogAction>
                                                                    </AlertDialogFooter>
                                                                </AlertDialogContent>
                                                            </AlertDialog>
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                    <DialogContent>
                                                        <DialogHeader>
                                                            <DialogTitle>Editar Papel: {role.name}</DialogTitle>
                                                        </DialogHeader>
                                                        <RoleForm workspaceId={workspaceId} onSuccess={onMutate} initialData={role} action={updateRoleAction} />
                                                    </DialogContent>
                                                </Dialog>
                                                )}
                                            </div>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {Object.entries(permissionCategories).map(([category, permissions]) => (
                                    <React.Fragment key={category}>
                                        <tr className="border-t">
                                            <td colSpan={initialRoles.length + 1} className="py-2 px-4 bg-secondary/30 font-semibold text-muted-foreground sticky left-0 z-10">
                                                {category}
                                            </td>
                                        </tr>
                                        {permissions.map(permission => (
                                            <tr key={permission.id} className="[&_td]:px-4 [&_td]:py-2 [&_td]:align-middle border-t">
                                                <td className="sticky left-0 bg-background z-10">
                                                    <div className="font-medium">{permission.description}</div>
                                                    <div className="text-xs text-muted-foreground font-mono">{permission.id}</div>
                                                </td>
                                                {optimisticRoles.map(role => (
                                                    <td key={`${role.id}-${permission.id}`} className="text-center">
                                                        <Checkbox
                                                            checked={role.permissions.some(p => p.id === permission.id)}
                                                            onCheckedChange={(checked) => handlePermissionChange(role.id, permission.id, !!checked)}
                                                            id={`${role.id}-${permission.id}`}
                                                            disabled={role.name === 'Administrador'}
                                                        />
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </React.Fragment>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <ScrollBar orientation="horizontal" />
                </ScrollArea>
            </CardContent>
        </Card>
    );
}

function CreateRoleButton() {
    const { pending } = useFormStatus();
    return (
        <Button disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <PlusCircle className="mr-2 h-4 w-4" />
            Criar Novo Papel
        </Button>
    )
}

// --- Main Page Component ---
export default function PermissionsPage() {
    const [user, setUser] = useState<User | null>(null);
    const [roles, setRoles] = useState<Role[]>([]);
    const [permissions, setPermissions] = useState<Permission[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [workspaceId, setWorkspaceId] = useState<string | undefined>();

    useEffect(() => {
        const fetchUser = async () => {
            const res = await fetch('/api/user');
            if (res.ok) {
                const userData = await res.json();
                setUser(userData);
                setWorkspaceId(userData.activeWorkspaceId);
            }
        };
        fetchUser();
    }, []);

    const fetchData = React.useCallback(async () => {
        if (!workspaceId) return;
        setLoading(true);
        setError(null);
        try {
            const { roles, permissions, error: fetchError } = await getRolesAndPermissions(workspaceId);
            if (fetchError) {
                throw new Error(fetchError);
            }
            setRoles(roles || []);
            setPermissions(permissions || []);
        } catch (err: any) {
            toast({
                title: "Erro ao Carregar Dados",
                description: err.message || "Não foi possível buscar os papéis e permissões.",
                variant: "destructive"
            });
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [workspaceId]);

    useEffect(() => {
        if (workspaceId) {
            fetchData();
        }
    }, [workspaceId, fetchData]);
    
    const handleSuccess = () => {
        setIsCreateModalOpen(false);
        fetchData();
    }

    if (loading || !user) {
        return (
            <MainAppLayout user={user}>
                <div className="flex items-center justify-center h-full">
                    <Loader2 className="h-8 w-8 animate-spin text-primary"/>
                </div>
            </MainAppLayout>
        );
    }
    
    return (
        <MainAppLayout user={user}>
        <div className="flex flex-col flex-1 h-full">
            <header className="p-4 sm:p-6 border-b flex-shrink-0 bg-background flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2"><Fingerprint /> Papéis & Permissões</h1>
                    <p className="text-muted-foreground">Defina papéis e controle o que cada membro pode acessar e fazer no workspace.</p>
                </div>
                 <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
                    <DialogTrigger asChild>
                       <Button>
                            <PlusCircle className="mr-2 h-4 w-4" />
                            Criar Novo Papel
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Criar Novo Papel</DialogTitle>
                            <DialogDescription>
                                Defina um nome e descrição para o novo papel. Você poderá atribuir permissões na tela seguinte.
                            </DialogDescription>
                        </DialogHeader>
                        {workspaceId && <RoleForm 
                            workspaceId={workspaceId}
                            onSuccess={handleSuccess} 
                            action={createRoleAction}
                        />}
                    </DialogContent>
                </Dialog>
            </header>
            <main className="flex-1 overflow-y-auto bg-muted/40 p-4 sm:p-6">
                {error ? (
                    <div className="text-center py-20 text-destructive">
                        <AlertCircle className="mx-auto h-12 w-12" />
                        <h2 className="mt-4 text-xl font-bold">Falha ao carregar dados</h2>
                        <p className="text-muted-foreground">{error}</p>
                        <Button onClick={fetchData} className="mt-4">Tentar Novamente</Button>
                    </div>
                ) : roles.length > 0 && permissions.length > 0 && workspaceId ? (
                    <PermissionsMatrix 
                        initialRoles={roles} 
                        initialPermissions={permissions} 
                        workspaceId={workspaceId}
                        onMutate={fetchData}
                    />
                ) : (
                     <div className="text-center py-20">
                        <h2 className="text-xl font-medium text-muted-foreground">Nenhum dado de permissão encontrado.</h2>
                        <p className="text-muted-foreground">Isso pode acontecer se o workspace não foi configurado corretamente.</p>
                    </div>
                )}
            </main>
        </div>
        </MainAppLayout>
    );
}
