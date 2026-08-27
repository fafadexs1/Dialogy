'use client';

import { useEffect, useState } from 'react';
import { KeyRound, Loader2, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { createNexusCredentialAction, deleteNexusCredentialAction, listNexusCredentials } from '../actions/credentials';
import type { NexusCredentialSummary, NexusCredentialType } from '../services/credentials';

export function NexusCredentialsDialog({
  workspaceId,
  open,
  onOpenChange,
  onChange,
}: {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (credentials: NexusCredentialSummary[]) => void;
}) {
  const { toast } = useToast();
  const [credentials, setCredentials] = useState<NexusCredentialSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<NexusCredentialType>('bearer');
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const [third, setThird] = useState('');
  const [fourth, setFourth] = useState('');
  const [fifth, setFifth] = useState('');
  const [secure, setSecure] = useState(true);
  const [placement, setPlacement] = useState<'header' | 'query'>('header');

  const load = async () => {
    setLoading(true);
    try {
      const result = await listNexusCredentials(workspaceId);
      if (result.error) toast({ title: 'Credenciais indisponíveis', description: result.error, variant: 'destructive' });
      setCredentials(result.credentials);
      onChange(result.credentials);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void load();
  // onChange is intentionally excluded: callers may pass an inline state adapter.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspaceId]);

  const create = async () => {
    setSaving(true);
    try {
      const payload = type === 'bearer'
        ? { token: first }
        : type === 'basic'
          ? { username: first, password: second }
          : type === 'api_key'
            ? { name: first || 'X-API-Key', value: second, placement }
            : type === 'smtp'
              ? { host: first, port: Number(second || (secure ? 465 : 587)), secure, username: third, password: fourth, from: fifth || third }
              : type === 'google_oauth'
                ? { clientId: first, clientSecret: second, refreshToken: third }
                : { connectionString: first, ssl: secure };
      const result = await createNexusCredentialAction({ workspaceId, name, type, payload });
      if (!result.success) {
        toast({ title: 'Erro ao salvar credencial', description: result.error, variant: 'destructive' });
        return;
      }
      setName('');
      setFirst('');
      setSecond('');
      setThird('');
      setFourth('');
      setFifth('');
      toast({ title: 'Credencial protegida', description: 'O segredo foi cifrado e não será exibido novamente.' });
      await load();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (credentialId: string) => {
    const result = await deleteNexusCredentialAction({ workspaceId, credentialId });
    if (!result.success) toast({ title: 'Erro ao excluir', description: result.error, variant: 'destructive' });
    else await load();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Credenciais do Nexus</DialogTitle><DialogDescription>Segredos ficam cifrados no workspace. Os blocos guardam somente o identificador da credencial.</DialogDescription></DialogHeader>
        <div className="grid gap-6 py-2 sm:grid-cols-[1fr_1.1fr]">
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold"><KeyRound className="h-4 w-4" />Credenciais disponíveis</div>
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {loading ? <div className="flex items-center gap-2 rounded-xl border p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando…</div> : credentials.map((credential) => <div key={credential.id} className="flex items-center gap-3 rounded-xl border p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{credential.name}</p><p className="font-mono text-[10px] text-muted-foreground">{credential.type} · {credential.id}</p></div><Button type="button" size="icon" variant="ghost" aria-label={`Excluir ${credential.name}`} onClick={() => void remove(credential.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></div>)}
              {!loading && credentials.length === 0 ? <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">Nenhuma credencial cadastrada.</p> : null}
            </div>
          </section>
          <section className="space-y-4 rounded-2xl border bg-muted/20 p-4">
            <div className="space-y-2"><Label htmlFor="credential-name">Nome</Label><Input id="credential-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="API do ERP" /></div>
            <div className="space-y-2"><Label htmlFor="credential-type">Tipo</Label><select id="credential-type" value={type} onChange={(event) => { setType(event.target.value as NexusCredentialType); setFirst(''); setSecond(''); setThird(''); setFourth(''); setFifth(''); }} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="bearer">Bearer token</option><option value="api_key">API key</option><option value="basic">Usuário e senha</option><option value="smtp">Servidor SMTP</option><option value="google_oauth">Google OAuth</option><option value="database">Banco PostgreSQL</option></select></div>
            {type === 'bearer' ? <div className="space-y-2"><Label htmlFor="credential-token">Token</Label><Input id="credential-token" type="password" value={first} onChange={(event) => setFirst(event.target.value)} autoComplete="new-password" /></div> : null}
            {type === 'basic' ? <><div className="space-y-2"><Label htmlFor="credential-user">Usuário</Label><Input id="credential-user" value={first} onChange={(event) => setFirst(event.target.value)} autoComplete="off" /></div><div className="space-y-2"><Label htmlFor="credential-password">Senha</Label><Input id="credential-password" type="password" value={second} onChange={(event) => setSecond(event.target.value)} autoComplete="new-password" /></div></> : null}
            {type === 'api_key' ? <><div className="space-y-2"><Label htmlFor="credential-key-name">Nome do campo</Label><Input id="credential-key-name" value={first} onChange={(event) => setFirst(event.target.value)} placeholder="X-API-Key" /></div><div className="space-y-2"><Label htmlFor="credential-key-value">Valor</Label><Input id="credential-key-value" type="password" value={second} onChange={(event) => setSecond(event.target.value)} autoComplete="new-password" /></div><div className="space-y-2"><Label htmlFor="credential-placement">Enviar em</Label><select id="credential-placement" value={placement} onChange={(event) => setPlacement(event.target.value as 'header' | 'query')} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="header">Header</option><option value="query">Query string</option></select></div></> : null}
            {type === 'smtp' ? <><div className="grid grid-cols-[1fr_6rem] gap-2"><div className="space-y-2"><Label htmlFor="smtp-host">Servidor</Label><Input id="smtp-host" value={first} onChange={(event) => setFirst(event.target.value)} placeholder="smtp.exemplo.com" /></div><div className="space-y-2"><Label htmlFor="smtp-port">Porta</Label><Input id="smtp-port" type="number" value={second} onChange={(event) => setSecond(event.target.value)} placeholder={secure ? '465' : '587'} /></div></div><div className="space-y-2"><Label htmlFor="smtp-user">Usuário</Label><Input id="smtp-user" value={third} onChange={(event) => setThird(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="smtp-password">Senha</Label><Input id="smtp-password" type="password" value={fourth} onChange={(event) => setFourth(event.target.value)} autoComplete="new-password" /></div><div className="space-y-2"><Label htmlFor="smtp-from">Remetente</Label><Input id="smtp-from" value={fifth} onChange={(event) => setFifth(event.target.value)} placeholder={third || 'email@exemplo.com'} /></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={secure} onChange={(event) => setSecure(event.target.checked)} />TLS direto (porta 465); desmarcado usa STARTTLS</label></> : null}
            {type === 'google_oauth' ? <><div className="space-y-2"><Label htmlFor="google-client">Client ID</Label><Input id="google-client" value={first} onChange={(event) => setFirst(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="google-secret">Client secret</Label><Input id="google-secret" type="password" value={second} onChange={(event) => setSecond(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="google-refresh">Refresh token</Label><Input id="google-refresh" type="password" value={third} onChange={(event) => setThird(event.target.value)} /></div></> : null}
            {type === 'database' ? <><div className="space-y-2"><Label htmlFor="database-url">Connection string PostgreSQL</Label><Input id="database-url" type="password" value={first} onChange={(event) => setFirst(event.target.value)} placeholder="postgresql://…" autoComplete="new-password" /></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={secure} onChange={(event) => setSecure(event.target.checked)} />Validar certificado TLS</label></> : null}
            <Button type="button" onClick={() => void create()} disabled={saving || !name.trim()} className="w-full">{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}Salvar credencial</Button>
          </section>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
