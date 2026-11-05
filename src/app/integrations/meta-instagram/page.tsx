'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import type { MetaChannel } from '@/lib/types';
import { createMetaChannel, listMetaChannels, deleteMetaChannel, getMetaVerifyTokenStatus } from '@/actions/meta-channels';
import { Loader2, Trash2, Link2, RefreshCw, Check, Copy, ArrowRight, ShieldCheck, Settings } from 'lucide-react';
import { FaFacebook as Facebook, FaInstagram as Instagram } from 'react-icons/fa6';
import { useCurrentUser } from '@/hooks/use-online-status';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { FacebookLoginButton } from '@/components/integrations/facebook-login-button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Separator } from '@/components/ui/separator';

function useOrigin() {
  return useMemo(() => (typeof window !== 'undefined' ? window.location.origin : process.env.NEXT_PUBLIC_SITE_URL || ''), []);
}

interface InstagramAccount {
  id: string; // Instagram Business Account ID
  name: string;
  username: string;
  profile_picture_url?: string;
  page_id: string; // Connected Facebook Page ID
  page_name: string;
  access_token: string; // Page Access Token
  // Metadata for App Review
  about?: string;
  location?: { city?: string; country?: string; street?: string };
  website?: string;
  followers_count?: number;
  verification_status?: string;
}

