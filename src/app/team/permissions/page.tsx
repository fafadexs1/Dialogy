
'use client';

import React, { useState, useEffect, useOptimistic } from 'react';
import { MainLayout } from '@/components/layout/main-layout';
import { useAuth } from '@/hooks/use-auth';
import { Loader2, Fingerprint, PlusCircle, Trash2, Edit, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { getRolesAndPermissions, updateRolePermissions } from '@/actions/permissions';
import type { Role, Permission } from '@/lib/types';
import { toast } from '@/hooks/use-toast';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';


function PermissionsMatrix({ 
    initialRoles, 
    initialPermissions 
}: { 
    initialRoles: Role[], 
    initialPermissions: Permission[] 
}) {
    const [roles, setRoles] = useState<Role[]>(initialRoles);
    const [isSaving, setIsSaving] = useState(false);

    const [optimisticRoles, setOptimisticRoles] = useOptimistic(
        roles,
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
        const originalRoles = roles;
        setOptimisticRoles({ roleId, permissionId, checked });

        try {
            await updateRolePermissions(roleId, permissionId, checked);
            // On success, update the real state
            setRoles(prevRoles => prevRoles.map(role => {
                if (role.id === roleId) {
                    const newPermissions = checked
                        ? [...role.permissions, initialPermissions.find(p => p.id === permissionId)!]
                        : role.permissions.filter(p => p.id !== permissionId);
                    return { ...role, permissions: newPermissions };
                }
                return role;
            }));
            toast({
                title: "Permissão atualizada",
                description: "A permissão foi salva com sucesso.",
            });
        } catch (error) {
            console.error(error);
            toast({
                title: "Erro ao salvar",
                description: "Não foi possível salvar a alteração. Tente novamente.",
                variant: "destructive",
            });
            // Revert optimistic update on failure
            setRoles(originalRoles);
        }
    };
    
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
                                        <th key={role.id} className="text-center min-w-40">{role.name}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {Object.entries(permissionCategories).map(([category, permissions]) => (
                                    <React.Fragment key={category}>
                                        <tr className="border-t">
                                            <td colSpan={roles.length + 1} className="py-2 px-4 bg-muted/30 font-semibold text-muted-foreground sticky left-0 z-10">
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


export default function PermissionsPage() {
    const user = useAuth();
    const [roles, setRoles] = useState<Role[]>([]);
    const [permissions, setPermissions] = useState<Permission[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (user?.activeWorkspaceId) {
            setLoading(true);
            getRolesAndPermissions(user.activeWorkspaceId)
                .then(({ roles, permissions }) => {
                    setRoles(roles || []);
                    setPermissions(permissions || []);
                })
                .catch(err => {
                    toast({
                        title: "Erro ao Carregar Dados",
                        description: "Não foi possível buscar os papéis e permissões.",
                        variant: "destructive"
                    });
                    console.error(err);
                })
                .finally(() => setLoading(false));
        }
    }, [user?.activeWorkspaceId]);

    if (!user || loading) {
        return (
            <MainLayout>
                <div className="flex items-center justify-center h-full">
                    <Loader2 className="h-8 w-8 animate-spin text-primary"/>
                </div>
            </MainLayout>
        );
    }
    
    return (
        <MainLayout user={user}>
            <div className="flex flex-col flex-1 h-full">
                <header className="p-4 sm:p-6 border-b flex-shrink-0 bg-background flex justify-between items-center">
                    <div>
                        <h1 className="text-2xl font-bold flex items-center gap-2"><Fingerprint /> Papéis & Permissões</h1>
                        <p className="text-muted-foreground">Defina papéis e controle o que cada membro pode acessar e fazer no workspace.</p>
                    </div>
                    <Button>
                        <PlusCircle className="mr-2 h-4 w-4" />
                        Criar Novo Papel
                    </Button>
                </header>
                <main className="flex-1 overflow-y-auto bg-muted/40 p-4 sm:p-6">
                    {roles.length > 0 && permissions.length > 0 ? (
                        <PermissionsMatrix initialRoles={roles} initialPermissions={permissions} />
                    ) : (
                         <div className="text-center py-20">
                            <h2 className="text-xl font-medium text-muted-foreground">Nenhum dado de permissão encontrado.</h2>
                            <p className="text-muted-foreground">Tente recarregar a página ou contate o suporte.</p>
                        </div>
                    )}
                </main>
            </div>
        </MainLayout>
    );
}

    