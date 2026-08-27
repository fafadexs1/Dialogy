'use client';

import { useActionState, useState, type FormEvent } from 'react';
import { AlertCircle, ArrowRight, Check, Clipboard, Clock3, Link2, Loader2, MailPlus, Share2, UserPlus } from 'lucide-react';
import { createWorkspaceInviteWithDetails, getInviteDetails, joinWorkspaceAction } from '@/actions/invites';
import { normalizeInviteCode } from '@/lib/invite-code';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

type InviteMode = 'accept' | 'send';

const initialCreateState = {
  success: false,
  error: null,
  code: null,
  expiresAt: null,
};

const initialJoinState = {
  success: false,
  error: null,
};

type InviteDetails = Exclude<Awaited<ReturnType<typeof getInviteDetails>>, { error: string }>;

function formatExpiration(expiresAt: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(expiresAt));
}

function InviteError({ message }: { message: string | null | undefined }) {
  if (!message) return null;

  return (
    <Alert variant="destructive" className="border-red-500/20 bg-red-500/10 text-red-200">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Não foi possível continuar</AlertTitle>
      <AlertDescription className="text-red-200/80">{message}</AlertDescription>
    </Alert>
  );
}

function CopyButton({ value, label = 'Copiar link' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Button type="button" variant="outline" className="shrink-0 gap-2" onClick={handleCopy}>
      {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Clipboard className="h-4 w-4" />}
      {copied ? 'Copiado' : label}
    </Button>
  );
}

