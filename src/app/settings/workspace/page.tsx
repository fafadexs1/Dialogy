

'use client';

import { useActionState, useEffect, useState, useRef, useCallback } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { updateWorkspaceAction } from '@/actions/workspace';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Settings, Copy, Check, Link as LinkIcon, PlusCircle, UserPlus, Trash2, Clock, LogIn, AlertCircle, UploadCloud, Save } from 'lucide-react';
import type { Workspace, WorkspaceInvite } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHeader, TableRow, TableHead } from '@/components/ui/table';
import { createWorkspaceInvite, getWorkspaceInvites, revokeWorkspaceInvite, joinWorkspaceAction } from '@/actions/invites';
import { formatDistanceToNowStrict } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useSettings } from '../settings-context';
import { timezones } from '@/lib/timezones';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

function SubmitButton() {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
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

function JoinWorkspaceForm({ className }: { className?: string}) {
    const [state, formAction] = useActionState(joinWorkspaceAction, { success: false, error: null });
    const { pending } = useFormStatus();

    return (
        <form action={formAction} className={className}>
            <CardContent>
                <div className="space-y-2">
                    <Label htmlFor="invite-code">Código de Convite</Label>
                    <Input
                        id="invite-code"
                        name="inviteCode"
                        placeholder="Insira o código do convite aqui"
                        required
                        disabled={pending}
                    />
                </div>
                 {state.error && (
                    <Alert variant="destructive" className="mt-4">
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>Erro ao entrar no workspace</AlertTitle>
                        <AlertDescription>{state.error}</AlertDescription>
                    </Alert>
                )}
            </CardContent>
            <CardFooter>
                 <Button type="submit" className="w-full" disabled={pending}>
                    {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    <LogIn className="mr-2 h-4 w-4" />
                    {pending ? 'Verificando...' : 'Entrar no Workspace'}
                </Button>
            </CardFooter>
        </form>
    );
}


export default function WorkspaceSettingsPage() {
    const { user, loading: userLoading } = useSettings();
    const router = useRouter();
    const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
    const [invites, setInvites] = useState<WorkspaceInvite[]>([]);
    const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
    
    // State for avatar
    const [avatarUrl, setAvatarUrl] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const formRef = useRef<HTMLFormElement>(null);
    
    const [updateState, updateAction] = useActionState(updateWorkspaceAction, { success: false, error: null });
    const [inviteError, inviteAction] = useActionState(createWorkspaceInvite, undefined);
    
    const { toast } = useToast();

    const fetchInvites = useCallback(async (workspaceId: string) => {
        const result = await getWorkspaceInvites(workspaceId);
        if (!result.error) {
            setInvites(result.invites || []);
        }
    }, []);

    useEffect(() => {
        if (user?.activeWorkspaceId && user.workspaces) {
            const workspace = user.workspaces.find((ws: Workspace) => ws.id === user.activeWorkspaceId);
            if (workspace) {
                setActiveWorkspace(workspace);
                setAvatarUrl(workspace.avatar || '');
                fetchInvites(workspace.id);
            }
        }
    }, [user, fetchInvites]);

    useEffect(() => {
        if (updateState.success) {
            toast({ title: "Workspace Atualizado!", description: "As configurações do workspace foram salvas." });
            router.refresh(); // Re-fetch server components data
        } else if (updateState.error) {
            toast({ title: "Erro ao atualizar", description: updateState.error, variant: "destructive" });
        }
    }, [updateState, toast, router]);
    
    useEffect(() => {
        if (inviteError === null) { // Success is null
            toast({ title: "Convite Criado!", description: "O link de convite foi gerado com sucesso." });
            setIsInviteModalOpen(false);
            if (activeWorkspace) fetchInvites(activeWorkspace.id);
        } else if (inviteError) { // Error is a string
             toast({ title: "Erro ao criar convite", description: inviteError, variant: "destructive" });
        }
    }, [inviteError, toast, activeWorkspace, fetchInvites]);
    
    const handleRevokeInvite = async (inviteId: string) => {
        const result = await revokeWorkspaceInvite(inviteId);
        if (result.error) {
            toast({ title: "Erro ao revogar", description: result.error, variant: 'destructive'});
        } else {
            toast({ title: "Convite Revogado", description: "O convite não pode mais ser utilizado." });
            if (activeWorkspace) fetchInvites(activeWorkspace.id);
        }
    }
    
    const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const previewUrl = URL.createObjectURL(file);
            setAvatarUrl(previewUrl);
        }
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formRef.current || !activeWorkspace) return;
        const formData = new FormData(formRef.current);
        updateAction(formData);
    }


    const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';

    if (userLoading || !user) {
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
            
            <form ref={formRef} onSubmit={handleSubmit} encType="multipart/form-data">
                 <Card>
                    <CardHeader>
                        <CardTitle>Detalhes do Workspace</CardTitle>
                        <CardDescription>Altere as configurações do seu workspace.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <input type="hidden" name="workspaceId" value={activeWorkspace.id} />
                        
                        <div className="flex items-center gap-6">
                            <Avatar className="h-20 w-20 rounded-lg border">
                                <AvatarImage src={avatarUrl} alt={activeWorkspace.name} />
                                <AvatarFallback className="text-3xl rounded-lg">{activeWorkspace.name.charAt(0)}</AvatarFallback>
                            </Avatar>
                             <div className="space-y-2">
                                <Label>Avatar do Workspace</Label>
                                <div className="flex gap-2">
                                    <input type="file" name="avatarFile" ref={fileInputRef} onChange={handleAvatarChange} className="hidden" accept="image/*" />
                                    <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
                                        <UploadCloud className="mr-2 h-4 w-4" />
                                        Carregar Imagem
                                    </Button>
                                </div>
                                <p className="text-xs text-muted-foreground">PNG, JPG, GIF até 2MB.</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <Label htmlFor="workspaceName">Nome do Workspace</Label>
                                <Input 
                                    id="workspaceName"
                                    name="workspaceName"
                                    defaultValue={activeWorkspace.name}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="timezone">Fuso Horário</Label>
                                <Select name="timezone" defaultValue={(activeWorkspace as any).timezone || 'America/Sao_Paulo'}>
                                    <SelectTrigger id="timezone">
                                        <SelectValue placeholder="Selecione um fuso horário" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {timezones.map(tz => (
                                            <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </CardContent>
                    <CardFooter className="border-t pt-6 flex justify-between items-center">
                        <p className="text-sm text-muted-foreground">As alterações serão refletidas em toda a plataforma.</p>
                        <SubmitButton />
                    </CardFooter>
                </Card>
            </form>

            <Card>
                <CardHeader>
                    <CardTitle>Entrar em outro Workspace</CardTitle>
                    <CardDescription>Recebeu um convite? Insira o código abaixo para se juntar a outra equipe.</CardDescription>
                </CardHeader>
                <JoinWorkspaceForm />
            </Card>
            
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
