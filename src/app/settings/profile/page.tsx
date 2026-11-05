'use client';

import { ReactionSoundSettings } from '@/components/team/reaction-sound-settings';
import { useActionState, useEffect, useState, useRef, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { Loader2, Save, UserCircle, UploadCloud, Bell } from "lucide-react";
import { useSettings } from "../settings-context";
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { LogoutTransferSettings } from '@/components/chat/logout-transfer-settings';
import { PersonalInactivitySettings } from '@/components/chat/personal-inactivity-settings';
import { updateUserProfile, updateUserThemePreference } from '@/actions/user';
import { toast } from '@/hooks/use-toast';
import { createClient } from '@/lib/supabase/client';
import { Switch } from '@/components/ui/switch';
import { useI18n } from '@/i18n/i18n-provider';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import type { InterfaceTheme } from '@/lib/types';

function SubmitButton() {
  const { t } = useI18n();
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {t("Salvando...")}
        </>
      ) : (
        <>
          <Save className="mr-2 h-4 w-4" />
          {t("Salvar alteracoes")}
        </>
      )}
    </Button>
  );
}

function NotificationSettings() {
  const { t } = useI18n();
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
      title: t("Audio de {context} {state}.", { context: key === 'queue' ? t("fila") : t("atendimento"), state: enabled ? t("ativado") : t("desativado") }),
    });
  };

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="space-y-0.5">
        <Label className="text-base">{t("Alertas sonoros")}</Label>
        <p className="text-sm text-muted-foreground">
          {t("Ative ou desative os sons para novas mensagens em fila ou em atendimento.")}
        </p>
      </div>
      <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2">
        <div className="space-y-0.5">
          <Label htmlFor="queue-sound-switch" className="text-sm">{t("Som para fila")}</Label>
          <p className="text-xs text-muted-foreground">{t("Toca quando chega nova mensagem na fila (gerais).")}</p>
        </div>
        <Switch
          id="queue-sound-switch"
          checked={queueSoundEnabled}
          onCheckedChange={(enabled) => handleToggle('queue', enabled)}
        />
      </div>
      <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2">
        <div className="space-y-0.5">
          <Label htmlFor="attending-sound-switch" className="text-sm">{t("Som para atendendo")}</Label>
          <p className="text-xs text-muted-foreground">{t("Toca quando chega mensagem em atendimentos ativos.")}</p>
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
  const { t } = useI18n();
  const { user, loading } = useSettings();
  const [state, formAction] = useActionState(updateUserProfile, { success: false, error: null });

  const [fullName, setFullName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isThemePending, startThemeTransition] = useTransition();
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
        toast({ title: t("Erro no upload"), description: error.message, variant: 'destructive' });
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
        title: t("Perfil atualizado!"),
        description: t("Suas informacoes foram salvas com sucesso."),
      });
      setAvatarFile(null);
    } else if (state.error) {
      toast({
        title: t("Erro ao atualizar"),
        description: state.error,
        variant: "destructive",
      });
    }
  }, [state]);

  const handleThemeChange = (theme: InterfaceTheme) => {
    startThemeTransition(async () => {
      const result = await updateUserThemePreference(theme);
      if (!result.success) {
        toast({
          title: t("Erro ao atualizar"),
          description: result.error || t("Nao foi possivel salvar sua preferencia de tema."),
          variant: "destructive",
        });
      }
    });
  };

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
          {t("Perfil e preferencias")}
        </h1>
        <p className="text-muted-foreground">{t("Gerencie suas informacoes pessoais e aparencia na plataforma.")}</p>
      </header>

      <form ref={formRef} onSubmit={handleSubmit}>
        <input type="hidden" name="avatarUrl" value={avatarUrl} />
        <Card>
          <CardHeader>
            <CardTitle>{t("Informacoes pessoais")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center gap-6">
              <Avatar className="h-20 w-20 border">
                <AvatarImage src={avatarUrl} alt={fullName} />
                <AvatarFallback className="text-3xl">{fullName.charAt(0)}</AvatarFallback>
              </Avatar>
              <div className="space-y-2">
                <Label>{t("Foto de perfil")}</Label>
                <div className="flex gap-2">
                  <input type="file" ref={fileInputRef} onChange={handleAvatarChange} className="hidden" accept="image/*" />
                  <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
                    <UploadCloud className="mr-2 h-4 w-4" />
                    {t("Carregar imagem")}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{t("PNG, JPG, GIF ate 2MB.")}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="fullName">{t("Nome completo")}</Label>
                <Input
                  id="fullName"
                  name="fullName"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder={t("Seu nome completo")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">{t("E-mail")}</Label>
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
              {isUploading ? t("Enviando imagem...") : t("Salvar alteracoes")}
            </Button>
          </CardFooter>
        </Card>
      </form>

      <ReactionSoundSettings />
      <PersonalInactivitySettings key={user.activeWorkspaceId || user.id} />
      {user.activeWorkspaceId && <LogoutTransferSettings key={user.activeWorkspaceId} workspaceId={user.activeWorkspaceId} userId={user.id} />}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Bell />{t("Notificacoes")}</CardTitle>
          <CardDescription>{t("Gerencie como voce recebe alertas.")}</CardDescription>
        </CardHeader>
        <CardContent>
          <NotificationSettings />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("Aparencia")}</CardTitle>
          <CardDescription>{t("Escolha como o Dialogy deve ser exibido.")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2">
            <div className="space-y-0.5">
              <Label className="text-sm">{t("Tema da interface")}</Label>
              <p className="text-xs text-muted-foreground">{t("Claro, escuro ou seguir o sistema.")}</p>
            </div>
            <div className="flex items-center gap-3">
              {isThemePending && (
                <span className="text-xs text-muted-foreground">{t("Salvando...")}</span>
              )}
              <ThemeToggle onThemeChange={handleThemeChange} disabled={isThemePending} />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
