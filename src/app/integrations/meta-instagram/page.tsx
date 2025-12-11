'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import type { MetaChannel, User } from '@/lib/types';
import { createMetaChannel, listMetaChannels, deleteMetaChannel, exchangeInstagramToken } from '@/actions/meta-channels';
import { Loader2, Trash2, Link2, RefreshCw, Wand2, Instagram, Check, Copy, ArrowRight, ShieldCheck, Key, Laptop, Settings, Facebook } from 'lucide-react';
import { useCurrentUser } from '@/hooks/use-online-status';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { FacebookLoginButton } from '@/components/integrations/facebook-login-button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Separator } from '@/components/ui/separator';
import { useRouter, useSearchParams } from 'next/navigation';

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
}

export default function MetaInstagramIntegrationPage() {
  const { toast } = useToast();
  const origin = useOrigin();
  const user = useCurrentUser();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [channels, setChannels] = useState<MetaChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isExchanging, setIsExchanging] = useState(false);

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
    verifyToken: '',
    accessToken: '',
    appSecret: '',
    fbUserId: '',
  });

  const webhookUrl = `${origin}/api/webhooks/meta/instagram`;

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

  // --- Instagram Login Code Exchange ---
  useEffect(() => {
    const code = searchParams.get('code');
    if (code && user?.activeWorkspaceId && !isExchanging) {
      const handleExchange = async () => {
        setIsExchanging(true);
        toast({ title: 'Conectando...', description: 'Trocando código de autorização...' });
        try {
          const currentRedirectUri = `${window.location.origin}/integrations/meta-instagram`;
          await exchangeInstagramToken(code, user.activeWorkspaceId!, currentRedirectUri);
          toast({ title: 'Sucesso!', description: 'Instagram conectado com sucesso.' });

          // Clear query params
          const newUrl = window.location.pathname;
          window.history.replaceState({}, '', newUrl);

          loadChannels(user.activeWorkspaceId!);
        } catch (error: any) {
          console.error(error);
          toast({ title: 'Erro na conexão', description: error.message || 'Falha ao conectar Instagram.', variant: 'destructive' });
        } finally {
          setIsExchanging(false);
        }
      };

      handleExchange();
    }
  }, [searchParams, user?.activeWorkspaceId]);
  // -------------------------------------

  const handleCreate = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!user?.activeWorkspaceId) return;
    setSaving(true);
    try {
      await createMetaChannel({
        workspaceId: user.activeWorkspaceId,
        type: 'instagram',
        name: form.name,
        externalPageId: form.igBusinessId,
        verifyToken: form.verifyToken,
        accessToken: form.accessToken,
        appSecret: form.appSecret || null,
        fbUserId: form.fbUserId,
      });
      toast({ title: 'Instagram Conectado!', description: 'Conexão estabelecida com sucesso.' });
      setForm({ name: '', igBusinessId: '', verifyToken: '', accessToken: '', appSecret: '', fbUserId: '' });
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
  const handleFacebookLoginSuccess = async (response: any) => {
    const userAccessToken = response.accessToken;
    const fbUserId = response.userID;
    // 1. Get Pages first
    try {
      const pagesRes = await fetch(`https://graph.facebook.com/v18.0/me/accounts?access_token=${userAccessToken}&fields=id,name,access_token,instagram_business_account{id,name,username,profile_picture_url}`);
      const pagesData = await pagesRes.json();

      if (pagesData.data) {
        setForm(prev => ({ ...prev, fbUserId }));
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
              access_token: page.access_token // We use the Page Token to manage the IG account!
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
  };

  const handleAccountSelection = (accountId: string) => {
    setSelectedAccountId(accountId);
    const acc = availableAccounts.find(a => a.id === accountId);
    if (acc) {
      setForm(prev => ({
        ...prev,
        name: acc.username,
        igBusinessId: acc.id,
        accessToken: acc.access_token
      }));
    }
  };

  const handleInstagramLogin = () => {
    const currentRedirectUri = `${window.location.origin}/integrations/meta-instagram`;
    const clientId = process.env.NEXT_PUBLIC_INSTAGRAM_APP_ID;
    const authUrl = `https://www.instagram.com/oauth/authorize?force_reauth=true&client_id=${clientId}&redirect_uri=${encodeURIComponent(currentRedirectUri)}&response_type=code&scope=instagram_business_basic%2Cinstagram_business_manage_messages%2Cinstagram_business_manage_comments%2Cinstagram_business_content_publish%2Cinstagram_business_manage_insights`;

    console.log('[Instagram Auth] Client ID:', clientId);
    console.log('[Instagram Auth] Redirect URI:', currentRedirectUri);
    console.log('[Instagram Auth] URL:', authUrl);

    window.location.href = authUrl;
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
                        <TabsTrigger value="automatic">Automático (Novo)</TabsTrigger>
                        <TabsTrigger value="manual">Manual / Legacy</TabsTrigger>
                      </TabsList>

                      <TabsContent value="automatic" className="space-y-6">
                        <Alert className="bg-purple-50/50 border-purple-100 text-purple-800 dark:bg-purple-950/20 dark:border-purple-900/50 dark:text-purple-300">
                          <AlertTitle className="flex items-center gap-2 font-semibold">
                            <Instagram className="h-4 w-4" /> Login com Instagram
                          </AlertTitle>
                          <AlertDescription className="text-sm mt-1">
                            Use sua conta do Instagram Business para conectar diretamente.
                          </AlertDescription>
                        </Alert>

                        <div className="flex justify-center py-6">
                          <Button
                            onClick={handleInstagramLogin}
                            className="w-full max-w-sm h-12 text-base shadow-sm bg-gradient-to-r from-[#833AB4] via-[#FD1D1D] to-[#F77737] hover:opacity-90 text-white"
                            disabled={isExchanging}
                          >
                            {isExchanging ? (
                              <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Conectando...</>
                            ) : (
                              <><Instagram className="mr-2 h-5 w-5" /> Conectar com Instagram</>
                            )}
                          </Button>
                        </div>
                      </TabsContent>

                      <TabsContent value="manual" className="space-y-6">
                        <Alert className="mb-4">
                          <AlertTitle>Modo Legacy (Facebook)</AlertTitle>
                          <AlertDescription>
                            Conecte via Facebook Login para listar páginas vinculadas.
                          </AlertDescription>
                        </Alert>

                        {!fbAppId && (
                          <Alert variant="destructive" className="mb-4">
                            <AlertDescription>NEXT_PUBLIC_FACEBOOK_APP_ID não configurado.</AlertDescription>
                          </Alert>
                        )}

                        <div className="flex justify-center mb-6">
                          <FacebookLoginButton
                            appId={fbAppId}
                            onLoginSuccess={handleFacebookLoginSuccess}
                            label="Buscar Paginas via Facebook"
                            className="w-full max-w-sm"
                          />
                        </div>

                        {/* Existing manual connection fields if needed, or just list accounts found via FB */}
                        {availableAccounts.length > 0 && (
                          <div className="space-y-3">
                            <Label>Selecione a Conta do Instagram (via Facebook):</Label>
                            <RadioGroup value={selectedAccountId} onValueChange={handleAccountSelection} className="grid grid-cols-1 gap-3">
                              {availableAccounts.map(acc => (
                                <div key={acc.id}>
                                  <RadioGroupItem value={acc.id} id={acc.id} className="peer sr-only" />
                                  <Label
                                    htmlFor={acc.id}
                                    className="flex items-center justify-between rounded-lg border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary transition-all cursor-pointer"
                                  >
                                    <div className="flex items-center gap-3">
                                      {acc.profile_picture_url ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={acc.profile_picture_url} alt={acc.name} className="w-10 h-10 rounded-full" />
                                      ) : (
                                        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                                          <Instagram className="h-5 w-5 text-muted-foreground" />
                                        </div>
                                      )}
                                      <div>
                                        <div className="font-semibold text-lg">@{acc.username}</div>
                                        <div className="text-xs text-muted-foreground">Via Página: {acc.page_name}</div>
                                      </div>
                                    </div>
                                    {selectedAccountId === acc.id && <Check className="h-5 w-5 text-primary" />}
                                  </Label>
                                </div>
                              ))}
                            </RadioGroup>

                            <div className="pt-4 flex justify-end">
                              <Button
                                type="button"
                                onClick={() => handleCreate()}
                                disabled={saving || !form.accessToken || !form.igBusinessId}
                                className="bg-pink-600 hover:bg-pink-700 text-white min-w-[150px]"
                              >
                                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                <Check className="mr-2 h-4 w-4" /> Conectar Selecionada
                              </Button>
                            </div>
                          </div>
                        )}
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
                            <span className="text-xs font-mono text-muted-foreground truncate max-w-[120px]" title={ch.external_page_id || ''}>
                              ID: {ch.external_page_id || 'N/A'}
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
