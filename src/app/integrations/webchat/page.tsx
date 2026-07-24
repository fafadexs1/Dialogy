'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Copy, Globe2, Loader2, MessageCircle, Save } from 'lucide-react';

import { getWebchatConfigAction, saveWebchatConfigAction, type WebchatConfigInput } from '@/actions/webchat';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useCurrentUser } from '@/hooks/use-online-status';

const defaults: WebchatConfigInput = {
  name: 'Atendimento', title: 'Olá! Como podemos ajudar?',
  welcomeMessage: 'Envie uma mensagem e nossa equipe responderá em instantes.',
  primaryColor: '#2563eb', position: 'right', allowedDomains: [], requireName: true,
  requireEmail: false, isActive: true, autopilotConfigId: null,
};

type Agent = { id: string; name: string; isActive: boolean };

export default function WebchatIntegrationPage() {
  const user = useCurrentUser();
  const workspaceId = user?.activeWorkspaceId;
  const { toast } = useToast();
  const [config, setConfig] = useState<WebchatConfigInput>(defaults);
  const [publicKey, setPublicKey] = useState('');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const origin = useMemo(() => typeof window === 'undefined' ? '' : window.location.origin, []);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const result = await getWebchatConfigAction(workspaceId);
      if (result.error) throw new Error(result.error);
      setAgents(result.agents || []);
      if (result.config) {
        setPublicKey(result.config.publicKey);
        setConfig({
          name: result.config.name, title: result.config.title, welcomeMessage: result.config.welcomeMessage,
          primaryColor: result.config.primaryColor, position: result.config.position,
          allowedDomains: result.config.allowedDomains, requireName: result.config.requireName,
          requireEmail: result.config.requireEmail, isActive: result.config.isActive,
          autopilotConfigId: result.config.autopilotConfigId,
        });
      }
    } catch (error) {
      toast({ title: 'Erro ao carregar o Webchat', description: error instanceof Error ? error.message : 'Tente novamente.', variant: 'destructive' });
    } finally { setLoading(false); }
  }, [toast, workspaceId]);
  useEffect(() => { void load(); }, [load]);

  const snippet = publicKey ? `<script async src="${origin}/widget.js" data-widget-id="${publicKey}"></script>` : '';
  async function save() {
    if (!workspaceId) return;
    setSaving(true);
    const result = await saveWebchatConfigAction(workspaceId, config);
    setSaving(false);
    if (!result.success) return toast({ title: 'Não foi possível salvar', description: result.error, variant: 'destructive' });
    if (result.publicKey) setPublicKey(result.publicKey);
    toast({ title: 'Chat do site configurado', description: 'O widget já pode ser instalado.' });
  }
  async function copy() {
    await navigator.clipboard.writeText(snippet); setCopied(true); window.setTimeout(() => setCopied(false), 1800);
  }
  if (loading || !workspaceId) return <div className="flex h-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return <div className="min-h-screen bg-background px-4 py-6 sm:px-6 lg:px-8"><div className="mx-auto flex max-w-6xl flex-col gap-6">
    <header className="flex flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-3"><Button asChild size="icon" variant="ghost" className="rounded-full"><Link href="/integrations"><ArrowLeft className="h-5 w-5" /></Link></Button><div><div className="flex items-center gap-2"><h1 className="text-2xl font-bold">Chat do site</h1><Badge variant="outline">Webchat</Badge></div><p className="text-sm text-muted-foreground">Receba visitantes do seu site na mesma caixa de atendimento.</p></div></div><div className="flex items-center gap-3"><div className="flex items-center gap-2"><Switch checked={config.isActive} onCheckedChange={(isActive) => setConfig((v) => ({ ...v, isActive }))} /><span className="text-sm">Ativo</span></div><Button onClick={save} disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Salvar</Button></div></header>
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        <Card><CardHeader><CardTitle>Identidade e mensagem</CardTitle><CardDescription>Personalize o primeiro contato do visitante.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>Nome do atendimento</Label><Input value={config.name} onChange={(e) => setConfig((v) => ({ ...v, name: e.target.value }))} /></div><div className="space-y-2"><Label>Cor principal</Label><div className="flex gap-2"><Input type="color" className="w-14 p-1" value={config.primaryColor} onChange={(e) => setConfig((v) => ({ ...v, primaryColor: e.target.value }))} /><Input value={config.primaryColor} onChange={(e) => setConfig((v) => ({ ...v, primaryColor: e.target.value }))} /></div></div></div><div className="space-y-2"><Label>Título</Label><Input value={config.title} onChange={(e) => setConfig((v) => ({ ...v, title: e.target.value }))} /></div><div className="space-y-2"><Label>Mensagem de boas-vindas</Label><Textarea value={config.welcomeMessage} onChange={(e) => setConfig((v) => ({ ...v, welcomeMessage: e.target.value }))} /></div></CardContent></Card>
        <Card><CardHeader><CardTitle>Entrada e automação</CardTitle><CardDescription>Escolha os dados pedidos e o fluxo que receberá a conversa.</CardDescription></CardHeader><CardContent className="space-y-5"><div className="grid gap-4 sm:grid-cols-2"><label className="flex items-center justify-between rounded-xl border p-4"><span className="text-sm font-medium">Solicitar nome</span><Switch checked={config.requireName} onCheckedChange={(requireName) => setConfig((v) => ({ ...v, requireName }))} /></label><label className="flex items-center justify-between rounded-xl border p-4"><span className="text-sm font-medium">Solicitar e-mail</span><Switch checked={config.requireEmail} onCheckedChange={(requireEmail) => setConfig((v) => ({ ...v, requireEmail }))} /></label></div><div className="space-y-2"><Label>Agente/fluxo automático</Label><Select value={config.autopilotConfigId || 'human'} onValueChange={(value) => setConfig((v) => ({ ...v, autopilotConfigId: value === 'human' ? null : value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="human">Somente fila humana</SelectItem>{agents.map((agent) => <SelectItem key={agent.id} value={agent.id}>{agent.name}{!agent.isActive ? ' (inativo)' : ''}</SelectItem>)}</SelectContent></Select><p className="text-xs text-muted-foreground">O agente usa o mesmo motor de fluxo, ferramentas e base de conhecimento dos demais canais.</p></div><div className="space-y-2"><Label>Domínios autorizados</Label><Textarea placeholder={'exemplo.com.br\n*.exemplo.com.br'} value={config.allowedDomains.join('\n')} onChange={(e) => setConfig((v) => ({ ...v, allowedDomains: e.target.value.split(/\r?\n|,/).map((x) => x.trim()).filter(Boolean) }))} /><p className="text-xs text-muted-foreground">Um domínio por linha. Vazio permite qualquer domínio durante testes.</p></div><div className="space-y-2"><Label>Posição</Label><Select value={config.position} onValueChange={(position: 'left' | 'right') => setConfig((v) => ({ ...v, position }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="right">Inferior direito</SelectItem><SelectItem value="left">Inferior esquerdo</SelectItem></SelectContent></Select></div></CardContent></Card>
        <Card><CardHeader><CardTitle>Instalação</CardTitle><CardDescription>Salve a configuração e cole este código antes de fechar a tag &lt;/body&gt; do seu site.</CardDescription></CardHeader><CardContent>{snippet ? <div className="flex items-center gap-2"><code className="min-w-0 flex-1 overflow-x-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-100">{snippet}</code><Button size="icon" variant="outline" onClick={copy}>{copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}</Button></div> : <div className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">Salve a configuração para gerar o código de instalação.</div>}</CardContent></Card>
      </div>
      <div className="lg:sticky lg:top-6 lg:h-fit"><p className="mb-2 text-sm font-medium">Pré-visualização</p><div className="overflow-hidden rounded-[24px] border bg-white shadow-xl"><div className="flex items-center gap-3 p-4 text-white" style={{ backgroundColor: config.primaryColor }}><span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15"><MessageCircle className="h-5 w-5" /></span><div><p className="text-sm font-semibold">{config.name || 'Atendimento'}</p><p className="text-xs text-white/75">Atendimento pelo site</p></div></div><div className="flex min-h-[430px] flex-col justify-center gap-5 p-6"><div><h2 className="text-xl font-bold text-slate-900">{config.title}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{config.welcomeMessage}</p></div>{config.requireName && <div className="rounded-xl border px-4 py-3 text-sm text-slate-400">Seu nome</div>}{config.requireEmail && <div className="rounded-xl border px-4 py-3 text-sm text-slate-400">Seu e-mail</div>}<div className="rounded-xl px-4 py-3 text-center text-sm font-semibold text-white" style={{ backgroundColor: config.primaryColor }}>Iniciar conversa</div></div><div className="flex items-center justify-center gap-1 border-t py-3 text-[11px] text-slate-400"><Globe2 className="h-3 w-3" />Feito com Dialogy</div></div></div>
    </div>
  </div></div>;
}
