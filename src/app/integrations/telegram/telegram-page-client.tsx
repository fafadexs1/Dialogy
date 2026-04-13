'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useToast } from '@/hooks/use-toast';
import { useCurrentUser } from '@/hooks/use-online-status';
import type { TelegramBotInstance, TelegramBotProfileSettings } from '@/lib/types';
import {
  checkTelegramInstanceStatus,
  connectTelegramInstance,
  createTelegramInstance,
  deleteTelegramInstance,
  disconnectTelegramInstance,
  getTelegramInstanceProfile,
  getTelegramInstances,
  removeTelegramInstancePhoto,
  restartTelegramInstance,
  updateTelegramInstanceProfile,
} from '@/actions/telegram';
import { Bot, ImageOff, ImagePlus, Loader2, MessageSquare, MoreVertical, PlusCircle, Power, PowerOff, RefreshCw, Send, ShieldCheck, Trash2 } from 'lucide-react';

function AddTelegramBotForm({
  workspaceId,
  onSuccess,
}: {
  workspaceId: string;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [telegramBotToken, setTelegramBotToken] = useState('');

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);

    const result = await createTelegramInstance(
      { displayName, telegramBotToken },
      workspaceId
    );

    setIsSubmitting(false);

    if (result.success) {
      toast({ title: 'Bot conectado', description: 'O webhook do Telegram foi configurado com sucesso.' });
      onSuccess();
      return;
    }

    toast({ title: 'Erro ao conectar bot', description: result.error, variant: 'destructive' });
  };

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>Adicionar Telegram Bot</DialogTitle>
        <DialogDescription>
          Cole o token do BotFather. A Dialogy configura o webhook do Telegram diretamente, sem passar pela Evolution.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label htmlFor="displayName">Apelido do Bot</Label>
          <Input
            id="displayName"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Ex: Suporte Telegram"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="telegramBotToken">Token do BotFather</Label>
          <Input
            id="telegramBotToken"
            type="password"
            value={telegramBotToken}
            onChange={(e) => setTelegramBotToken(e.target.value)}
            placeholder="123456789:AA..."
            required
          />
        </div>
        <div className="rounded-lg border bg-sky-50 p-4 text-sm text-sky-950">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <p>Os eventos brutos do webhook ficam registrados em tabela propria do Telegram, e as conversas entram no inbox como canal Telegram.</p>
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Adicionar Bot
        </Button>
      </DialogFooter>
    </form>
  );
}

