'use client';

import { useActionState, useEffect, useState, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { Loader2, Save, UserCircle, UploadCloud, Bell } from "lucide-react";
import { useSettings } from "../settings-context";
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { updateUserProfile } from '@/actions/user';
import { toast } from '@/hooks/use-toast';
import { createClient } from '@/lib/supabase/client';
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
          Salvar Alteracoes
        </>
      )}
    </Button>
  );
}

function NotificationSettings() {
  const [queueSoundEnabled, setQueueSoundEnabled] = useState(true);
  const [attendingSoundEnabled, setAttendingSoundEnabled] = useState(true);

  useEffect(() => {
    const storedLegacy = localStorage.getItem('notificationSoundEnabled');
    const storedQueue = localStorage.getItem('notificationSoundQueueEnabled');
    const storedAttending = localStorage.getItem('notificationSoundAttendingEnabled');

    if (storedLegacy !== null) {
      const parsed = JSON.parse(storedLegacy);
      setQueueSoundEnabled(parsed);
      setAttendingSoundEnabled(parsed);
    }
    if (storedQueue !== null) {
      setQueueSoundEnabled(JSON.parse(storedQueue));
    }
    if (storedAttending !== null) {
      setAttendingSoundEnabled(JSON.parse(storedAttending));
    }
  }, []);

  const handleToggle = (key: 'queue' | 'attending', enabled: boolean) => {
    const storageKey = key === 'queue'
      ? 'notificationSoundQueueEnabled'
      : 'notificationSoundAttendingEnabled';

    const nextQueue = key === 'queue' ? enabled : queueSoundEnabled;
    const nextAttending = key === 'attending' ? enabled : attendingSoundEnabled;

    setQueueSoundEnabled(nextQueue);
    setAttendingSoundEnabled(nextAttending);

    localStorage.setItem(storageKey, JSON.stringify(enabled));
    localStorage.setItem('notificationSoundEnabled', JSON.stringify(nextQueue || nextAttending));
    toast({
      title: `Audio de ${key === 'queue' ? 'fila' : 'atendimento'} ${enabled ? 'ativado' : 'desativado'}.`,
    });
  };

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="space-y-0.5">
        <Label className="text-base">Alertas sonoros</Label>
        <p className="text-sm text-muted-foreground">
          Ative ou desative os sons para novas mensagens em fila ou em atendimento.
        </p>
      </div>
      <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2">
        <div className="space-y-0.5">
          <Label htmlFor="queue-sound-switch" className="text-sm">Som para fila</Label>
          <p className="text-xs text-muted-foreground">Toca quando chega nova mensagem na fila (gerais).</p>
        </div>
        <Switch
          id="queue-sound-switch"
          checked={queueSoundEnabled}
          onCheckedChange={(enabled) => handleToggle('queue', enabled)}
        />
      </div>
      <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2">
        <div className="space-y-0.5">
          <Label htmlFor="attending-sound-switch" className="text-sm">Som para atendendo</Label>
          <p className="text-xs text-muted-foreground">Toca quando chega mensagem em atendimentos ativos.</p>
        </div>
        <Switch
          id="attending-sound-switch"
          checked={attendingSoundEnabled}
          onCheckedChange={(enabled) => handleToggle('attending', enabled)}
        />
      </div>
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
      setAvatarUrl(previewUrl);
    }
  };

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
        toast({ title: "Erro no Upload", description: error.message, variant: 'destructive' });
        setIsUploading(false);
        return;
      }

      const { data: urlData } = supabase.storage
        .from('photo_user')
        .getPublicUrl(data.path);

      finalAvatarUrl = urlData.publicUrl;
      setAvatarUrl(finalAvatarUrl);
      setAvatarFile(null);
      setIsUploading(false);
    }

    formData.set('avatarUrl', finalAvatarUrl);
    formAction(formData);
  };

  useEffect(() => {
    if (state.success) {
      toast({
        title: "Perfil Atualizado!",
        description: "Suas informacoes foram salvas com sucesso.",
      });
      setAvatarFile(null);
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
    </div>;
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <UserCircle />
          Perfil e Preferencias
        </h1>
        <p className="text-muted-foreground">Gerencie suas informacoes pessoais e aparencia na plataforma.</p>
      </header>

      <form ref={formRef} onSubmit={handleSubmit}>
        <input type="hidden" name="avatarUrl" value={avatarUrl} />
        <Card>
          <CardHeader>
            <CardTitle>Informacoes Pessoais</CardTitle>
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
                <p className="text-xs text-muted-foreground">PNG, JPG, GIF ate 2MB.</p>
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
              {isUploading ? 'Enviando imagem...' : 'Salvar Alteracoes'}
            </Button>
          </CardFooter>
        </Card>
      </form>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Bell />Notificacoes</CardTitle>
          <CardDescription>Gerencie como voce recebe alertas.</CardDescription>
        </CardHeader>
        <CardContent>
          <NotificationSettings />
        </CardContent>
      </Card>
    </div>
  );
}
