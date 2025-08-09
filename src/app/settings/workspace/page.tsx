
'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useAuth } from "@/hooks/use-auth";
import { updateWorkspaceAction } from '@/actions/workspace';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Settings, Copy, Check, Link as LinkIcon, PlusCircle, UserPlus, Trash2 } from 'lucide-react';
import type { Workspace, WorkspaceInvite } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHeader, TableRow, TableHead } from '@/components/ui/table';
import { createWorkspaceInvite, getWorkspaceInvites, revokeWorkspaceInvite } from '@/actions/invites';
import { formatDistanceToNowStrict } from 'date-fns';
import { ptBR } from 'date-fns/locale';

function SubmitButton() {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {pending ? 'Salvando...' : 'Salvar Alterações'}
        </Button>
    )
}

function CreateInviteButton() {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {pending ? 'Gerando...' : 'Gerar Convite'}
        </Button>
    )
}

function CopyButton({ text }: { text: string }) {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <Button onClick={handleCopy} variant="ghost" size="icon" className='h-8 w-8'>
            {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
        </Button>
    )
}

export default function WorkspaceSettingsPage() {
    const user = useAuth();
    const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
    const [workspaceName, setWorkspaceName] = useState('');
    const [invites, setInvites] = useState<WorkspaceInvite[]>([]);
    const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
    
    const [updateError, updateAction] = useActionState(updateWorkspaceAction, null);
    const [inviteError, inviteAction] = useActionState(createWorkspaceInvite, null);
    
    const { toast } = useToast();

    useEffect(() => {
        if (user?.activeWorkspaceId && user.workspaces) {
            const workspace = user.workspaces.find(ws => ws.id === user.activeWorkspaceId);
            if (workspace) {
                setActiveWorkspace(workspace);
                setWorkspaceName(workspace.name);
                fetchInvites(workspace.id);
            }
        }
    }, [user]);

    const fetchInvites = async (workspaceId: string) => {
        const result = await getWorkspaceInvites(workspaceId);
        if (!result.error) {
            setInvites(result.invites || []);
        }
    }

    useEffect(() => {
        if (updateError === null && !useFormStatus().pending) {
            // A small hack to prevent toast on initial load
            if(workspaceName !== activeWorkspace?.name) {
                toast({ title: "Workspace Atualizado!", description: "O nome do workspace foi alterado." });
            }
        } else if (updateError) {
            toast({ title: "Erro ao atualizar", description: updateError, variant: "destructive" });
        }
    }, [updateError, toast, workspaceName, activeWorkspace?.name]);
    
    useEffect(() => {
        if (inviteError === null) { // Success
            toast({ title: "Convite Criado!", description: "O link de convite foi gerado com sucesso." });
            setIsInviteModalOpen(false);
            if (activeWorkspace) fetchInvites(activeWorkspace.id);
        } else if (inviteError) {
             toast({ title: "Erro ao criar convite", description: inviteError, variant: "destructive" });
        }
    }, [inviteError, toast, activeWorkspace]);
    
    const handleRevokeInvite = async (inviteId: string) => {
        const result = await revokeWorkspaceInvite(inviteId);
        if (result.error) {
            toast({ title: "Erro ao revogar", description: result.error, variant: 'destructive'});
        } else {
            toast({ title: "Convite Revogado", description: "O convite não pode mais ser utilizado." });
            if (activeWorkspace) fetchInvites(activeWorkspace.id);
        }
    }
    
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';

    if (!user) {
        return <div className="flex items-center justify-center h-full">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
    }

    if (!activeWorkspace) {
        return (
            <div className="text-center">
                <h2 className="text-xl font-medium text-muted-foreground">Nenhum workspace selecionado.</h2>
                <p className="text-muted-foreground">Crie ou selecione um workspace para ver suas configurações.</p>
            </div>
        )
    }

    return (
        <div className="max-w-4xl space-y-8">
            <header className="mb-6">
                 <h1 className="text-2xl font-bold flex items-center gap-2">
                    <Settings />
                    Configurações do Workspace
                </h1>
                 <p className="text-muted-foreground">Gerencie o nome e outras configurações do seu workspace atual: <span className='font-semibold'>{activeWorkspace.name}</span></p>
            </header>
            
            <form action={updateAction}>
                 <Card>
                    <CardHeader>
                        <CardTitle>Detalhes do Workspace</CardTitle>
                        <CardDescription>Altere o nome do seu workspace.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <input type="hidden" name="workspaceId" value={activeWorkspace.id} />
                        <div className="space-y-2">
                            <Label htmlFor="workspaceName">Nome do Workspace</Label>
                            <Input 
                                id="workspaceName"
                                name="workspaceName"
                                value={workspaceName}
                                onChange={(e) => setWorkspaceName(e.target.value)}
                            />
                        </div>
                    </CardContent>
                    <CardFooter className="border-t pt-6 flex justify-between items-center">
                        <p className="text-sm text-muted-foreground">As alterações serão refletidas em toda a plataforma.</p>
                        <SubmitButton />
                    </CardFooter>
                </Card>
            </form>
            
            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                        <CardTitle>Convites</CardTitle>
                        <CardDescription>Gerencie os convites para permitir que outros usuários entrem neste workspace.</CardDescription>
                    </div>
                    <Dialog open={isInviteModalOpen} onOpenChange={setIsInviteModalOpen}>
                        <DialogTrigger asChild>
                             <Button>
                                <PlusCircle className="mr-2 h-4 w-4" />
                                Criar Convite
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <form action={inviteAction}>
                                <input type="hidden" name="workspaceId" value={activeWorkspace.id} />
                                <DialogHeader>
                                    <DialogTitle>Gerar Link de Convite</DialogTitle>
                                    <DialogDescription>
                                        Crie um link de convite para adicionar novos membros ao seu workspace.
                                    </DialogDescription>
                                </DialogHeader>
                                <div className="space-y-4 py-4">
                                     <div className="space-y-2">
                                        <Label htmlFor="expiresIn">Validade</Label>
                                        <Select name="expiresIn" defaultValue="86400">
                                            <SelectTrigger id="expiresIn">
                                                <SelectValue placeholder="Selecione a validade" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="3600">1 Hora</SelectItem>
                                                <SelectItem value="86400">1 Dia</SelectItem>
                                                <SelectItem value="604800">7 Dias</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="maxUses">Número Máximo de Usos</Label>
                                        <Input id="maxUses" name="maxUses" type="number" placeholder="Deixe em branco para ilimitado" />
                                    </div>
                                </div>
                                <DialogFooter>
                                    <Button type="button" variant="ghost" onClick={() => setIsInviteModalOpen(false)}>Cancelar</Button>
                                    <CreateInviteButton />
                                </DialogFooter>
                            </form>
                        </DialogContent>
                    </Dialog>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Link/Código</TableHead>
                                <TableHead>Expira em</TableHead>
                                <TableHead>Usos</TableHead>
                                <TableHead className="text-right">Ações</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {invites.map(invite => (
                                <TableRow key={invite.id}>
                                    <TableCell>
                                        <div className="flex items-center gap-2">
                                            <LinkIcon className="h-4 w-4 flex-shrink-0" />
                                            <Input readOnly value={`${baseUrl}/join/${invite.code}`} className="h-8 flex-1" />
                                            <CopyButton text={`${baseUrl}/join/${invite.code}`} />
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        {formatDistanceToNowStrict(new Date(invite.expires_at), { addSuffix: true, locale: ptBR })}
                                    </TableCell>
                                    <TableCell>
                                        {invite.use_count} / {invite.max_uses || '∞'}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button variant="destructive" size="sm" onClick={() => handleRevokeInvite(invite.id)}>
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {invites.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                                        Nenhum convite ativo.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    )
}
