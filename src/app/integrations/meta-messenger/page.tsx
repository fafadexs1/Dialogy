'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import type { MetaChannel, User } from '@/lib/types';
import { createMetaChannel, listMetaChannels, deleteMetaChannel, getMetaVerifyToken } from '@/actions/meta-channels';
import { Loader2, Trash2, Link2, RefreshCw, Wand2, MessageCircle, Check, Copy, ArrowRight, ShieldCheck, Key, Facebook, Laptop, Settings } from 'lucide-react';
import { useCurrentUser } from '@/hooks/use-online-status';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { FacebookLoginButton } from '@/components/integrations/facebook-login-button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Separator } from '@/components/ui/separator';

function useOrigin() {
  return useMemo(() => (typeof window !== 'undefined' ? window.location.origin : process.env.NEXT_PUBLIC_SITE_URL || ''), []);
}

interface FacebookPage {
  id: string;
  name: string;
  access_token: string;
  category: string;
  picture?: { data: { url: string } };
  about?: string;
  location?: { city?: string; country?: string; street?: string };
  website?: string;
  fan_count?: number;
  verification_status?: string;
}

export default function MetaMessengerIntegrationPage() {
  const { toast } = useToast();
  const origin = useOrigin();
  const user = useCurrentUser();
  const [channels, setChannels] = useState<MetaChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verifyTokenSource, setVerifyTokenSource] = useState('');

  // Wizard States
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<'automatic' | 'manual'>('automatic');
  const fbAppId = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID || '';

  // Automatic Flow Data
  const [availablePages, setAvailablePages] = useState<FacebookPage[]>([]);
  const [selectedPageId, setSelectedPageId] = useState<string>('');

  const [form, setForm] = useState({
    name: '',
    pageId: '',
    verifyToken: '',
    accessToken: '',
    appSecret: '',
    fbUserId: '', // Add fbUserId here
    fbUserAccessToken: '',
    fbUserTokenExpiresAt: '',
  });

  const webhookUrl = `${origin}/api/webhooks/meta/messenger`;

  const generateVerifyToken = () => {
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
  };

  const resetForm = (tokenOverride?: string) => {
    const tokenValue = tokenOverride ?? (verifyTokenSource || generateVerifyToken());
    setForm({
      name: '',
      pageId: '',
      verifyToken: tokenValue,
      accessToken: '',
      appSecret: '',
      fbUserId: '',
      fbUserAccessToken: '',
      fbUserTokenExpiresAt: '',
    });
  };

  useEffect(() => {
    const loadVerifyToken = async () => {
      try {
        const token = await getMetaVerifyToken();
        if (token) {
          setVerifyTokenSource(token);
          resetForm(token);
        } else {
          resetForm();
        }
      } catch (error) {
        console.error('[META_VERIFY_TOKEN]', error);
        resetForm();
      }
    };

    loadVerifyToken();
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

  const handleCreate = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
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
        fbUserId: form.fbUserId, // Pass it to action
        fbUserAccessToken: form.fbUserAccessToken,
        fbUserTokenExpiresAt: form.fbUserTokenExpiresAt,
      });
      toast({ title: 'Conexão Estabelecida!', description: 'Facebook Messenger conectado com sucesso.' });
      resetForm();
      setSelectedPageId('');
      setAvailablePages([]);
      loadChannels(user.activeWorkspaceId);
      setStep(1);
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

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: 'Copiado!', description: `${label} copiado para a área de transferência.` });
  };

  // --- Facebook Login Automatic Flow Helpers ---
  const handleFacebookLoginSuccess = async (response: any) => {
    const userAccessToken = response.accessToken;
    const fbUserId = response.userID; // Capture User ID
    const expiresIn = Number(response.expiresIn);
    const dataAccessExpiry = Number(response.data_access_expiration_time);
    const expiresAt =
      Number.isFinite(expiresIn) && expiresIn > 0
        ? new Date(Date.now() + expiresIn * 1000).toISOString()
        : Number.isFinite(dataAccessExpiry) && dataAccessExpiry > 0
          ? new Date(dataAccessExpiry * 1000).toISOString()
          : '';
    try {
      // Fetch Pages
      const res = await fetch(`https://graph.facebook.com/v18.0/me/accounts?access_token=${userAccessToken}&fields=id,name,access_token,category,picture,about,location,website,fan_count,verification_status`);
      const data = await res.json();
      if (data.data) {
        setAvailablePages(data.data);
        // Store fbUserId temporarily in form state even if page not selected yet, or handle via selection
        setForm(prev => ({
          ...prev,
          fbUserId,
          fbUserAccessToken: userAccessToken,
          fbUserTokenExpiresAt: expiresAt,
        }));
        toast({ title: 'Páginas Carregadas', description: `${data.data.length} páginas encontradas.` });
      } else {
        toast({ title: 'Nenhuma página', description: 'Não encontramos páginas administrativas nesta conta.', variant: 'destructive' });
      }
    } catch (err) {
      console.error(err);
      toast({ title: 'Erro ao buscar páginas', description: 'Falha na comunicação com o Facebook API.', variant: 'destructive' });
    }
  };

  const handlePageSelection = (pageId: string) => {
    setSelectedPageId(pageId);
    const page = availablePages.find(p => p.id === pageId);
    if (page) {
      setForm(prev => ({
        ...prev,
        name: page.name,
        pageId: page.id,
        accessToken: page.access_token // This is the Page Access Token needed!
      }));
    }
  };

  return (
    <div className="flex flex-col h-full bg-muted/10">
      <div className="p-8 max-w-6xl mx-auto w-full space-y-8">

        {/* Header Section */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-tr from-blue-600 to-blue-400 rounded-lg text-white">
                <MessageCircle className="h-6 w-6" />
              </div>
              <h1 className="text-3xl font-bold tracking-tight">Facebook Messenger</h1>
            </div>
            <p className="text-muted-foreground text-lg ml-14">
              Gerencie mensagens da sua Página do Facebook diretamente no seu painel.
            </p>
          </div>

          <Button variant="outline" onClick={() => window.open('https://developers.facebook.com/apps/', '_blank')}>
            Abrir Meta Developers <Link2 className="ml-2 h-4 w-4" />
          </Button>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          {/* Left Column: Wizard / Form */}
          <div className="xl:col-span-2 space-y-6">
            <div className="bg-background rounded-xl border shadow-sm overflow-hidden">
              <div className="border-b bg-muted/30 p-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    Assistente de Conexão
                  </h2>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <span className={step >= 1 ? "text-primary font-medium" : ""}>1. Credenciais</span>
                    <span className="text-muted-foreground/30">/</span>
                    <span className={step >= 2 ? "text-primary font-medium" : ""}>2. Webhook</span>
                  </div>
                </div>
              </div>

              <div className="p-6">
                {step === 1 && (
                  <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                    <Tabs value={mode} onValueChange={(v) => setMode(v as any)} className="w-full">
                      <TabsList className="grid w-full grid-cols-2 mb-6">
                        <TabsTrigger value="automatic">Automático (Recomendado)</TabsTrigger>
                        <TabsTrigger value="manual">Manual (Avançado)</TabsTrigger>
                      </TabsList>

                      <TabsContent value="automatic" className="space-y-6">
                        <Alert className="bg-blue-50/50 border-blue-100 text-blue-800 dark:bg-blue-950/20 dark:border-blue-900/50 dark:text-blue-300">
                          <AlertTitle className="flex items-center gap-2 font-semibold">
                            <Laptop className="h-4 w-4" /> Conexão Simplificada
                          </AlertTitle>
                          <AlertDescription className="text-sm mt-1">
                            Faça login com sua conta do Facebook e selecione a página que deseja conectar. Nós cuidaremos dos tokens para você.
                          </AlertDescription>
                        </Alert>

                        <div className="space-y-4">
                          {!fbAppId && (
                            <Alert variant="destructive" className="mb-4">
                              <AlertTitle>Configuração Pendente</AlertTitle>
                              <AlertDescription>
                                O <strong>App ID do Facebook</strong> não foi configurado no arquivo .env.
                                Adicione <code>NEXT_PUBLIC_FACEBOOK_APP_ID</code> para usar o login automático.
                              </AlertDescription>
                            </Alert>
                          )}

                          {availablePages.length === 0 ? (
                            <div className="flex justify-center py-6">
                              <FacebookLoginButton
                                appId={fbAppId}
                                onLoginSuccess={handleFacebookLoginSuccess}
                                className="w-full max-w-sm h-12 text-base shadow-sm"
                              />
                            </div>
                          ) : (
                            <div className="space-y-3">
                              <Label>Selecione a Página para conectar:</Label>
                              <RadioGroup value={selectedPageId} onValueChange={handlePageSelection} className="grid grid-cols-1 gap-4">
                                {availablePages.map(page => (
                                  <div key={page.id} className="relative">
                                    <RadioGroupItem value={page.id} id={page.id} className="peer sr-only" />
                                    <Label
                                      htmlFor={page.id}
                                      className="flex flex-col gap-3 rounded-xl border-2 border-muted bg-card p-5 hover:bg-accent/50 hover:border-primary/50 peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 [&:has([data-state=checked])]:border-primary transition-all cursor-pointer shadow-sm"
                                    >
                                      <span className="flex items-start justify-between w-full">
                                        <span className="flex items-start gap-4">
                                          {page.picture?.data?.url ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img src={page.picture.data.url} alt={page.name} className="w-12 h-12 rounded-full border bg-white" />
                                          ) : (
                                            <span className="w-12 h-12 rounded-full bg-muted flex items-center justify-center border">
                                              <Facebook className="h-6 w-6 text-muted-foreground" />
                                            </span>
                                          )}
                                          <span className="space-y-1">
                                            <span className="font-bold text-lg leading-none block">{page.name}</span>
                                            <span className="text-sm text-muted-foreground flex items-center gap-2">
                                              <Badge variant="secondary" className="text-[10px] h-5 px-1.5">{page.category}</Badge>
                                              <span className="text-xs font-mono opacity-70">ID: {page.id}</span>
                                            </span>
                                          </span>
                                        </span>
                                        {selectedPageId === page.id && (
                                          <div className="bg-primary text-primary-foreground rounded-full p-1">
                                            <Check className="h-4 w-4" />
                                          </div>
                                        )}
                                      </span>

                                      {/* Rich Metadata Section for App Review */}
                                      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-muted-foreground mt-2 pl-[4.5rem]">
                                        {(page as any).about && (
                                          <div className="col-span-2 italic border-l-2 pl-2 py-1 my-1">
                                            "{(page as any).about}"
                                          </div>
                                        )}
                                        {(page as any).location && (page as any).location.city && (
                                          <div className="flex items-center gap-1.5">
                                            <span className="font-semibold text-foreground/80">Local:</span>
                                            {(page as any).location.city}, {(page as any).location.country}
                                          </div>
                                        )}
                                        {(page as any).website && (
                                          <div className="flex items-center gap-1.5 overflow-hidden">
                                            <span className="font-semibold text-foreground/80">Site:</span>
                                            <span className="truncate max-w-[150px]">{(page as any).website}</span>
                                          </div>
                                        )}
                                        {(page as any).fan_count !== undefined && (
                                          <div className="flex items-center gap-1.5">
                                            <span className="font-semibold text-foreground/80">Seguidores:</span>
                                            {(page as any).fan_count}
                                          </div>
                                        )}
                                        {(page as any).verification_status && (page as any).verification_status !== 'not_verified' && (
                                          <div className="flex items-center gap-1.5 text-blue-600">
                                            <ShieldCheck className="h-3 w-3" />
                                            <span className="font-semibold">Verificado ({(page as any).verification_status})</span>
                                          </div>
                                        )}
                                      </div>
                                    </Label>
                                  </div>
                                ))}
                              </RadioGroup>
                            </div>
                          )}
                        </div>

                        <div className="pt-4 flex justify-end">
                          <Button
                            type="button"
                            onClick={() => handleCreate()}
                            disabled={saving || !form.accessToken || !form.pageId}
                            className="bg-blue-600 hover:bg-blue-700 text-white min-w-[150px]"
                          >
                            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            <Check className="mr-2 h-4 w-4" /> Conectar Página
                          </Button>
                        </div>
                      </TabsContent>

                      <TabsContent value="manual" className="space-y-6">
                        <Alert>
                          <AlertTitle className="flex items-center gap-2 font-semibold">
                            <Settings className="h-4 w-4" /> Configuração Manual
                          </AlertTitle>
                          <AlertDescription className="text-sm mt-1">
                            Use isto se você já possui o Page Access Token e o Page ID gerados manualmente.
                          </AlertDescription>
                        </Alert>
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label>Nome do Canal (Interno)</Label>
                            <Input
                              value={form.name}
                              onChange={(e) => setForm({ ...form, name: e.target.value })}
                              placeholder="Ex: Suporte Página Facebook"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label>Page ID (ID da Página)</Label>
                            <Input
                              required
                              value={form.pageId}
                              onChange={(e) => setForm({ ...form, pageId: e.target.value })}
                              placeholder="Ex: 10456789..."
                              className="font-mono text-sm"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label>Token de Acesso da Página</Label>
                            <Input
                              required
                              type="password"
                              value={form.accessToken}
                              onChange={(e) => setForm({ ...form, accessToken: e.target.value })}
                              placeholder="EAA..."
                              className="font-mono text-sm"
                            />
                          </div>
                        </div>
                        <div className="pt-4 flex justify-end">
                          <Button type="button" onClick={() => setStep(2)} disabled={!form.accessToken || !form.pageId}>
                            Próximo: Configurar Webhook <ArrowRight className="ml-2 h-4 w-4" />
                          </Button>
                        </div>
                      </TabsContent>
                    </Tabs>
                  </div>
                )}

                {step === 2 && (
                  <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                    <div className="space-y-4">
                      <div className="p-4 bg-muted/40 rounded-lg border">
                        <h3 className="font-medium mb-2 flex items-center gap-2 text-foreground">
                          <div className="bg-primary/10 p-1.5 rounded-full text-primary"><Check className="h-3 w-3" /></div>
                          Quase pronto!
                        </h3>
                        <p className="text-sm text-muted-foreground mb-4">
                          Agora você precisa configurar o Webhook no painel do Meta para que as mensagens cheguem até aqui.
                        </p>
                        <Separator className="my-3" />
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label className="text-muted-foreground text-xs uppercase tracking-wider font-bold">Callback URL</Label>
                            <div className="flex gap-2">
                              <Input readOnly value={webhookUrl} className="font-mono text-sm bg-background" />
                              <Button type="button" variant="outline" size="icon" onClick={() => copyToClipboard(webhookUrl, 'URL')}>
                                <Copy className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <Label className="text-muted-foreground text-xs uppercase tracking-wider font-bold">Verify Token</Label>
                            <div className="flex gap-2">
                              <Input readOnly value={form.verifyToken} className="font-mono text-sm bg-background" />
                              <Button type="button" variant="outline" size="icon" onClick={() => copyToClipboard(form.verifyToken, 'Token')}>
                                <Copy className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="pt-4 flex items-center justify-between border-t mt-6">
                      <Button type="button" variant="ghost" onClick={() => setStep(1)}>
                        Voltar
                      </Button>
                      <Button onClick={() => handleCreate()} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white min-w-[200px]">
                        {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        <Check className="mr-2 h-4 w-4" /> Concluir Conexão
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Existing Channels */}
          <div className="space-y-6">
            <Card className="h-full border-none shadow-none bg-transparent">
              <CardHeader className="px-0 pt-0">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">Conexões Ativas</CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => user?.activeWorkspaceId && loadChannels(user.activeWorkspaceId)} disabled={loading}>
                    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                  </Button>
                </div>
                <CardDescription>Páginas conectadas no momento.</CardDescription>
              </CardHeader>
              <CardContent className="px-0 space-y-4">
                {loading ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                ) : channels.length === 0 ? (
                  <div className="text-center py-10 border-2 border-dashed rounded-xl ">
                    <MessageCircle className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">Nenhuma página conectada.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {channels.map((ch) => (
                      <div key={ch.id} className="group relative bg-card p-4 rounded-xl border shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800">Ativo</Badge>
                            <span className="text-xs font-mono text-muted-foreground truncate max-w-[120px]" title={ch.external_page_id || ''}>
                              ID: {ch.external_page_id || 'N/A'}
                            </span>
                          </div>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-red-500 -mr-2 -mt-2 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => handleDelete(ch.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        <h3 className="font-semibold text-foreground">{ch.name || 'Página Sem Nome'}</h3>
                        <div className="mt-3 pt-3 border-t flex items-center justify-between text-xs text-muted-foreground">
                          <span>Última sincronização: Agora</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