function TelegramProfileDialog({
  instance,
  onSaved,
  trigger,
}: {
  instance: Omit<TelegramBotInstance, 'status'>;
  onSaved: () => void;
  trigger: React.ReactNode;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRemovingPhoto, setIsRemovingPhoto] = useState(false);
  const [profile, setProfile] = useState<TelegramBotProfileSettings | null>(null);
  const [dialogyDisplayName, setDialogyDisplayName] = useState(instance.display_name);
  const [botName, setBotName] = useState(instance.telegram_bot_name || '');
  const [shortDescription, setShortDescription] = useState('');
  const [description, setDescription] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    setLoadingProfile(true);
    const result = await getTelegramInstanceProfile(instance.id);
    setLoadingProfile(false);

    if (result.error || !result.profile) {
      toast({ title: 'Erro ao carregar perfil', description: result.error || 'Nao foi possivel carregar o perfil do bot.', variant: 'destructive' });
      return;
    }

    setProfile(result.profile);
    setDialogyDisplayName(result.profile.dialogy_display_name);
    setBotName(result.profile.name || result.profile.default_name);
    setShortDescription(result.profile.short_description || '');
    setDescription(result.profile.description || '');
    setPhotoFile(null);
    setPhotoPreviewUrl(null);
  }, [instance.id, toast]);

  useEffect(() => {
    if (open) {
      void loadProfile();
    } else {
      setPhotoFile(null);
      setPhotoPreviewUrl(null);
    }
  }, [open, loadProfile]);

  useEffect(() => {
    if (!photoFile) {
      setPhotoPreviewUrl(null);
      return;
    }

    const nextUrl = URL.createObjectURL(photoFile);
    setPhotoPreviewUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [photoFile]);

  const resolvedPhoto = useMemo(
    () => photoPreviewUrl || profile?.photo_data_url || null,
    [photoPreviewUrl, profile?.photo_data_url]
  );

  const handlePhotoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    if (!file) {
      setPhotoFile(null);
      return;
    }

    const lowerName = file.name.toLowerCase();
    const isJpeg = file.type === 'image/jpeg' || file.type === 'image/jpg' || lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg');
    if (!isJpeg) {
      toast({ title: 'Formato invalido', description: 'Envie uma imagem JPG ou JPEG para a foto do bot.', variant: 'destructive' });
      event.target.value = '';
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast({ title: 'Arquivo muito grande', description: 'A foto do perfil do Telegram deve ter no maximo 10 MB.', variant: 'destructive' });
      event.target.value = '';
      return;
    }

    setPhotoFile(file);
  };

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaving(true);

    const formData = new FormData();
    formData.set('instanceId', instance.id);
    formData.set('dialogyDisplayName', dialogyDisplayName);
    formData.set('botName', botName);
    formData.set('shortDescription', shortDescription);
    formData.set('description', description);
    if (photoFile) {
      formData.set('photo', photoFile);
    }

    const result = await updateTelegramInstanceProfile(formData);
    setIsSaving(false);

    if (!result.success || !result.profile) {
      toast({ title: 'Erro ao salvar perfil', description: result.error || 'Nao foi possivel atualizar o perfil do bot.', variant: 'destructive' });
      return;
    }

    setProfile(result.profile);
    setPhotoFile(null);
    setPhotoPreviewUrl(null);
    toast({ title: 'Perfil atualizado', description: 'As configuracoes do bot foram sincronizadas com o Telegram.' });
    onSaved();
    setOpen(false);
  };

  const handleRemovePhoto = async () => {
    setIsRemovingPhoto(true);
    const result = await removeTelegramInstancePhoto(instance.id);
    setIsRemovingPhoto(false);

    if (!result.success || !result.profile) {
      toast({ title: 'Erro ao remover foto', description: result.error || 'Nao foi possivel remover a foto do bot.', variant: 'destructive' });
      return;
    }

    setProfile(result.profile);
    setPhotoFile(null);
    setPhotoPreviewUrl(null);
    toast({ title: 'Foto removida', description: 'O Telegram removeu a foto atual do bot.' });
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Perfil do bot</DialogTitle>
          <DialogDescription>
            Atualize foto, nome e descricoes do bot direto na Bot API do Telegram.
          </DialogDescription>
        </DialogHeader>

        {loadingProfile ? (
          <div className="space-y-4 py-4">
            <Skeleton className="h-24 w-24 rounded-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-6">
            <div className="flex flex-col gap-4 rounded-lg border bg-muted/30 p-4 sm:flex-row sm:items-center">
              <Avatar className="h-24 w-24 border">
                <AvatarImage src={resolvedPhoto || undefined} alt={botName || instance.display_name} />
                <AvatarFallback className="text-2xl font-semibold">
                  {(botName || instance.display_name || 'T').charAt(0)}
                </AvatarFallback>
              </Avatar>

              <div className="min-w-0 flex-1 space-y-2">
                <div className="space-y-1">
                  <p className="text-base font-semibold">{botName || profile?.default_name || instance.display_name}</p>
                  {profile?.username && <p className="text-sm text-muted-foreground">@{profile.username}</p>}
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>Instancia: {instance.instance_name}</span>
                    {profile?.bot_id && <span>ID: {profile.bot_id}</span>}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <div className="space-y-2">
                    <Label htmlFor={`telegram-photo-${instance.id}`}>Nova foto JPG</Label>
                    <Input
                      id={`telegram-photo-${instance.id}`}
                      type="file"
                      accept=".jpg,.jpeg,image/jpeg"
                      onChange={handlePhotoChange}
                    />
                  </div>
                  <div className="flex items-end gap-2">
                    {photoFile && (
                      <Button type="button" variant="outline" onClick={() => setPhotoFile(null)}>
                        <ImageOff className="mr-2 h-4 w-4" />
                        Limpar nova foto
                      </Button>
                    )}
                    {profile?.has_photo && !photoFile && (
                      <Button type="button" variant="outline" onClick={handleRemovePhoto} disabled={isRemovingPhoto}>
                        {isRemovingPhoto ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImageOff className="mr-2 h-4 w-4" />}
                        Remover foto atual
                      </Button>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">O Telegram aceita foto estatica em JPG de ate 10 MB.</p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={`dialogy-name-${instance.id}`}>Apelido interno na Dialogy</Label>
                <Input
                  id={`dialogy-name-${instance.id}`}
                  value={dialogyDisplayName}
                  onChange={(event) => setDialogyDisplayName(event.target.value)}
                  placeholder="Ex: Suporte Telegram"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`telegram-name-${instance.id}`}>Nome publico no Telegram</Label>
                <Input
                  id={`telegram-name-${instance.id}`}
                  value={botName}
                  onChange={(event) => setBotName(event.target.value)}
                  placeholder={profile?.default_name || 'Nome do bot'}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`telegram-short-description-${instance.id}`}>Descricao curta</Label>
              <Textarea
                id={`telegram-short-description-${instance.id}`}
                value={shortDescription}
                onChange={(event) => setShortDescription(event.target.value)}
                placeholder="Aparece no perfil do bot e no compartilhamento do link."
                rows={3}
                maxLength={120}
              />
              <p className="text-xs text-muted-foreground">{shortDescription.length}/120</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`telegram-description-${instance.id}`}>Descricao completa</Label>
              <Textarea
                id={`telegram-description-${instance.id}`}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Explique o que esse bot faz quando o usuario abre o perfil."
                rows={5}
                maxLength={512}
              />
              <p className="text-xs text-muted-foreground">{description.length}/512</p>
            </div>

            <DialogFooter>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Bot className="mr-2 h-4 w-4" />}
                Salvar perfil
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TelegramInstanceCard({
  instance: initialInstance,
  onMutate,
}: {
  instance: Omit<TelegramBotInstance, 'status'>;
  onMutate: () => void;
}) {
  const { toast } = useToast();
  const [instance, setInstance] = useState<TelegramBotInstance>({ ...initialInstance, status: 'disconnected' });
  const [isToggling, setIsToggling] = useState(false);
  const [errorCount, setErrorCount] = useState(0);

  useEffect(() => {
    setInstance((prev) => ({ ...prev, ...initialInstance }));
  }, [initialInstance]);

  const checkStatus = useCallback(async () => {
    try {
      const result = await checkTelegramInstanceStatus(instance.instance_name);
      setInstance((prev) => ({ ...prev, ...result }));
      setErrorCount(0);
    } catch (error) {
      console.error('[TELEGRAM_CARD] Polling error:', error);
      setErrorCount((prev) => prev + 1);
    }
  }, [instance.instance_name]);

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval>;

    if (errorCount > 5) {
      toast({
        title: 'Erro de conexao',
        description: 'Falha ao atualizar o status do bot. Recarregue a pagina.',
        variant: 'destructive',
      });
      return;
    }

    checkStatus();
    intervalId = setInterval(checkStatus, 15000);

    return () => clearInterval(intervalId);
  }, [checkStatus, errorCount, toast]);

  const handleConnect = async () => {
    setIsToggling(true);
    const result = await connectTelegramInstance(instance.instance_name);
    setInstance((prev) => ({ ...prev, ...result }));
    setIsToggling(false);
  };

  const handleDisconnect = async () => {
    setIsToggling(true);
    const result = await disconnectTelegramInstance(instance.instance_name);
    setInstance((prev) => ({ ...prev, ...result }));
    setIsToggling(false);
  };

  const handleDelete = async () => {
    const result = await deleteTelegramInstance(instance.id);
    if (result.error) {
      toast({ title: 'Erro ao excluir bot', description: result.error, variant: 'destructive' });
      return;
    }

    toast({ title: 'Bot removido', description: `O bot ${instance.display_name} foi removido.` });
    onMutate();
  };

  const handleRestart = async () => {
    toast({ title: 'Reconfigurando webhook...', description: `O bot ${instance.display_name} esta sendo reconfigurado.` });
    const result = await restartTelegramInstance(instance.instance_name);
    if (!result.success) {
      toast({ title: 'Erro ao reconfigurar', description: result.error, variant: 'destructive' });
      return;
    }

    toast({ title: 'Webhook atualizado', description: 'O Telegram recebeu a nova configuracao.' });
    setTimeout(checkStatus, 1500);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Send className="text-sky-500" />
              {instance.display_name}
            </CardTitle>
            <CardDescription>Telegram Bot • {instance.instance_name}</CardDescription>
            <div className="mt-2 space-y-1 text-xs text-muted-foreground">
              {instance.telegram_bot_username && <p className="font-medium text-foreground/90">@{instance.telegram_bot_username}</p>}
              {instance.telegram_bot_name && <p>Bot: {instance.telegram_bot_name}</p>}
              {instance.telegram_bot_id && <p>ID: {instance.telegram_bot_id}</p>}
            </div>
          </div>
          <AlertDialog>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon"><MoreVertical /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuSeparator />
                <AlertDialogTrigger asChild>
                  <DropdownMenuItem className="w-full justify-start text-destructive hover:text-destructive" onSelect={(e) => e.preventDefault()}>
                    <Trash2 className="mr-2" />Excluir
                  </DropdownMenuItem>
                </AlertDialogTrigger>
              </DropdownMenuContent>
            </DropdownMenu>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Tem certeza?</AlertDialogTitle>
                <AlertDialogDescription>
                  Esta acao e irreversivel e removera permanentemente o bot <span className="font-bold">{instance.display_name}</span>.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete}>Excluir</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardHeader>
      <CardContent>
        <div className="p-4 text-center text-sm text-muted-foreground">
          {instance.status === 'connected'
            ? 'Webhook do Telegram ativo e pronto para receber mensagens.'
            : instance.status === 'pending'
              ? 'Webhook encontrado, mas ainda nao validado como esperado.'
              : 'Webhook do Telegram pausado ou ausente.'}
        </div>
      </CardContent>
      <CardFooter className="grid grid-cols-[1fr_auto_auto] gap-2">
        {instance.status === 'connected' ? (
          <Button variant="destructive" onClick={handleDisconnect} disabled={isToggling} className="w-full">
            {isToggling ? <Loader2 className="mr-2 animate-spin" /> : <PowerOff className="mr-2" />}
            Pausar webhook
          </Button>
        ) : (
          <Button variant="default" onClick={handleConnect} disabled={isToggling} className="w-full">
            {isToggling ? <Loader2 className="mr-2 animate-spin" /> : <Power className="mr-2" />}
            Ativar webhook
          </Button>
        )}
        <TelegramProfileDialog
          instance={instance}
          onSaved={onMutate}
          trigger={
            <Button variant="outline" type="button">
              <ImagePlus className="h-4 w-4" />
              <span className="sr-only">Editar perfil do bot</span>
            </Button>
          }
        />
        <Button variant="outline" onClick={handleRestart}>
          <RefreshCw />
        </Button>
      </CardFooter>
    </Card>
  );
}

