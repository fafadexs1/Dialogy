
'use client';

import React, { useState, useEffect, useActionState, useOptimistic, useCallback } from 'react';
import { Loader2, MessageSquareQuote, Plus, Trash2, Edit, Save, Globe, Lock, AlertCircle, Users, Sparkles, Command, Keyboard } from 'lucide-react';
import type { Shortcut, User, Team } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { useFormStatus } from 'react-dom';
import { getShortcuts, saveShortcut, deleteShortcut } from '@/actions/shortcuts';
import { getTeams } from '@/actions/teams';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useSettings } from '../settings-context';
import { Badge } from '@/components/ui/badge';
import { useI18n } from '@/i18n/i18n-provider';

function SubmitButton({ isEditing }: { isEditing: boolean }) {
    const { t } = useI18n();
    const { pending } = useFormStatus();
    return (
        <Button type="submit" disabled={pending} className="min-w-[140px]">
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {pending ? t("Salvando...") : (
                <>
                    <Save className="mr-2 h-4 w-4" />
                    {isEditing ? t("Salvar alteracoes") : t("Criar atalho")}
                </>
            )}
        </Button>
    )
}


export default function ShortcutsPage() {
    const { t } = useI18n();
    const { user } = useSettings();
    const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
    const [teams, setTeams] = useState<Team[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingShortcut, setEditingShortcut] = useState<Shortcut | null>(null);
    const [isFormVisible, setIsFormVisible] = useState(false);
    const [selectedType, setSelectedType] = useState<'global' | 'private' | 'team'>('private');

    const [state, formAction] = useActionState(saveShortcut, { success: false, error: null });

    const fetchData = useCallback(async (workspaceId: string) => {
        if (!workspaceId) return;
        setLoading(true);
        const [shortcutsResult, teamsResult] = await Promise.all([
            getShortcuts(workspaceId),
            getTeams(workspaceId)
        ]);

        if (shortcutsResult.error) {
            toast({ title: t("Erro ao carregar atalhos"), description: shortcutsResult.error, variant: 'destructive' });
        } else {
            setShortcuts(shortcutsResult.shortcuts || []);
        }

        if (teamsResult.teams) {
            setTeams(teamsResult.teams);
        }

        setLoading(false);
    }, []);

    useEffect(() => {
        if (user?.activeWorkspaceId) {
            fetchData(user.activeWorkspaceId);
        } else if (user) {
            setLoading(false);
        }
    }, [user, fetchData]);

    useEffect(() => {
        if (state.success) {
            toast({ title: t("Atalho salvo!"), description: t("Sua resposta rapida esta pronta para uso.") });
            setIsFormVisible(false);
            setEditingShortcut(null);
            if (user?.activeWorkspaceId) fetchData(user.activeWorkspaceId);
        } else if (state.error) {
            toast({ title: t("Erro ao salvar"), description: state.error, variant: "destructive" });
        }
    }, [state, fetchData, user?.activeWorkspaceId]);

    const handleEdit = (shortcut: Shortcut) => {
        setEditingShortcut(shortcut);
        setSelectedType(shortcut.type);
        setIsFormVisible(true);
    };

    const handleAddNew = () => {
        setEditingShortcut(null);
        setSelectedType('private');
        setIsFormVisible(true);
    };

    const handleCancel = () => {
        setEditingShortcut(null);
        setIsFormVisible(false);
    };

    const handleDelete = async (shortcutId: string) => {
        const result = await deleteShortcut(shortcutId);
        if (result.success) {
            toast({ title: t("Atalho removido") });
            if (user?.activeWorkspaceId) fetchData(user.activeWorkspaceId);
        } else {
            toast({ title: t("Erro ao remover"), description: result.error, variant: 'destructive' });
        }
    }

    if (!user) {
        return <div className="flex items-center justify-center h-full text-muted-foreground"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }

    return (
        <div className="max-w-5xl mx-auto space-y-8 pb-10">
            <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">{t("Atalhos")}</h1>
                    <p className="text-muted-foreground mt-1 text-lg">{t("Respostas rapidas para agilizar seu atendimento.")}</p>
                </div>
                {!isFormVisible && (
                    <Button onClick={handleAddNew} size="lg" className="shadow-lg hover:shadow-xl transition-all">
                        <Plus className="mr-2 h-5 w-5" />
                        {t("Novo atalho")}
                    </Button>
                )}
            </header>

            {isFormVisible && (
                <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
                    <Card className="w-full max-w-2xl border-none shadow-2xl bg-card animate-in fade-in zoom-in-95 duration-200">
                        <form action={formAction}>
                            <input type="hidden" name="workspaceId" value={user.activeWorkspaceId || ''} />
                            <input type="hidden" name="id" value={editingShortcut?.id || ''} />
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-xl">
                                    {editingShortcut ? <Edit className="h-5 w-5 text-primary" /> : <Sparkles className="h-5 w-5 text-primary" />}
                                    {editingShortcut ? t("Editar atalho") : t("Criar novo atalho")}
                                </CardTitle>
                                <CardDescription>{t("Configure o gatilho e a mensagem.")}</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="space-y-2">
                                        <Label htmlFor="name" className="text-base font-semibold">{t("Gatilho (comando)")}</Label>
                                        <div className="relative group">
                                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-muted-foreground group-focus-within:text-primary transition-colors">/</div>
                                            <Input id="name" name="name" placeholder={t("exemplo")} required defaultValue={editingShortcut?.name} className="pl-7 h-12 text-lg font-mono" />
                                        </div>
                                        <p className="text-xs text-muted-foreground">{t("Digite este comando no chat para inserir a mensagem.")}</p>
                                    </div>

                                    <div className="space-y-2">
                                        <Label className="text-base font-semibold">{t("Visibilidade")}</Label>
                                        <Select
                                            name="type"
                                            value={selectedType}
                                            onValueChange={(v: any) => setSelectedType(v)}
                                        >
                                            <SelectTrigger className="h-12">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="private"><div className="flex items-center gap-2"><Lock className="h-4 w-4" /> {t("Privado (so eu vejo)")}</div></SelectItem>
                                                <SelectItem value="team"><div className="flex items-center gap-2"><Users className="h-4 w-4" /> {t("Equipe (todos da equipe)")}</div></SelectItem>
                                                <SelectItem value="global"><div className="flex items-center gap-2"><Globe className="h-4 w-4" /> {t("Global (todo o workspace)")}</div></SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>

                                {selectedType === 'team' && (
                                    <div className="space-y-2 animate-in slide-in-from-top-2">
                                        <Label htmlFor="teamId">{t("Selecione a equipe")}</Label>
                                        <Select name="teamId" required defaultValue={editingShortcut?.team_id}>
                                            <SelectTrigger className="h-11">
                                                <SelectValue placeholder={t("Selecione uma equipe...")} />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {teams.map(team => (
                                                    <SelectItem key={team.id} value={team.id}>
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: team.color }} />
                                                            {team.name}
                                                        </div>
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                )}

                                <div className="space-y-2">
                                    <Label htmlFor="message" className="text-base font-semibold">{t("Mensagem completa")}</Label>
                                    <Textarea
                                        id="message"
                                        name="message"
                                        required
                                        rows={6}
                                        placeholder={t("Ola! Como posso ajudar voce hoje?")}
                                        defaultValue={editingShortcut?.message}
                                        className="resize-none text-base leading-relaxed"
                                    />
                                    <p className="text-xs text-muted-foreground text-right">{editingShortcut?.message?.length || 0} {t("caracteres")}</p>
                                </div>

                                {state.error && (
                                    <Alert variant="destructive">
                                        <AlertCircle className="h-4 w-4" />
                                        <AlertTitle>{t("Erro ao salvar")}</AlertTitle>
                                        <AlertDescription>{state.error}</AlertDescription>
                                    </Alert>
                                )}
                            </CardContent>
                            <CardFooter className="flex justify-end gap-3 bg-muted/20 py-4">
                                <Button type="button" variant="ghost" onClick={handleCancel}>{t("Cancelar")}</Button>
                                <SubmitButton isEditing={!!editingShortcut} />
                            </CardFooter>
                        </form>
                    </Card>
                </div>
            )}

            <div className="space-y-4">
                {loading ? (
                    <div className="flex justify-center p-12"><Loader2 className="h-10 w-10 animate-spin text-muted-foreground" /></div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {shortcuts.map(shortcut => (
                            <Card key={shortcut.id} className="group hover:shadow-lg transition-all border-muted/60 relative overflow-hidden">
                                <div className={`absolute top-0 left-0 w-1 h-full ${shortcut.type === 'global' ? 'bg-blue-500' :
                                    shortcut.type === 'team' ? 'bg-orange-500' : 'bg-slate-500'
                                    }`} />
                                <CardHeader className="pl-6 pb-2">
                                    <div className="flex justify-between items-start">
                                        <Badge variant="secondary" className="font-mono text-sm px-2 py-0.5 border-primary/20 bg-primary/5 text-primary">
                                            /{shortcut.name}
                                        </Badge>
                                        <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                                            <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-primary/10 hover:text-primary" onClick={() => handleEdit(shortcut)}>
                                                <Edit className="h-4 w-4" />
                                            </Button>
                                            <AlertDialog>
                                                <AlertDialogTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-destructive/10 hover:text-destructive" disabled={shortcut.type !== 'global' && shortcut.user_id !== user.id}>
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </AlertDialogTrigger>
                                                <AlertDialogContent>
                                                    <AlertDialogHeader>
                                                        <AlertDialogTitle>{t("Excluir atalho")}</AlertDialogTitle>
                                                        <AlertDialogDescription>
                                                            {t("Tem certeza que deseja apagar o atalho {shortcut}?", { shortcut: `/${shortcut.name}` })}
                                                        </AlertDialogDescription>
                                                    </AlertDialogHeader>
                                                    <AlertDialogFooter>
                                                        <AlertDialogCancel>{t("Cancelar")}</AlertDialogCancel>
                                                        <AlertDialogAction onClick={() => handleDelete(shortcut.id)} className="bg-destructive hover:bg-destructive/90">{t("Excluir")}</AlertDialogAction>
                                                    </AlertDialogFooter>
                                                </AlertDialogContent>
                                            </AlertDialog>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 mt-2">
                                        {shortcut.type === 'global' && <Badge variant="outline" className="text-xs font-normal gap-1 h-5"><Globe className="h-3 w-3" /> {t("Global")}</Badge>}
                                        {shortcut.type === 'private' && <Badge variant="outline" className="text-xs font-normal gap-1 h-5"><Lock className="h-3 w-3" /> {t("Privado")}</Badge>}
                                        {shortcut.type === 'team' && <Badge variant="outline" className="text-xs font-normal gap-1 h-5"><Users className="h-3 w-3" /> {shortcut.team_name || t("Equipe")}</Badge>}
                                    </div>
                                </CardHeader>
                                <CardContent className="pl-6 pt-2">
                                    <div className="bg-muted/30 p-3 rounded-md text-sm text-foreground/80 line-clamp-4 min-h-[5rem] group-hover:bg-muted/50 transition-colors">
                                        {shortcut.message}
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}

                {!loading && shortcuts.length === 0 && !isFormVisible && (
                    <div className="flex flex-col items-center justify-center p-16 text-center border-2 border-dashed rounded-xl bg-muted/10">
                        <div className="p-4 bg-muted/30 rounded-full mb-4">
                            <Keyboard className="h-10 w-10 text-muted-foreground" />
                        </div>
                        <h3 className="text-xl font-semibold">{t("Sua lista de atalhos esta vazia")}</h3>
                        <p className="text-muted-foreground mt-2 max-w-md mx-auto">
                            {t("Crie atalhos para responder perguntas frequentes com apenas alguns cliques.")}
                        </p>
                        <Button onClick={handleAddNew} className="mt-6">
                            <Plus className="mr-2 h-4 w-4" />
                            {t("Comecar agora")}
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
}
