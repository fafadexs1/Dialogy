'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import type { MetaChannel, User } from '@/lib/types';
import { createMetaChannel, listMetaChannels, deleteMetaChannel } from '@/actions/meta-channels';
import { Loader2, Trash2, Link2, RefreshCw, Wand2 } from 'lucide-react';
import { useCurrentUser } from '@/hooks/use-online-status';

function useOrigin() {
  return useMemo(() => (typeof window !== 'undefined' ? window.location.origin : process.env.NEXT_PUBLIC_SITE_URL || ''), []);
}

export default function MetaMessengerIntegrationPage() {
  const { toast } = useToast();
  const origin = useOrigin();
  const user = useCurrentUser();
  const [channels, setChannels] = useState<MetaChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    pageId: '',
    verifyToken: '',
    accessToken: '',
    appSecret: '',
  });

  const webhookUrl = `${origin}/api/webhooks/meta/messenger`;

  // Gera verify_token aleatório por canal/workspace
  const generateVerifyToken = () => {
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
  };

  useEffect(() => {
    setForm((prev) => ({ ...prev, verifyToken: generateVerifyToken() }));
  }, []);

  const loadChannels = async (workspaceId: string) => {
    setLoading(true);
    try {
      const data = await listMetaChannels(workspaceId, 'messenger');
      setChannels(data);
    } catch (error: any) {
      toast({ title: 'Erro ao listar', description: error.message || 'Falha ao carregar canais.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user?.activeWorkspaceId) {
      loadChannels(user.activeWorkspaceId);
    }
  }, [user?.activeWorkspaceId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.activeWorkspaceId) return;
    setSaving(true);
    try {
      await createMetaChannel({
        workspaceId: user.activeWorkspaceId,
        type: 'messenger',
        name: form.name,
        externalPageId: form.pageId,
        verifyToken: form.verifyToken,
        accessToken: form.accessToken,
        appSecret: form.appSecret || null,
      });
      toast({ title: 'Canal criado', description: 'Messenger pronto para configurar o Webhook.' });
      setForm({ name: '', pageId: '', verifyToken: '', accessToken: '', appSecret: '' });
      loadChannels(user.activeWorkspaceId);
    } catch (error: any) {
      toast({ title: 'Erro ao criar', description: error.message || 'Falha ao salvar canal.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!user?.activeWorkspaceId) return;
    await deleteMetaChannel(id, user.activeWorkspaceId);
    loadChannels(user.activeWorkspaceId);
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3 justify-between flex-wrap">
        <div className="flex items-center gap-3">
          <Badge>Messenger</Badge>
          <h1 className="text-2xl font-semibold">Integração Oficial</h1>
        </div>
        <div className="text-sm text-muted-foreground flex items-center gap-2">
          <Link2 className="h-4 w-4" />
          Callback: <code className="text-xs">{webhookUrl}</code>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Conectar Messenger</CardTitle>
          <CardDescription>Salve verify_token, access_token e Page ID. Use o callback acima no App Meta.</CardDescription>
        </CardHeader>
        <form onSubmit={handleCreate}>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Nome do canal</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Suporte Messenger" />
            </div>
            <div className="space-y-2">
              <Label>Page ID</Label>
              <Input required value={form.pageId} onChange={(e) => setForm({ ...form, pageId: e.target.value })} placeholder="1234567890" />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center justify-between">
                <span>Verify Token</span>
                <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => setForm((prev) => ({ ...prev, verifyToken: generateVerifyToken() }))}>
                  <Wand2 className="h-4 w-4 mr-1" /> Gerar
                </Button>
              </Label>
              <Input required value={form.verifyToken} onChange={(e) => setForm({ ...form, verifyToken: e.target.value })} placeholder="token-seguro" />
            </div>
            <div className="space-y-2">
              <Label>Access Token (Page)</Label>
              <Input required type="password" value={form.accessToken} onChange={(e) => setForm({ ...form, accessToken: e.target.value })} placeholder="EAAB..." />
            </div>
            <div className="space-y-2">
              <Label>App Secret (HMAC)</Label>
              <Input type="password" value={form.appSecret} onChange={(e) => setForm({ ...form, appSecret: e.target.value })} placeholder="opcional, para validar assinatura" />
            </div>
          </CardContent>
          <CardFooter className="flex justify-end">
            <Button type="submit" disabled={saving || !user?.activeWorkspaceId}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar canal
            </Button>
          </CardFooter>
        </form>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Canais Messenger</CardTitle>
              <CardDescription>Registros atuais no workspace.</CardDescription>
            </div>
            <Button variant="ghost" onClick={() => user?.activeWorkspaceId && loadChannels(user.activeWorkspaceId)} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="text-sm text-muted-foreground">Carregando...</div>
          ) : channels.length === 0 ? (
            <div className="text-sm text-muted-foreground">Nenhum canal criado ainda.</div>
          ) : (
            <div className="grid gap-3">
              {channels.map((ch) => (
                <Card key={ch.id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-base">{ch.name || 'Messenger'}</CardTitle>
                        <CardDescription>{ch.external_page_id ? `Page ID: ${ch.external_page_id}` : '—'}</CardDescription>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(ch.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-1 text-sm text-muted-foreground">
                    <div>Verify Token: <code>{ch.verify_token || '—'}</code></div>
                    <div>Status: {ch.status || 'active'}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
