
'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Loader2, User, Save, Mail, Image as ImageIcon, Briefcase, UserCircle } from "lucide-react";
import { useSettings } from "../settings-context";
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { updateUserProfile } from '@/actions/user';
import { toast } from '@/hooks/use-toast';
import { Separator } from '@/components/ui/separator';

function SubmitButton() {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" disabled={pending}>
            {pending ? (
                <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Salvando...
                </>
            ) : (
                <>
                    <Save className="mr-2 h-4 w-4" />
                    Salvar Alterações
                </>
            )}
        </Button>
    )
}

export default function ProfilePage() {
    const { user, loading } = useSettings();
    const [state, formAction] = useActionState(updateUserProfile, { success: false, error: null });

    const [fullName, setFullName] = useState('');
    const [avatarUrl, setAvatarUrl] = useState('');

    useEffect(() => {
        if (user) {
            setFullName(user.name || '');
            setAvatarUrl(user.avatar || '');
        }
    }, [user]);

    useEffect(() => {
        if (state.success) {
            toast({
                title: "Perfil Atualizado!",
                description: "Suas informações foram salvas com sucesso.",
            });
        } else if (state.error) {
            toast({
                title: "Erro ao Atualizar",
                description: state.error,
                variant: "destructive",
            });
        }
    }, [state]);

    if (loading || !user) {
        return <div className="flex items-center justify-center h-full">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
    }

    return (
        <div className="max-w-4xl mx-auto space-y-8">
            <header className="mb-6">
                <h1 className="text-2xl font-bold flex items-center gap-2">
                    <UserCircle />
                    Perfil e Preferências
                </h1>
                <p className="text-muted-foreground">Gerencie suas informações pessoais e aparência na plataforma.</p>
            </header>

            <form action={formAction}>
                 <Card>
                    <CardHeader className="flex-col md:flex-row items-start md:items-center gap-4">
                        <Avatar className="h-20 w-20 border">
                            <AvatarImage src={avatarUrl} alt={fullName} />
                            <AvatarFallback className="text-3xl">{fullName.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                            <CardTitle>{fullName}</CardTitle>
                            <CardDescription>{user.email}</CardDescription>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <Label htmlFor="fullName">Nome Completo</Label>
                                <Input
                                    id="fullName"
                                    name="fullName"
                                    value={fullName}
                                    onChange={(e) => setFullName(e.target.value)}
                                    placeholder="Seu nome completo"
                                />
                            </div>
                             <div className="space-y-2">
                                <Label htmlFor="email">E-mail</Label>
                                <Input
                                    id="email"
                                    name="email"
                                    value={user.email || ''}
                                    disabled
                                    readOnly
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                             <Label htmlFor="avatarUrl">URL do Avatar</Label>
                            <Input
                                id="avatarUrl"
                                name="avatarUrl"
                                value={avatarUrl}
                                onChange={(e) => setAvatarUrl(e.target.value)}
                                placeholder="https://exemplo.com/sua-foto.png"
                            />
                        </div>
                        <Separator/>
                        <div className="space-y-2">
                            <h3 className="font-medium text-muted-foreground">Em breve...</h3>
                             <p className="text-sm text-muted-foreground">Mais configurações de preferência como tema (claro/escuro) e notificações estarão disponíveis aqui.</p>
                        </div>
                    </CardContent>
                    <CardFooter className="border-t pt-6 flex justify-end">
                        <SubmitButton />
                    </CardFooter>
                </Card>
            </form>
        </div>
    )
}