export function AcceptInvitePanel({ userEmail }: { userEmail?: string }) {
  const [inviteCode, setInviteCode] = useState('');
  const [details, setDetails] = useState<InviteDetails | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [joinState, joinAction, isJoining] = useActionState(joinWorkspaceAction, initialJoinState);

  const handleLookup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedCode = normalizeInviteCode(inviteCode);

    if (!normalizedCode) {
      setDetails(null);
      setLookupError('Cole o link completo ou informe o código do convite.');
      return;
    }

    setIsLookingUp(true);
    setLookupError(null);
    setDetails(null);

    try {
      const result = await getInviteDetails(normalizedCode);
      if ('error' in result) {
        setLookupError(result.error);
      } else {
        setInviteCode(normalizedCode);
        setDetails(result);
      }
    } catch {
      setLookupError('Não foi possível verificar o convite agora. Tente novamente.');
    } finally {
      setIsLookingUp(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-primary/15 bg-primary/[0.06] p-4">
        <div className="flex gap-3">
          <div className="mt-0.5 rounded-xl bg-primary/10 p-2 text-primary">
            <Link2 className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-semibold">Cole o link ou código que recebeu</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Você não precisa sair da inbox. Vamos verificar o workspace antes de adicionar você.
            </p>
          </div>
        </div>
      </div>

      {userEmail ? (
        <p className="text-xs text-muted-foreground">
          Você está conectado como <span className="font-semibold text-foreground">{userEmail}</span>.
        </p>
      ) : null}

      <form onSubmit={handleLookup} className="space-y-2">
        <Label htmlFor="workspace-invite-code">Link ou código do convite</Label>
        <div className="flex gap-2">
          <Input
            id="workspace-invite-code"
            value={inviteCode}
            onChange={(event) => {
              setInviteCode(event.target.value);
              setDetails(null);
              setLookupError(null);
            }}
            placeholder="Ex.: AB12CD34 ou cole o link completo"
            autoComplete="off"
            autoFocus
            disabled={isLookingUp || isJoining}
          />
          <Button type="submit" disabled={isLookingUp || isJoining || !inviteCode.trim()}>
            {isLookingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Verificar'}
          </Button>
        </div>
      </form>

      <InviteError message={lookupError} />
      <InviteError message={joinState.error} />

      {details ? (
        <div className="space-y-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] p-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-600 dark:text-emerald-400">Convite encontrado</p>
            <h3 className="mt-1 text-lg font-semibold">{details.workspaceName}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {details.inviterName} convidou você para colaborar neste workspace.
            </p>
          </div>

          <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
            <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-background/60 px-3 py-2">
              <Clock3 className="h-3.5 w-3.5 text-amber-500" />
              Expira em {formatExpiration(details.expiresAt)}
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-background/60 px-3 py-2">
              <UserPlus className="h-3.5 w-3.5 text-emerald-500" />
              {details.remainingUses === null ? 'Usos ilimitados' : `${details.remainingUses} vaga${details.remainingUses === 1 ? '' : 's'} restante${details.remainingUses === 1 ? '' : 's'}`}
            </div>
          </div>

          <form action={joinAction}>
            <input type="hidden" name="inviteCode" value={inviteCode} />
            <input type="hidden" name="redirectTo" value="/inbox" />
            <Button type="submit" className="w-full gap-2" disabled={isJoining}>
              {isJoining ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              {isJoining ? 'Entrando no workspace...' : 'Aceitar e abrir workspace'}
            </Button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

export function SendInvitePanel({ workspaceId, workspaceName }: { workspaceId: string; workspaceName: string }) {
  const [createState, createAction, isCreating] = useActionState(createWorkspaceInviteWithDetails, initialCreateState);
  const inviteUrl = createState.code && typeof window !== 'undefined'
    ? `${window.location.origin}/join/${createState.code}`
    : null;

  const handleShare = async () => {
    if (!inviteUrl || !navigator.share) return;
    await navigator.share({
      title: `Convite para ${workspaceName}`,
      text: `Entre no workspace ${workspaceName} pelo Dialogy:`,
      url: inviteUrl,
    }).catch(() => undefined);
  };

  return (
    <div className="space-y-5">
      {createState.success && inviteUrl ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] p-4">
            <div className="flex gap-3">
              <div className="rounded-xl bg-emerald-500/10 p-2 text-emerald-500">
                <Check className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold">Link pronto para enviar</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Envie por WhatsApp, e-mail ou chat. A pessoa poderá abrir o link mesmo antes de criar a conta.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="generated-invite-link">Link do convite</Label>
            <div className="flex gap-2">
              <Input id="generated-invite-link" value={inviteUrl} readOnly onFocus={(event) => event.currentTarget.select()} />
              <CopyButton value={inviteUrl} />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
            <span>Código: <strong className="font-mono text-foreground">{createState.code}</strong></span>
            {createState.expiresAt ? <span>Válido até {formatExpiration(createState.expiresAt)}</span> : null}
          </div>

          {typeof navigator !== 'undefined' && typeof navigator.share === 'function' ? (
            <Button type="button" variant="outline" className="w-full gap-2" onClick={handleShare}>
              <Share2 className="h-4 w-4" />
              Compartilhar agora
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="rounded-2xl border border-primary/15 bg-primary/[0.06] p-4">
            <div className="flex gap-3">
              <div className="mt-0.5 rounded-xl bg-primary/10 p-2 text-primary">
                <MailPlus className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold">Convide alguém para {workspaceName}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Gere um único link e envie por qualquer canal. A pessoa verá o nome do workspace antes de aceitar.
                </p>
              </div>
            </div>
          </div>

          <InviteError message={createState.error} />

          <form action={createAction} className="space-y-4">
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <div className="space-y-2">
              <Label htmlFor="invite-expiration">Validade do link</Label>
              <select
                id="invite-expiration"
                name="expiresIn"
                defaultValue="604800"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                disabled={isCreating}
              >
                <option value="86400">1 dia</option>
                <option value="604800">7 dias</option>
                <option value="2592000">30 dias</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-max-uses">Limite de pessoas <span className="font-normal text-muted-foreground">(opcional)</span></Label>
              <Input id="invite-max-uses" name="maxUses" type="number" min="1" placeholder="Sem limite" disabled={isCreating} />
              <p className="text-xs text-muted-foreground">Deixe vazio para permitir que várias pessoas usem o mesmo link.</p>
            </div>
            <Button type="submit" className="w-full gap-2" disabled={isCreating}>
              {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              {isCreating ? 'Gerando link...' : 'Gerar link de convite'}
            </Button>
          </form>
        </>
      )}
    </div>
  );
}

export function WorkspaceInviteCenter({
  workspaceId,
  workspaceName,
  userEmail,
  className,
  onClose,
}: {
  workspaceId: string;
  workspaceName: string;
  userEmail?: string;
  className?: string;
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<InviteMode>('accept');
  const [dialogKey, setDialogKey] = useState(0);

  const openDialog = (nextMode: InviteMode) => {
    setMode(nextMode);
    setDialogKey((current) => current + 1);
    setOpen(true);
  };

  return (
    <>
      <div className={cn('border-t border-sidebar-border pt-2', className)}>
        <div className="flex items-center gap-2 px-2 pb-1">
          <UserPlus className="h-3.5 w-3.5 text-primary" />
          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Convites</span>
        </div>
        <div className="grid grid-cols-2 gap-1">
          <button
            type="button"
            onClick={() => openDialog('accept')}
            className="flex min-h-16 flex-col items-start justify-center gap-1 rounded-lg px-2.5 py-2 text-left text-sidebar-foreground transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <UserPlus className="h-4 w-4 text-primary" />
            <span className="text-xs font-semibold">Aceitar</span>
            <span className="text-[10px] leading-3 text-muted-foreground">Colar link ou código</span>
          </button>
          <button
            type="button"
            onClick={() => openDialog('send')}
            className="flex min-h-16 flex-col items-start justify-center gap-1 rounded-lg px-2.5 py-2 text-left text-sidebar-foreground transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <MailPlus className="h-4 w-4 text-primary" />
            <span className="text-xs font-semibold">Enviar</span>
            <span className="text-[10px] leading-3 text-muted-foreground">Gerar link</span>
          </button>
        </div>
      </div>

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) onClose?.();
        }}
      >
        <DialogContent className="max-w-xl gap-0 overflow-hidden p-0 sm:rounded-2xl">
          <DialogHeader className="border-b border-border/70 px-6 pb-4 pt-6">
            <DialogTitle>Convites do workspace</DialogTitle>
            <DialogDescription>
              Encontre ou compartilhe um convite sem sair da sua operação.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-1 border-b border-border/70 bg-muted/20 p-2">
            {(['accept', 'send'] as InviteMode[]).map((item) => {
              const isActive = item === mode;
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => {
                    setMode(item);
                    setDialogKey((current) => current + 1);
                  }}
                  className={cn(
                    'flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                    isActive ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
                  )}
                >
                  {item === 'accept' ? <UserPlus className="h-4 w-4" /> : <MailPlus className="h-4 w-4" />}
                  {item === 'accept' ? 'Aceitar convite' : 'Enviar convite'}
                </button>
              );
            })}
          </div>

          <div className="max-h-[min(70vh,560px)] overflow-y-auto px-6 py-5">
            {mode === 'accept' ? (
              <AcceptInvitePanel key={`accept-${dialogKey}`} userEmail={userEmail} />
            ) : (
              <SendInvitePanel key={`send-${dialogKey}`} workspaceId={workspaceId} workspaceName={workspaceName} />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
