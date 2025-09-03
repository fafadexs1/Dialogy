'use client';

import { useActionState, useEffect, useState, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { Loader2, User, Save, Mail, Image as ImageIcon, UserCircle, UploadCloud, Sun, Moon, Monitor, Bell } from "lucide-react";
import { useSettings } from "../settings-context";
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { updateUserProfile } from '@/actions/user';
import { toast } from '@/hooks/use-toast';
import { Separator } from '@/components/ui/separator';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';


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

function ThemeSwitcher() {
    const [theme, setTheme] = useState(() => {
        if (typeof window !== 'undefined') {
            return localStorage.getItem('theme') || 'system';
        }
        return 'system';
    });

    useEffect(() => {
        const root = window.document.documentElement;
        root.classList.remove('light', 'dark');

        if (theme === 'system') {
            const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
            root.classList.add(systemTheme);
        } else {
            root.classList.add(theme);
        }
        localStorage.setItem('theme', theme);
    }, [theme]);

    return (
        <div className='flex items-center gap-2'>
             <Button
                variant={theme === 'light' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTheme('light')}
            >
                <Sun className="mr-2 h-4 w-4" /> Claro
            </Button>
            <Button
                variant={theme === 'dark' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTheme('dark')}
            >
                <Moon className="mr-2 h-4 w-4" /> Escuro
            </Button>
             <Button
                variant={theme === 'system' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTheme('system')}
            >
                <Monitor className="mr-2 h-4 w-4" /> Sistema
            </Button>
        </div>
    )
}

function NotificationSettings() {
    const [soundEnabled, setSoundEnabled] = useState(true);

    useEffect(() => {
        const storedValue = localStorage.getItem('notificationSoundEnabled');
        if (storedValue !== null) {
            setSoundEnabled(JSON.parse(storedValue));
        }
    }, []);

    const handleSoundToggle = (enabled: boolean) => {
        setSoundEnabled(enabled);
        localStorage.setItem('notificationSoundEnabled', JSON.stringify(enabled));
        toast({
            title: `Notificações sonoras ${enabled ? 'ativadas' : 'desativadas'}.`,
        });
    };

    return (
        <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
                <Label htmlFor="sound-switch" className="text-base">Som de notificação</Label>
                <p className="text-sm text-muted-foreground">
                    Receber um alerta sonoro para novas mensagens em seus atendimentos.
                </p>
            </div>
            <Switch
                id="sound-switch"
                checked={soundEnabled}
                onCheckedChange={handleSoundToggle}
            />
        </div>
    );
}

export default function ProfilePage() {
    const { user, loading } = useSettings();
    const [state, formAction] = useActionState(updateUserProfile, { success: false, error: null });

    const [fullName, setFullName] = useState('');
    const [avatarUrl, setAvatarUrl] = useState('');
    const [avatarFile, setAvatarFile] = useState<File | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const formRef = useRef<HTMLFormElement>(null);

    useEffect(() => {
        if (user) {
            setFullName(user.name || '');
            setAvatarUrl(user.avatar || '');
        }
    }, [user]);
    
    const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setAvatarFile(file);
            const previewUrl = URL.createObjectURL(file);
            setAvatarUrl(previewUrl); // Show preview
        }
    }

     const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        
        let finalAvatarUrl = avatarUrl;
        if (avatarFile) {
            setIsUploading(true);
            const supabase = createClient();
            const fileName = `${user!.id}-${Date.now()}`;
            const { data, error } = await supabase.storage
                .from('photo_user')
                .upload(fileName, avatarFile);

            if (error) {
                toast({ title: "Erro no Upload", description: error.message, variant: 'destructive'});
                setIsUploading(false);
                return;
            }
            
            const { data: urlData } = supabase.storage
                .from('photo_user')
                .getPublicUrl(data.path);
            
            finalAvatarUrl = urlData.publicUrl;
            setAvatarUrl(finalAvatarUrl);
            setAvatarFile(null); // Reset file input
            setIsUploading(false);
        }
        
        formData.set('avatarUrl', finalAvatarUrl);
        formAction(formData);
    };

    useEffect(() => {
        if (state.success) {
            toast({
                title: "Perfil Atualizado!",
                description: "Suas informações foram salvas com sucesso.",
            });
            setAvatarFile(null); // Reset file after successful upload
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

            <form ref={formRef} onSubmit={handleSubmit}>
                 <input type="hidden" name="avatarUrl" value={avatarUrl} />
                 <Card>
                    <CardHeader>
                         <CardTitle>Informações Pessoais</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="flex items-center gap-6">
                            <Avatar className="h-20 w-20 border">
                                <AvatarImage src={avatarUrl} alt={fullName} />
                                <AvatarFallback className="text-3xl">{fullName.charAt(0)}</AvatarFallback>
                            </Avatar>
                             <div className="space-y-2">
                                <Label>Foto de Perfil</Label>
                                <div className="flex gap-2">
                                    <input type="file" ref={fileInputRef} onChange={handleAvatarChange} className="hidden" accept="image/*" />
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
                    </CardContent>
                     <CardFooter className="border-t pt-6 flex justify-end">
                        <Button type="submit" disabled={isUploading}>
                            {isUploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {isUploading ? 'Enviando imagem...' : 'Salvar Alterações'}
                        </Button>
                    </CardFooter>
                </Card>
            </form>

            <Card>
                <CardHeader>
                    <CardTitle>Tema da Interface</CardTitle>
                    <CardDescription>Escolha como deseja visualizar a plataforma.</CardDescription>
                </CardHeader>
                <CardContent>
                    <ThemeSwitcher/>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className='flex items-center gap-2'><Bell/>Notificações</CardTitle>
                    <CardDescription>Gerencie como você recebe alertas.</CardDescription>
                </CardHeader>
                <CardContent>
                    <NotificationSettings />
                </CardContent>
            </Card>
        </div>
    )
}
