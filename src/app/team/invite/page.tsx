'use client';

import { Loader2, MailPlus, UserPlus } from 'lucide-react';
import { useCurrentUser } from '@/hooks/use-online-status';
import { AcceptInvitePanel, SendInvitePanel } from '@/components/invites/workspace-invite-center';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function InviteMemberPage() {
  const user = useCurrentUser();
  const workspace = user?.workspaces?.find((item) => item.id === user.activeWorkspaceId);

  if (!user || !workspace) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-1 flex-col overflow-y-auto bg-muted/20">
      <header className="border-b bg-background px-4 py-5 sm:px-6">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Equipe</p>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold">
          <UserPlus className="h-6 w-6" />
          Convites
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Envie um link para alguém entrar em <span className="font-semibold text-foreground">{workspace.name}</span> ou aceite um convite recebido.
        </p>
      </header>

      <main className="grid flex-1 gap-6 p-4 sm:p-6 lg:grid-cols-2">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><MailPlus className="h-5 w-5 text-primary" /> Enviar convite</CardTitle>
            <CardDescription>Gere um link seguro para compartilhar por WhatsApp, e-mail ou chat.</CardDescription>
          </CardHeader>
          <CardContent>
            <SendInvitePanel workspaceId={workspace.id} workspaceName={workspace.name} />
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><UserPlus className="h-5 w-5 text-primary" /> Aceitar convite</CardTitle>
            <CardDescription>Cole o link ou o código e confira o workspace antes de entrar.</CardDescription>
          </CardHeader>
          <CardContent>
            <AcceptInvitePanel userEmail={user.email} />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