export default function TelegramPageClient() {
  const { toast } = useToast();
  const user = useCurrentUser();
  const [instances, setInstances] = useState<Omit<TelegramBotInstance, 'status'>[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const fetchData = useCallback(async () => {
    if (!user?.activeWorkspaceId) return;
    setLoading(true);
    try {
      const result = await getTelegramInstances(user.activeWorkspaceId);
      if (result.error) {
        toast({ title: 'Erro ao carregar bots', description: result.error, variant: 'destructive' });
        setInstances([]);
      } else {
        setInstances(result.instances || []);
      }
    } catch (error) {
      console.error('[TELEGRAM_PAGE] Falha ao buscar bots', error);
      toast({ title: 'Erro ao carregar bots', description: 'Nao foi possivel buscar os bots deste workspace.', variant: 'destructive' });
      setInstances([]);
    }
    setLoading(false);
  }, [toast, user?.activeWorkspaceId]);

  useEffect(() => {
    if (user) {
      fetchData();
    }
  }, [user, fetchData]);

  const handleSuccess = () => {
    setIsModalOpen(false);
    fetchData();
  };

  if (!user) {
    return <div className="flex h-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }

  return (
    <div className="flex h-full flex-1 flex-col">
      <header className="flex shrink-0 items-center justify-between border-b bg-background p-4 sm:p-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold"><Send /> Telegram Bot</h1>
          <p className="text-muted-foreground">Gerencie bots do Telegram com webhook proprio e eventos separados.</p>
        </div>
        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogTrigger asChild>
            <Button>
              <PlusCircle className="mr-2 h-4 w-4" />
              Adicionar Bot
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-xl">
            <AddTelegramBotForm workspaceId={user.activeWorkspaceId!} onSuccess={handleSuccess} />
          </DialogContent>
        </Dialog>
      </header>

      <main className="flex-1 space-y-6 overflow-y-auto bg-muted/40 p-4 sm:p-6">
        {loading ? (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <Skeleton className="h-72" />
            <Skeleton className="h-72" />
          </div>
        ) : instances.length === 0 ? (
          <div className="mt-8 rounded-lg border-2 border-dashed p-10 text-center">
            <MessageSquare className="mx-auto h-12 w-12 text-muted-foreground" />
            <h3 className="mt-4 text-lg font-medium">Nenhum bot conectado</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Clique em "Adicionar Bot" para conectar seu primeiro bot do Telegram.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {instances.map((instance) => (
              <TelegramInstanceCard
                key={instance.id}
                instance={instance}
                onMutate={fetchData}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