export default function MetaInstagramIntegrationPage() {
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
  const [fbAppId] = useState(process.env.NEXT_PUBLIC_FACEBOOK_APP_ID || '');

  // Automatic Flow Data
  const [availableAccounts, setAvailableAccounts] = useState<InstagramAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');

  const [form, setForm] = useState({
    name: '',
    igBusinessId: '',
    pageId: '',
    verifyToken: '',
    accessToken: '',
    appSecret: '',
    fbUserId: '',
    fbUserAccessToken: '',
    fbUserTokenExpiresAt: '',
  });

  const webhookUrl = `${origin}/api/webhooks/meta/instagram`;

  const generateVerifyToken = () => {
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
  };

  const resetForm = (tokenOverride?: string) => {
    const tokenValue = tokenOverride ?? (verifyTokenSource || generateVerifyToken());
    setForm({
      name: '',
      igBusinessId: '',
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
      if (!user?.activeWorkspaceId) return;
      try {
        await getMetaVerifyTokenStatus(user.activeWorkspaceId);
        resetForm();
      } catch (error) {
        console.error('[META_VERIFY_TOKEN]', error);
        resetForm();
      }
    };

    loadVerifyToken();
  }, [user?.activeWorkspaceId]);

  const loadChannels = async (workspaceId: string) => {
    setLoading(true);
    try {
      const data = await listMetaChannels(workspaceId, 'instagram');
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
    if (!form.pageId || !form.igBusinessId || !form.accessToken) {
      toast({ title: 'Dados incompletos', description: 'Informe Page ID, Instagram Business ID e token de acesso.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await createMetaChannel({
        workspaceId: user.activeWorkspaceId,
        type: 'instagram',
        name: form.name,
        externalPageId: form.pageId,
        igBusinessId: form.igBusinessId,
        verifyToken: form.verifyToken,
        accessToken: form.accessToken,
        appSecret: form.appSecret || null,
        fbUserId: form.fbUserId,
        fbUserAccessToken: form.fbUserAccessToken,
        fbUserTokenExpiresAt: form.fbUserTokenExpiresAt,
      });
      toast({ title: 'Instagram Conectado!', description: 'Conexão estabelecida com sucesso.' });
      resetForm();
      setSelectedAccountId('');
      setAvailableAccounts([]);
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

  // --- Automatic Instagram Logic ---
  const handleFacebookLoginSuccess = (response: any) => {
    (async () => {
      const userAccessToken = response.accessToken;
      const fbUserId = response.userID;
      const expiresIn = Number(response.expiresIn);
      const dataAccessExpiry = Number(response.data_access_expiration_time);
      const expiresAt =
        Number.isFinite(expiresIn) && expiresIn > 0
          ? new Date(Date.now() + expiresIn * 1000).toISOString()
          : Number.isFinite(dataAccessExpiry) && dataAccessExpiry > 0
            ? new Date(dataAccessExpiry * 1000).toISOString()
            : '';
      // 1. Get Pages first
      try {
        const pagesRes = await fetch(`https://graph.facebook.com/v20.0/me/accounts?access_token=${userAccessToken}&fields=id,name,access_token,about,location,website,fan_count,verification_status,instagram_business_account{id,name,username,profile_picture_url,followers_count,website,biography}`);
        const pagesData = await pagesRes.json();

        if (pagesData.data) {
          setForm(prev => ({
            ...prev,
            fbUserId,
            fbUserAccessToken: userAccessToken,
            fbUserTokenExpiresAt: expiresAt,
          }));
          const accounts: InstagramAccount[] = [];

          for (const page of pagesData.data) {
            if (page.instagram_business_account) {
              accounts.push({
                id: page.instagram_business_account.id,
                name: page.instagram_business_account.name || page.instagram_business_account.username,
                username: page.instagram_business_account.username,
                profile_picture_url: page.instagram_business_account.profile_picture_url,
                page_id: page.id,
                page_name: page.name,
                access_token: page.access_token, // We use the Page Token to manage the IG account!
                // Prioritize Instagram specific data, fallback to Page data where appropriate for "Public Metadata" proof
                about: page.instagram_business_account.biography || page.about,
                location: page.location,
                website: page.instagram_business_account.website || page.website,
                followers_count: page.instagram_business_account.followers_count || page.fan_count,
                verification_status: page.verification_status
              });
            }
          }

          if (accounts.length > 0) {
            setAvailableAccounts(accounts);
            toast({ title: 'Contas Encontradas', description: `${accounts.length} contas de Instagram Business encontradas.` });
          } else {
            toast({ title: 'Nenhuma conta Business', description: 'Encontramos suas páginas, mas nenhuma tem conta Instagram Business vinculada.', variant: 'destructive' });
          }
        }
      } catch (err) {
        console.error(err);
        toast({ title: 'Erro na API', description: 'Falha ao buscar contas do Instagram.', variant: 'destructive' });
      }
    })();
  };

  const handleAccountSelection = (accountId: string) => {
    setSelectedAccountId(accountId);
    const acc = availableAccounts.find(a => a.id === accountId);
    if (acc) {
      setForm(prev => ({
        ...prev,
        name: acc.username,
        igBusinessId: acc.id,
        pageId: acc.page_id,
        accessToken: acc.access_token
      }));
    }
  };

  return (
    <div className="flex flex-col h-full bg-muted/10">
      <div className="p-8 max-w-6xl mx-auto w-full space-y-8">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-tr from-purple-500 via-pink-500 to-orange-400 rounded-lg text-white">
                <Instagram className="h-6 w-6" />
              </div>
              <h1 className="text-3xl font-bold tracking-tight">Instagram Business</h1>
            </div>
            <p className="text-muted-foreground text-lg ml-14">
              Responda DMs e comentários do Instagram diretamente na plataforma.
            </p>
          </div>
          <Button variant="outline" onClick={() => window.open('https://developers.facebook.com/apps/', '_blank')}>
            Abrir Meta Developers <Link2 className="ml-2 h-4 w-4" />
          </Button>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          {/* Left Column: Form / Wizard */}
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
                        <TabsTrigger value="automatic">Automatico (Facebook)</TabsTrigger>
                        <TabsTrigger value="manual">Manual</TabsTrigger>
                      </TabsList>

                      <TabsContent value="automatic" className="space-y-6">
                        <Alert className="bg-blue-50/50 border-blue-100 text-blue-800 dark:bg-blue-950/20 dark:border-blue-900/50 dark:text-blue-300">
                          <AlertTitle className="flex items-center gap-2 font-semibold">
                            <Facebook className="h-4 w-4" /> Conexao via Facebook
                          </AlertTitle>
                          <AlertDescription className="text-sm mt-1">
                            Use o login do Facebook para selecionar a pagina vinculada ao Instagram Business.
                          </AlertDescription>
                        </Alert>

                        {!fbAppId && (
                          <Alert variant="destructive" className="mb-4">
                            <AlertDescription>NEXT_PUBLIC_FACEBOOK_APP_ID nao configurado.</AlertDescription>
                          </Alert>
                        )}

                        {availableAccounts.length === 0 ? (
                          <div className="flex justify-center py-6">
                            <FacebookLoginButton
                              appId={fbAppId}
                              onLoginSuccess={handleFacebookLoginSuccess}
                              label="Buscar Paginas via Facebook"
                              className="w-full max-w-sm"
                            />
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <Label>Selecione a Conta do Instagram (via Facebook):</Label>
                            <RadioGroup value={selectedAccountId} onValueChange={handleAccountSelection} className="grid grid-cols-1 gap-4">
                              {availableAccounts.map(acc => (
                                <div key={acc.id} className="relative">
                                  <RadioGroupItem value={acc.id} id={acc.id} className="peer sr-only" />
                                  <Label
                                    htmlFor={acc.id}
                                    className="flex flex-col gap-3 rounded-xl border-2 border-muted bg-card p-5 hover:bg-accent/50 hover:border-primary/50 peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 [&:has([data-state=checked])]:border-primary transition-all cursor-pointer shadow-sm"
                                  >
                                    <span className="flex items-start justify-between w-full">
                                      <span className="flex items-start gap-4">
                                        {acc.profile_picture_url ? (
                                          // eslint-disable-next-line @next/next/no-img-element
                                          <img src={acc.profile_picture_url} alt={acc.name} className="w-12 h-12 rounded-full border bg-white" />
                                        ) : (
                                          <span className="w-12 h-12 rounded-full bg-muted flex items-center justify-center border">
                                            <Instagram className="h-6 w-6 text-muted-foreground" />
                                          </span>
                                        )}
                                        <span className="space-y-1">
                                          <span className="font-bold text-lg leading-none block">@{acc.username}</span>
                                          <span className="text-sm text-muted-foreground flex items-center gap-2">
                                            <Badge variant="secondary" className="text-[10px] h-5 px-1.5 flex gap-1">
                                              <Facebook className="h-3 w-3" /> {acc.page_name}
                                            </Badge>
                                          </span>
                                        </span>
                                      </span>
                                      {selectedAccountId === acc.id && (
                                        <div className="bg-primary text-primary-foreground rounded-full p-1">
                                          <Check className="h-4 w-4" />
                                        </div>
                                      )}
                                    </span>

                                    {/* Rich Metadata Section for App Review */}
                                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-muted-foreground mt-2 pl-[4.5rem]">
                                      {acc.about && (
                                        <div className="col-span-2 italic border-l-2 pl-2 py-1 my-1">
                                          "{acc.about}"
                                        </div>
                                      )}
                                      {acc.location && acc.location.city && (
                                        <div className="flex items-center gap-1.5">
                                          <span className="font-semibold text-foreground/80">Local:</span>
                                          {acc.location.city}, {acc.location.country}
                                        </div>
                                      )}
                                      {acc.website && (
                                        <div className="flex items-center gap-1.5 overflow-hidden">
                                          <span className="font-semibold text-foreground/80">Site:</span>
                                          <span className="truncate max-w-[150px]">{acc.website}</span>
                                        </div>
                                      )}
                                      {acc.followers_count !== undefined && (
                                        <div className="flex items-center gap-1.5">
                                          <span className="font-semibold text-foreground/80">Seguidores:</span>
                                          {acc.followers_count}
                                        </div>
                                      )}
                                      {acc.verification_status && acc.verification_status !== 'not_verified' && (
                                        <div className="flex items-center gap-1.5 text-blue-600">
                                          <ShieldCheck className="h-3 w-3" />
                                          <span className="font-semibold">Verificado ({acc.verification_status})</span>
                                        </div>
                                      )}
                                    </div>
                                  </Label>
                                </div>
                              ))}
                            </RadioGroup>
                          </div>
                        )}

                        <div className="pt-4 flex justify-end">
                          <Button
                            type="button"
                            onClick={() => setStep(2)}
                            disabled={saving || !form.accessToken || !form.igBusinessId || !form.pageId}
                          >
                            Proximo: Configurar Webhook <ArrowRight className="ml-2 h-4 w-4" />
                          </Button>
                        </div>
                      </TabsContent>

                      <TabsContent value="manual" className="space-y-6">
                        <Alert>
                          <AlertTitle className="flex items-center gap-2 font-semibold">
                            <Settings className="h-4 w-4" /> Configuracao manual
                          </AlertTitle>
                          <AlertDescription className="text-sm mt-1">
                            Use se voce ja possui Page ID, Instagram Business ID e token da pagina.
                          </AlertDescription>
                        </Alert>

                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label>Nome do Canal (Interno)</Label>
                            <Input
                              value={form.name}
                              onChange={(e) => setForm({ ...form, name: e.target.value })}
                              placeholder="Ex: Suporte Instagram"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label>Instagram Business ID</Label>
                            <Input
                              required
                              value={form.igBusinessId}
                              onChange={(e) => setForm({ ...form, igBusinessId: e.target.value })}
                              placeholder="Ex: 178414..."
                              className="font-mono text-sm"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label>Page ID (Facebook)</Label>
                            <Input
                              required
                              value={form.pageId}
                              onChange={(e) => setForm({ ...form, pageId: e.target.value })}
                              placeholder="Ex: 10456789..."
                              className="font-mono text-sm"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label>Token de Acesso da Pagina</Label>
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
                          <Button
                            type="button"
                            onClick={() => setStep(2)}
                            disabled={saving || !form.accessToken || !form.igBusinessId || !form.pageId}
                          >
                            Proximo: Configurar Webhook <ArrowRight className="ml-2 h-4 w-4" />
                          </Button>
                        </div>
                      </TabsContent>
                    </Tabs>
                  </div>
                )}

                {step === 2 && (
                  <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                    <div className="p-4 bg-muted/40 rounded-lg border">
                      <h3 className="font-medium mb-2 flex items-center gap-2 text-foreground">
                        <div className="bg-primary/10 p-1.5 rounded-full text-primary"><Check className="h-3 w-3" /></div>
                        Instruções Finais
                      </h3>
                      <p className="text-sm text-muted-foreground mb-4">
                        Configure o Webhook na dashboard do Meta Developers para receber mensagens.
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

                    <div className="pt-4 flex items-center justify-between border-t mt-6">
                      <Button type="button" variant="ghost" onClick={() => setStep(1)}>
                        Voltar
                      </Button>
                      <Button onClick={() => handleCreate()} disabled={saving} className="bg-pink-600 hover:bg-pink-700 text-white min-w-[200px]">
                        {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        <Check className="mr-2 h-4 w-4" /> Concluir Conexão
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column: List */}
          <div className="space-y-6">
            <Card className="h-full border-none shadow-none bg-transparent">
              <CardHeader className="px-0 pt-0">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">Conexões Ativas</CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => user?.activeWorkspaceId && loadChannels(user.activeWorkspaceId)} disabled={loading}>
                    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                  </Button>
                </div>
                <CardDescription>Contas Instagram conectadas.</CardDescription>
              </CardHeader>
              <CardContent className="px-0 space-y-4">
                {loading ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                ) : channels.length === 0 ? (
                  <div className="text-center py-10 border-2 border-dashed rounded-xl ">
                    <Instagram className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">Nenhuma conta conectada.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {channels.map((ch) => (
                      <div key={ch.id} className="group relative bg-card p-4 rounded-xl border shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800">Ativo</Badge>
                            <span className="text-xs font-mono text-muted-foreground truncate max-w-[120px]" title={ch.ig_business_id || ch.external_page_id || ''}>
                              ID: {ch.ig_business_id || ch.external_page_id || 'N/A'}
                            </span>
                          </div>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-red-500 -mr-2 -mt-2 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => handleDelete(ch.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        <h3 className="font-semibold text-foreground">{ch.name || 'Conta Sem Nome'}</h3>
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



