
'use client';

import { useActionState, useEffect, useState, useRef, useCallback } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { updateWorkspaceAction } from '@/actions/workspace';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Settings, Copy, Check, Link as LinkIcon, PlusCircle, UserPlus, Trash2, Clock, LogIn, AlertCircle, UploadCloud, Save, Building2, Globe, MessageSquare, Timer, Users, Mail } from 'lucide-react';
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
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function SubmitButton() {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" disabled={pending} className="min-w-[140px]">
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
        <Button onClick={handleCopy} variant="ghost" size="icon" className='h-8 w-8 hover:bg-green-500/10 hover:text-green-600 transition-colors'>
            {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
        </Button>
    )
}

function JoinWorkspaceForm({ className }: { className?: string }) {
    const [state, formAction] = useActionState(joinWorkspaceAction, { success: false, error: null });
    const { pending } = useFormStatus();

    return (
        <form action={formAction} className={className}>
            <div className="flex gap-3">
                <div className="flex-1 space-y-2">
                    <Label htmlFor="invite-code" className="sr-only">Código de Convite</Label>
                    <Input
                        id="invite-code"
                        name="inviteCode"
                        placeholder="Insira o código do convite (ex: invites/xyz...)"
                        required
                        disabled={pending}
                        className="h-10"
                    />
                </div>
                <Button type="submit" disabled={pending} className="h-10">
                    {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4 mr-2" />}
                    {pending ? '' : 'Entrar'}
                </Button>
            </div>
            {state.error && (
                <Alert variant="destructive" className="mt-4">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Erro</AlertTitle>
                    <AlertDescription>{state.error}</AlertDescription>
                </Alert>
            )}
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
            toast({ title: "Workspace Atualizado!", description: "As configurações foram aplicadas com sucesso." });
            router.refresh();
        } else if (updateState.error) {
            toast({ title: "Erro ao atualizar", description: updateState.error, variant: "destructive" });
        }
    }, [updateState, toast, router]);

    useEffect(() => {
        if (inviteError === null) {
            toast({ title: "Convite Criado!", description: "Compartilhe o link com sua equipe." });
            setIsInviteModalOpen(false);
            if (activeWorkspace) fetchInvites(activeWorkspace.id);
        } else if (inviteError) {
            toast({ title: "Erro ao criar convite", description: inviteError, variant: "destructive" });
        }
    }, [inviteError, toast, activeWorkspace, fetchInvites]);

    const handleRevokeInvite = async (inviteId: string) => {
        const result = await revokeWorkspaceInvite(inviteId);
        if (result.error) {
            toast({ title: "Erro ao revogar", description: result.error, variant: 'destructive' });
        } else {
            toast({ title: "Convite Revogado", description: "O link foi invalidado." });
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
        // Wrap in startTransition to avoid React 19 useActionState warning
        const { startTransition } = await import('react');
        startTransition(() => {
            updateAction(formData);
        });
    }

    const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';

    if (userLoading || !user) {
        return <div className="flex items-center justify-center h-full text-muted-foreground"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }

    if (!activeWorkspace) {
        return (
            <div className="text-center p-12 bg-muted/20 rounded-xl border border-dashed">
                <Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h2 className="text-xl font-medium">Nenhum workspace selecionado</h2>
                <p className="text-muted-foreground mt-2">Crie ou selecione um para começar.</p>
            </div>
        )
    }

    return (
        <div className="max-w-5xl mx-auto space-y-8 pb-10">
            <header className="flex items-center justify-between pb-6 border-b">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Workspace</h1>
                    <p className="text-muted-foreground mt-1 text-lg">Gerencie a identidade e as preferências da sua equipe.</p>
                </div>
            </header>

            <Tabs defaultValue="general" className="space-y-6">
                <TabsList className="bg-muted/50 p-1">
                    <TabsTrigger value="general" className="gap-2"><Settings className="h-4 w-4" /> Geral</TabsTrigger>
                    <TabsTrigger value="members" className="gap-2"><Users className="h-4 w-4" /> Membros & Convites</TabsTrigger>
                </TabsList>

                <TabsContent value="general">
                    <form ref={formRef} onSubmit={handleSubmit} encType="multipart/form-data" className="space-y-6">
                        <input type="hidden" name="workspaceId" value={activeWorkspace.id} />

                        <Card className="border-none shadow-sm bg-card/50">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-xl"><Building2 className="h-5 w-5 text-primary" /> Identidade Visual</CardTitle>
                                <CardDescription>Como sua equipe é vista na plataforma.</CardDescription>
                            </CardHeader>
                            <CardContent className="flex items-start gap-8">
                                <div className="relative group">
                                    <Avatar className="h-28 w-28 rounded-2xl shadow-lg border-2 border-background ring-2 ring-border/50">
                                        <AvatarImage src={avatarUrl} alt={activeWorkspace.name} className="object-cover" />
                                        <AvatarFallback className="text-4xl font-bold rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 text-primary">{activeWorkspace.name.charAt(0).toUpperCase()}</AvatarFallback>
                                    </Avatar>
                                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                                        <UploadCloud className="h-8 w-8 text-white" />
                                    </div>
                                </div>

                                <div className="flex-1 space-y-4 max-w-md">
                                    <div className="space-y-2">
                                        <Label>Logo / Avatar</Label>
                                        <div className="flex gap-3">
                                            <input type="file" name="avatarFile" ref={fileInputRef} onChange={handleAvatarChange} className="hidden" accept="image/*" />
                                            <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
                                                Alterar Imagem
                                            </Button>
                                            <Button type="button" variant="ghost" className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20">
                                                Remover
                                            </Button>
                                        </div>
                                        <p className="text-xs text-muted-foreground leading-relaxed">
                                            Recomendado: 500x500px. Suporta PNG, JPG e GIF.<br />
                                            Essa imagem será exibida na barra lateral e nos chats.
                                        </p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <div className="grid gap-6 md:grid-cols-2">
                            <Card className="border-none shadow-sm bg-card/50">
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2"><Globe className="h-5 w-5 text-blue-500" /> Informações Básicas</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="workspaceName">Nome da Empresa / Equipe</Label>
                                        <Input
                                            id="workspaceName"
                                            name="workspaceName"
                                            defaultValue={activeWorkspace.name}
                                            className="font-medium text-lg h-11"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="timezone">Fuso Horário Operacional</Label>
                                        <Select name="timezone" defaultValue={(activeWorkspace as any).timezone || 'America/Sao_Paulo'}>
                                            <SelectTrigger id="timezone" className="h-11">
                                                <SelectValue placeholder="Selecione um fuso horário" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {timezones.map(tz => (
                                                    <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <p className="text-xs text-muted-foreground">Afeta o horário de funcionamento e agendamentos.</p>
                                    </div>
                                </CardContent>
                            </Card>

                            <Card className="border-none shadow-sm bg-card/50">
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2"><Timer className="h-5 w-5 text-orange-500" /> Automação de Sessão</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="marketingAutoCloseSeconds">Auto-encerrar Marketing (Segundos)</Label>
                                        <div className="relative">
                                            <Input
                                                id="marketingAutoCloseSeconds"
                                                name="marketingAutoCloseSeconds"
                                                type="number"
                                                min={0}
                                                step={1}
                                                defaultValue={(activeWorkspace as any).marketingAutoCloseSeconds ?? 300}
                                                className="pl-10 h-11"
                                            />
                                            <Clock className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            Tempo sem resposta para encerrar conversas de campanhas.
                                            <span className="font-semibold block mt-1">0 = Desativado.</span>
                                        </p>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>



                        <Card className="border-none shadow-sm bg-card/50">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2"><MessageSquare className="h-5 w-5 text-green-500" /> Mensagens Globais</CardTitle>
                                <CardDescription>Textos padrão usados em automações e encerramentos rápidos.</CardDescription>
                            </CardHeader>
                            <CardContent className="grid md:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <Label htmlFor="closeMessageTemplate" className="text-xs uppercase font-bold text-muted-foreground tracking-wider">Encerramento</Label>
                                    <Textarea
                                        id="closeMessageTemplate"
                                        name="closeMessageTemplate"
                                        placeholder="Ex.: Obrigado pelo contato! Encerramos seu atendimento..."
                                        defaultValue={activeWorkspace.closeMessageTemplate || ''}
                                        className="min-h-[120px] resize-none focus:ring-green-500/20 border-muted-foreground/20"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="transferMessageTemplate" className="text-xs uppercase font-bold text-muted-foreground tracking-wider">Transferência</Label>
                                    <Textarea
                                        id="transferMessageTemplate"
                                        name="transferMessageTemplate"
                                        placeholder="Ex.: Seu atendimento será transferido para a equipe..."
                                        defaultValue={activeWorkspace.transferTeamMessageTemplate || ''}
                                        className="min-h-[120px] resize-none focus:ring-green-500/20 border-muted-foreground/20"
                                    />
                                </div>
                            </CardContent>
                            <CardFooter className="py-6 border-t bg-muted/20 flex justify-end">
                                <SubmitButton />
                            </CardFooter>
                        </Card>
                    </form>

                    <Card className="mt-8 border-red-100 bg-red-50/30 dark:bg-red-950/5">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
                                <LogIn className="h-5 w-5" /> Entrar em outro Workspace
                            </CardTitle>
                            <CardDescription>Recebeu um código de convite? Use-o para se juntar a outra equipe.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <JoinWorkspaceForm className="max-w-md" />
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="members" className="space-y-6">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between">
                            <div>
                                <CardTitle className="flex items-center gap-2"><Mail className="h-5 w-5 text-primary" /> Convites Pendentes</CardTitle>
                                <CardDescription>Gerencie links de acesso ao seu workspace.</CardDescription>
                            </div>
                            <Dialog open={isInviteModalOpen} onOpenChange={setIsInviteModalOpen}>
                                <DialogTrigger asChild>
                                    <Button size="sm" className="gap-2">
                                        <PlusCircle className="h-4 w-4" />
                                        Criar Novo Convite
                                    </Button>
                                </DialogTrigger>
                                <DialogContent>
                                    <form action={inviteAction}>
                                        <input type="hidden" name="workspaceId" value={activeWorkspace.id} />
                                        <DialogHeader>
                                            <DialogTitle>Gerar Link de Convite</DialogTitle>
                                            <DialogDescription>
                                                Configure a validade e limite de usos para este link.
                                            </DialogDescription>
                                        </DialogHeader>
                                        <div className="space-y-4 py-4">
                                            <div className="space-y-2">
                                                <Label htmlFor="expiresIn">Expira em</Label>
                                                <Select name="expiresIn" defaultValue="86400">
                                                    <SelectTrigger id="expiresIn">
                                                        <SelectValue placeholder="Selecione a validade" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="3600">1 Hora</SelectItem>
                                                        <SelectItem value="86400">1 Dia</SelectItem>
                                                        <SelectItem value="604800">7 Dias</SelectItem>
                                                        <SelectItem value="2592000">30 Dias</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="space-y-2">
                                                <Label htmlFor="maxUses">Limite de Usos</Label>
                                                <Input id="maxUses" name="maxUses" type="number" placeholder="Vazio = Ilimitado" />
                                                <p className="text-xs text-muted-foreground">Quantas pessoas podem usar este mesmo link.</p>
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
                            <div className="rounded-md border">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="bg-muted/50">
                                            <TableHead>Link de Acesso</TableHead>
                                            <TableHead>Validade</TableHead>
                                            <TableHead>Uso</TableHead>
                                            <TableHead className="text-right">Ações</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {invites.map(invite => (
                                            <TableRow key={invite.id}>
                                                <TableCell className="font-mono text-xs">
                                                    <div className="flex items-center gap-2 max-w-[300px]">
                                                        <Badge variant="outline" className="bg-background">{invite.code.substring(0, 8)}...</Badge>
                                                        <CopyButton text={`${baseUrl}/join/${invite.code}`} />
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex items-center gap-2">
                                                        <Clock className="h-3 w-3 text-muted-foreground" />
                                                        {formatDistanceToNowStrict(new Date(invite.expires_at), { addSuffix: true, locale: ptBR })}
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant={invite.max_uses && invite.use_count >= invite.max_uses ? "secondary" : "outline"}>
                                                        {invite.use_count} / {invite.max_uses || '∞'}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <Button variant="ghost" size="sm" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={() => handleRevokeInvite(invite.id)}>
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                        {invites.length === 0 && (
                                            <TableRow>
                                                <TableCell colSpan={4} className="text-center py-12 text-muted-foreground">
                                                    <div className="flex flex-col items-center gap-2">
                                                        <Mail className="h-8 w-8 opacity-20" />
                                                        <p>Nenhum convite ativo no momento.</p>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    )
}
