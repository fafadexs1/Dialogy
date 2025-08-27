

'use client';

import React, { useState, useEffect, useActionState, useOptimistic, useCallback } from 'react';
import { Loader2, MessageSquareQuote, Plus, Trash2, Edit, Save, Globe, Lock, AlertCircle } from 'lucide-react';
import type { Shortcut, User } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { useFormStatus } from 'react-dom';
import { getShortcuts, saveShortcut, deleteShortcut } from '@/actions/shortcuts';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
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

function SubmitButton({ isEditing }: { isEditing: boolean }) {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <Save className="mr-2 h-4 w-4"/> 
            {isEditing ? 'Salvar Alterações' : 'Salvar Atalho'}
        </Button>
    )
}


export default function ShortcutsPage() {
    const [user, setUser] = useState<User | null>(null);
    const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingShortcut, setEditingShortcut] = useState<Shortcut | null>(null);
    const [isFormVisible, setIsFormVisible] = useState(false);

    const [state, formAction] = useActionState(saveShortcut, { success: false, error: null });

    const fetchData = useCallback(async (workspaceId: string) => {
        if (!workspaceId) return;
        setLoading(true);
        const result = await getShortcuts(workspaceId);
        if (result.error) {
            toast({ title: "Erro ao carregar atalhos", description: result.error, variant: 'destructive' });
        } else {
            setShortcuts(result.shortcuts || []);
        }
        setLoading(false);
    }, []);

     useEffect(() => {
        const fetchUser = async () => {
            const res = await fetch('/api/user');
            if (res.ok) {
                const userData = await res.json();
                setUser(userData);
                if (userData.activeWorkspaceId) {
                    fetchData(userData.activeWorkspaceId);
                }
            } else {
                setLoading(false);
            }
        };
        fetchUser();
    }, [fetchData]);

    useEffect(() => {
        if(state.success) {
            toast({ title: 'Sucesso!', description: 'Seu atalho foi salvo.' });
            setIsFormVisible(false);
            setEditingShortcut(null);
            if(user?.activeWorkspaceId) fetchData(user.activeWorkspaceId);
        }
    }, [state, fetchData, user?.activeWorkspaceId]);

    const handleEdit = (shortcut: Shortcut) => {
        setEditingShortcut(shortcut);
        setIsFormVisible(true);
    };

    const handleAddNew = () => {
        setEditingShortcut(null);
        setIsFormVisible(true);
    };

    const handleCancel = () => {
        setEditingShortcut(null);
        setIsFormVisible(false);
    };
    
    const handleDelete = async (shortcutId: string) => {
        const result = await deleteShortcut(shortcutId);
        if(result.success) {
            toast({ title: 'Atalho removido!'});
            if (user?.activeWorkspaceId) fetchData(user.activeWorkspaceId);
        } else {
            toast({ title: 'Erro ao remover', description: result.error, variant: 'destructive'});
        }
    }

    if (!user) {
        return <div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
    }
    
    return (
        <div className="max-w-4xl space-y-8">
            <header className="mb-6 flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <MessageSquareQuote />
                        Atalhos de Mensagens
                    </h1>
                    <p className="text-muted-foreground">Crie e gerencie respostas rápidas para agilizar o atendimento.</p>
                </div>
                 {!isFormVisible && (
                    <Button onClick={handleAddNew}>
                        <Plus className="mr-2 h-4 w-4" />
                        Criar Atalho
                    </Button>
                )}
            </header>

            {isFormVisible && (
                 <Card>
                    <form action={formAction}>
                        <input type="hidden" name="workspaceId" value={user.activeWorkspaceId || ''} />
                        <input type="hidden" name="id" value={editingShortcut?.id || ''} />
                        <CardHeader>
                            <CardTitle>{editingShortcut ? 'Editar Atalho' : 'Criar Novo Atalho'}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                             <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="space-y-2 md:col-span-2">
                                    <Label htmlFor="name">Comando do Atalho</Label>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-muted-foreground">/</div>
                                        <Input id="name" name="name" placeholder="saudacao" required defaultValue={editingShortcut?.name} className="pl-6" />
                                    </div>
                                </div>
                                 <div className="space-y-2">
                                    <Label>Tipo de Atalho</Label>
                                    <RadioGroup name="type" defaultValue={editingShortcut?.type || 'private'} className="flex items-center pt-2 gap-4">
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem value="private" id="private" />
                                            <Label htmlFor="private" className="flex items-center gap-1.5"><Lock className="h-4 w-4"/> Privado</Label>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem value="global" id="global" />
                                            <Label htmlFor="global" className="flex items-center gap-1.5"><Globe className="h-4 w-4"/> Global</Label>
                                        </div>
                                    </RadioGroup>
                                </div>
                             </div>
                             <div className="space-y-2">
                                <Label htmlFor="message">Mensagem Completa</Label>
                                <Textarea id="message" name="message" required rows={4} placeholder="Olá! Boas-vindas ao nosso canal de atendimento. Como posso ajudar?" defaultValue={editingShortcut?.message} />
                            </div>
                            {state.error && (
                                <Alert variant="destructive">
                                    <AlertCircle className="h-4 w-4" />
                                    <AlertTitle>Erro ao Salvar</AlertTitle>
                                    <AlertDescription>{state.error}</AlertDescription>
                                </Alert>
                            )}
                        </CardContent>
                        <CardFooter className="gap-2">
                            <SubmitButton isEditing={!!editingShortcut} />
                            <Button type="button" variant="ghost" onClick={handleCancel}>Cancelar</Button>
                        </CardFooter>
                    </form>
                </Card>
            )}

            <div className="space-y-4">
                 {loading ? (
                    <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>
                 ) : shortcuts.map(shortcut => (
                    <Card key={shortcut.id}>
                        <CardHeader className="flex flex-row justify-between items-start">
                           <div>
                             <CardTitle className="font-mono text-base text-primary">/{shortcut.name}</CardTitle>
                             <CardDescription className="flex items-center gap-1.5 mt-1">
                                {shortcut.type === 'global' ? <Globe className="h-3 w-3"/> : <Lock className="h-3 w-3"/>}
                                {shortcut.type === 'global' ? 'Global' : 'Privado'} • Criado por {shortcut.user_id === user.id ? 'você' : shortcut.user_name}
                            </CardDescription>
                           </div>
                           <div className="flex items-center gap-1">
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(shortcut)}><Edit className="h-4 w-4" /></Button>
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-8 w-8" disabled={shortcut.user_id !== user.id}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                                    </AlertDialogTrigger>
                                     <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Tem certeza?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                               Esta ação removerá o atalho <span className="font-bold">/{shortcut.name}</span> permanentemente.
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                            <AlertDialogAction onClick={() => handleDelete(shortcut.id)}>Remover</AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                           </div>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm p-3 bg-secondary/50 rounded-md whitespace-pre-wrap">{shortcut.message}</p>
                        </CardContent>
                    </Card>
                 ))}
                 {!loading && shortcuts.length === 0 && !isFormVisible && (
                     <div className="text-center p-10 border-dashed border-2 rounded-lg">
                        <MessageSquareQuote className="mx-auto h-12 w-12 text-muted-foreground" />
                        <h3 className="mt-4 text-lg font-medium">Nenhum atalho criado ainda</h3>
                        <p className="mt-2 text-sm text-muted-foreground">
                            Clique em "Criar Atalho" para configurar sua primeira resposta rápida.
                        </p>
                    </div>
                 )}
            </div>
        </div>
    );
}
