'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowLeft,
  BarChart3,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Unplug,
} from 'lucide-react';

import {
  disconnectGoogleAdsAccount,
  getGoogleAdsCampaignPerformance,
  getGoogleAdsConversionHealth,
  getGoogleAdsIntegrationConfig,
  listGoogleAdsAccounts,
  listGoogleAdsConversionActions,
  saveGoogleAdsIntegrationConfig,
  type GoogleAdsAccountOption,
  type GoogleAdsPerformanceReport,
  type GoogleAdsConversionActionOption,
  type GoogleAdsConversionHealth,
  type GoogleAdsDestination,
  type GoogleAdsIntegrationConfig,
} from '@/actions/google-ads';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useCurrentUser } from '@/hooks/use-online-status';

type EvolutionInstanceOption = {
  instanceName: string;
  displayName: string | null;
  type: string | null;
};

const EMPTY_CONFIG: GoogleAdsIntegrationConfig = {
  customerId: '',
  loginCustomerId: '',
  refreshToken: '',
  conversionActionWhatsappMessage: '',
  conversionActionLeadQualified: '',
  conversionActionSaleWon: '',
  consentAdUserData: '',
  consentAdPersonalization: '',
  connected: false,
  destinations: [],
};

const CONSENT_OPTIONS = [
  { value: 'unset', label: 'Nao declarar' },
  { value: 'GRANTED', label: 'Concedido' },
  { value: 'DENIED', label: 'Negado' },
] as const;

/**
 * As tres conversoes que o Dialogy sabe emitir, na ordem em que aprofundam o
 * sinal entregue ao Smart Bidding.
 */
const CONVERSION_SLOTS = [
  {
    key: 'conversionActionWhatsappMessage' as const,
    title: 'Mensagem recebida',
    hint: 'Dispara quando o lead manda a primeira mensagem. Sozinha, faz o Google buscar volume.',
    required: true,
  },
  {
    key: 'conversionActionLeadQualified' as const,
    title: 'Lead qualificado',
    hint: 'Dispara quando o contato avanca do primeiro estagio do funil.',
    required: false,
  },
  {
    key: 'conversionActionSaleWon' as const,
    title: 'Venda fechada',
    hint: 'Dispara com o valor real do negocio ganho. E o sinal que ensina o Google a buscar qualidade.',
    required: false,
  },
];

function createEmptyGoogleAdsDestination(): GoogleAdsDestination {
  const id = Math.random().toString(36).slice(2, 10);
  return {
    id,
    name: 'Novo destino',
    slug: id,
    instanceName: '',
    phone: '',
    defaultMessage: 'Ola, quero atendimento.',
  };
}

function buildTrackingUrl(origin: string, workspaceId: string, destination: GoogleAdsDestination) {
  if (!workspaceId || !destination.instanceName || !destination.slug) return '';
  const url = new URL(`/t/wpp/${workspaceId}/${destination.instanceName}`, origin || 'https://app.dialogy.com.br');
  url.searchParams.set('dest', destination.slug);
  url.searchParams.set('utm_source', 'google');
  url.searchParams.set('utm_medium', 'cpc');
  url.searchParams.set('utm_campaign', '{campaignid}');
  url.searchParams.set('gclid', '{gclid}');
  url.searchParams.set('gbraid', '{gbraid}');
  url.searchParams.set('wbraid', '{wbraid}');
  url.searchParams.set('adgroupid', '{adgroupid}');
  url.searchParams.set('creative', '{creative}');
  url.searchParams.set('keyword', '{keyword}');
  url.searchParams.set('device', '{device}');
  url.searchParams.set('matchtype', '{matchtype}');
  return url.toString();
}

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: currency || 'BRL',
    maximumFractionDigits: 2,
  }).format(value);
}

function StepCard({
  step,
  title,
  description,
  done,
  disabled,
  children,
}: {
  step: number;
  title: string;
  description: string;
  done: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card className={disabled ? 'opacity-60' : undefined}>
      <CardHeader>
        <div className="flex items-start gap-3">
          <div
            className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
              done ? 'bg-emerald-500 text-white' : 'bg-muted text-muted-foreground'
            }`}
          >
            {done ? <Check className="h-4 w-4" /> : step}
          </div>
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">{children}</CardContent>
    </Card>
  );
}

export default function GadsIntegrationPage() {
  const user = useCurrentUser();
  const { toast } = useToast();
  const workspaceId = user?.activeWorkspaceId;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [instances, setInstances] = useState<EvolutionInstanceOption[]>([]);
  const [config, setConfig] = useState<GoogleAdsIntegrationConfig>(EMPTY_CONFIG);
  const [health, setHealth] = useState<GoogleAdsConversionHealth | null>(null);

  const [accounts, setAccounts] = useState<GoogleAdsAccountOption[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountsError, setAccountsError] = useState<string | null>(null);

  const [conversionActions, setConversionActions] = useState<GoogleAdsConversionActionOption[]>([]);
  const [actionsLoading, setActionsLoading] = useState(false);
  const [actionsError, setActionsError] = useState<string | null>(null);

  const [report, setReport] = useState<GoogleAdsPerformanceReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [periodDays, setPeriodDays] = useState('30');

  const origin = useMemo(() => (typeof window !== 'undefined' ? window.location.origin : ''), []);

  const connected = Boolean(config.connected);
  const accountSelected = Boolean(config.customerId);
  const conversionsMapped = Boolean(config.conversionActionWhatsappMessage);
  const destinationsReady = config.destinations.some(
    (destination) => destination.instanceName && destination.phone
  );

  const loadConfig = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const [result, healthResult] = await Promise.all([
        getGoogleAdsIntegrationConfig(workspaceId),
        getGoogleAdsConversionHealth(workspaceId),
      ]);
      if (result.error) {
        toast({ title: 'Erro ao carregar GADS', description: result.error, variant: 'destructive' });
      }
      setInstances(result.instances);
      setConfig(result.config || EMPTY_CONFIG);
      setHealth(healthResult.health);
    } finally {
      setLoading(false);
    }
  }, [toast, workspaceId]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  // Retorno do OAuth do Google chega como parametro na URL.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const connectedParam = params.get('gads_connected');
    const errorParam = params.get('gads_error');
    if (!connectedParam && !errorParam) return;

    if (connectedParam) {
      toast({ title: 'Conta Google Ads conectada', description: 'Agora escolha a conta de anuncios.' });
    } else {
      toast({
        title: 'Nao foi possivel conectar',
        description: `O Google retornou: ${errorParam}`,
        variant: 'destructive',
      });
    }
    window.history.replaceState({}, '', window.location.pathname);
  }, [toast]);

  const loadAccounts = useCallback(async () => {
    if (!workspaceId || !connected) return;
    setAccountsLoading(true);
    setAccountsError(null);
    try {
      const result = await listGoogleAdsAccounts(workspaceId);
      setAccounts(result.accounts);
      if (result.error) setAccountsError(result.error);
    } finally {
      setAccountsLoading(false);
    }
  }, [connected, workspaceId]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  const loadConversionActions = useCallback(async () => {
    if (!workspaceId || !config.customerId) {
      setConversionActions([]);
      return;
    }
    setActionsLoading(true);
    setActionsError(null);
    try {
      const result = await listGoogleAdsConversionActions(
        workspaceId,
        config.customerId,
        config.loginCustomerId
      );
      setConversionActions(result.actions);
      if (result.error) setActionsError(result.error);
    } finally {
      setActionsLoading(false);
    }
  }, [config.customerId, config.loginCustomerId, workspaceId]);

  useEffect(() => {
    void loadConversionActions();
  }, [loadConversionActions]);

  const loadReport = useCallback(async () => {
    if (!workspaceId) return;
    setReportLoading(true);
    setReportError(null);
    try {
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - Number(periodDays));
      const iso = (date: Date) => date.toISOString().slice(0, 10);

      const result = await getGoogleAdsCampaignPerformance(workspaceId, iso(start), iso(end));
      setReport(result.report);
      if (result.error) setReportError(result.error);
    } finally {
      setReportLoading(false);
    }
  }, [periodDays, workspaceId]);

  const updateConfig = <K extends keyof GoogleAdsIntegrationConfig>(
    key: K,
    value: GoogleAdsIntegrationConfig[K]
  ) => {
    setConfig((current) => ({ ...current, [key]: value }));
  };

  const addDestination = () => {
    setConfig((current) => ({
      ...current,
      destinations: [...current.destinations, createEmptyGoogleAdsDestination()],
    }));
  };

  const updateDestination = (id: string, field: keyof GoogleAdsDestination, value: string) => {
    setConfig((current) => ({
      ...current,
      destinations: current.destinations.map((destination) =>
        destination.id === id ? { ...destination, [field]: value } : destination
      ),
    }));
  };

  const removeDestination = (id: string) => {
    setConfig((current) => ({
      ...current,
      destinations: current.destinations.filter((destination) => destination.id !== id),
    }));
  };

  const saveConfig = async () => {
    if (!workspaceId) return;
    setSaving(true);
    try {
      const result = await saveGoogleAdsIntegrationConfig(workspaceId, config);
      if (!result.success) {
        toast({ title: 'Erro ao salvar GADS', description: result.error, variant: 'destructive' });
        return;
      }
      toast({ title: 'GADS configurado' });
      await loadConfig();
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    if (!workspaceId) return;
    const result = await disconnectGoogleAdsAccount(workspaceId);
    if (!result.success) {
      toast({ title: 'Erro ao desconectar', description: result.error, variant: 'destructive' });
      return;
    }
    setAccounts([]);
    setConversionActions([]);
    toast({ title: 'Conta desconectada' });
    await loadConfig();
  };

  const copyTrackingUrl = async (destination: GoogleAdsDestination) => {
    if (!workspaceId) return;
    const trackingUrl = buildTrackingUrl(origin, workspaceId, destination);
    if (!trackingUrl) return;
    await navigator.clipboard.writeText(trackingUrl);
    setCopiedId(destination.id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  if (loading || !workspaceId) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const advertisingAccounts = accounts.filter((account) => !account.isManager);
  const managerAccounts = accounts.filter((account) => account.isManager);

  return (
    <div className="flex min-h-screen flex-col bg-background px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="icon" className="rounded-full">
              <Link href="/integrations">
                <ArrowLeft className="h-5 w-5" />
              </Link>
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-foreground">Google Ads</h1>
                {connected ? (
                  <Badge className="rounded-full bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15">
                    Conectado
                  </Badge>
                ) : (
                  <Badge variant="outline" className="rounded-full">Nao conectado</Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                Rastreie o clique no anuncio ate a venda fechada, e devolva essa conversao ao Google.
              </p>
            </div>
          </div>
          <Button onClick={saveConfig} disabled={saving} className="rounded-full">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Salvar
          </Button>
        </header>

        <StepCard
          step={1}
          title="Conectar a conta do Google"
          description="Autorize o Dialogy pelo Google. Nenhuma credencial precisa ser copiada manualmente."
          done={connected}
        >
          {connected ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <span className="text-foreground">Autorizacao ativa e guardada de forma cifrada.</span>
              </div>
              <Button variant="outline" size="sm" className="rounded-full" onClick={disconnect}>
                <Unplug className="mr-2 h-4 w-4" />
                Desconectar
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-start gap-3">
              <p className="text-sm text-muted-foreground">
                Voce sera levado ao Google para autorizar o acesso a sua conta de anuncios. O Dialogy usa esse
                acesso para listar suas contas, ler o custo das campanhas e enviar conversoes.
              </p>
              <Button asChild className="rounded-full">
                <a href="/api/integrations/google-ads/auth">
                  <Link2 className="mr-2 h-4 w-4" />
                  Conectar com o Google
                </a>
              </Button>
            </div>
          )}
        </StepCard>

        <StepCard
          step={2}
          title="Escolher a conta de anuncios"
          description="A conta onde as campanhas rodam e para onde as conversoes serao enviadas."
          done={accountSelected}
          disabled={!connected}
        >
          {!connected ? (
            <p className="text-sm text-muted-foreground">Conclua o passo 1 para listar suas contas.</p>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Conta de anuncios</Label>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 rounded-full text-xs"
                      onClick={loadAccounts}
                      disabled={accountsLoading}
                    >
                      <RefreshCw className={`mr-1.5 h-3 w-3 ${accountsLoading ? 'animate-spin' : ''}`} />
                      Atualizar
                    </Button>
                  </div>
                  <Select
                    value={config.customerId || undefined}
                    onValueChange={(value) => updateConfig('customerId', value)}
                    disabled={accountsLoading || advertisingAccounts.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={accountsLoading ? 'Carregando...' : 'Selecione a conta'} />
                    </SelectTrigger>
                    <SelectContent>
                      {advertisingAccounts.map((account) => (
                        <SelectItem key={account.customerId} value={account.customerId}>
                          {account.descriptiveName} · {account.customerId}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Conta gerenciadora (MCC)</Label>
                  <Select
                    value={config.loginCustomerId || 'none'}
                    onValueChange={(value) => updateConfig('loginCustomerId', value === 'none' ? '' : value)}
                    disabled={accountsLoading}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Nenhuma" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Nenhuma</SelectItem>
                      {managerAccounts.map((account) => (
                        <SelectItem key={account.customerId} value={account.customerId}>
                          {account.descriptiveName} · {account.customerId}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Preencha apenas se a conta acima estiver sob um gerenciador.
                  </p>
                </div>
              </div>

              {accountsError && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <div className="space-y-2">
                    <p className="text-muted-foreground">{accountsError}</p>
                    <div className="space-y-1">
                      <Label className="text-xs">Informar o Customer ID manualmente</Label>
                      <Input
                        value={config.customerId}
                        onChange={(event) => updateConfig('customerId', event.target.value)}
                        placeholder="Ex: 1234567890"
                        className="h-8"
                      />
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </StepCard>

        <StepCard
          step={3}
          title="Mapear as conversoes"
          description="Escolha qual acao de conversao do Google recebe cada evento do Dialogy."
          done={conversionsMapped}
          disabled={!accountSelected}
        >
          {!accountSelected ? (
            <p className="text-sm text-muted-foreground">Escolha a conta no passo 2 para listar as conversoes.</p>
          ) : (
            <>
              <div className="flex items-center justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-full text-xs"
                  onClick={loadConversionActions}
                  disabled={actionsLoading}
                >
                  <RefreshCw className={`mr-1.5 h-3 w-3 ${actionsLoading ? 'animate-spin' : ''}`} />
                  Atualizar
                </Button>
              </div>

              {CONVERSION_SLOTS.map((slot) => (
                <div key={slot.key} className="grid gap-2 rounded-lg border bg-muted/10 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Label className="text-sm font-medium">{slot.title}</Label>
                    {slot.required ? (
                      <Badge variant="outline" className="rounded-full text-[10px]">Obrigatoria</Badge>
                    ) : (
                      <Badge variant="outline" className="rounded-full text-[10px]">Recomendada</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{slot.hint}</p>
                  <Select
                    value={config[slot.key] || 'none'}
                    onValueChange={(value) => updateConfig(slot.key, value === 'none' ? '' : value)}
                    disabled={actionsLoading || conversionActions.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={actionsLoading ? 'Carregando...' : 'Nao enviar este evento'} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Nao enviar este evento</SelectItem>
                      {conversionActions.map((action) => (
                        <SelectItem key={action.resourceName} value={action.resourceName}>
                          {action.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {conversionActions.length === 0 && !actionsLoading && (
                    <Input
                      value={config[slot.key]}
                      onChange={(event) => updateConfig(slot.key, event.target.value)}
                      placeholder="Ou cole o ID da acao de conversao"
                      className="h-8"
                    />
                  )}
                </div>
              ))}

              {actionsError && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <p className="text-muted-foreground">{actionsError}</p>
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="consentAdUserData">Consentimento: dados do usuario</Label>
                  <Select
                    value={config.consentAdUserData || 'unset'}
                    onValueChange={(value) =>
                      updateConfig('consentAdUserData', value === 'unset' ? '' : (value as 'GRANTED' | 'DENIED'))
                    }
                  >
                    <SelectTrigger id="consentAdUserData">
                      <SelectValue placeholder="Nao declarar" />
                    </SelectTrigger>
                    <SelectContent>
                      {CONSENT_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="consentAdPersonalization">Consentimento: personalizacao</Label>
                  <Select
                    value={config.consentAdPersonalization || 'unset'}
                    onValueChange={(value) =>
                      updateConfig(
                        'consentAdPersonalization',
                        value === 'unset' ? '' : (value as 'GRANTED' | 'DENIED')
                      )
                    }
                  >
                    <SelectTrigger id="consentAdPersonalization">
                      <SelectValue placeholder="Nao declarar" />
                    </SelectTrigger>
                    <SelectContent>
                      {CONSENT_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                O consentimento so e enviado ao Google quando declarado aqui. Deixe em &quot;Nao declarar&quot; se a
                sua politica de privacidade ainda nao cobre o compartilhamento desses dados.
              </p>
            </>
          )}
        </StepCard>

        <StepCard
          step={4}
          title="Criar os links dos anuncios"
          description="Um destino por campanha ou numero. Cole a URL gerada no campo de URL final do anuncio."
          done={destinationsReady}
          disabled={!connected}
        >
          {config.destinations.length === 0 ? (
            <div className="flex min-h-40 flex-col items-center justify-center gap-4 rounded-lg border border-dashed text-center">
              <div>
                <h2 className="text-base font-semibold text-foreground">Nenhum destino configurado</h2>
                <p className="text-sm text-muted-foreground">
                  Crie um card para cada campanha, numero ou operacao de atendimento.
                </p>
              </div>
              <Button onClick={addDestination} className="rounded-full">
                <Plus className="mr-2 h-4 w-4" />
                Criar primeiro destino
              </Button>
            </div>
          ) : (
            <>
              {config.destinations.map((destination, index) => {
                const trackingUrl = buildTrackingUrl(origin, workspaceId, destination);
                return (
                  <div key={destination.id} className="overflow-hidden rounded-xl border">
                    <div className="flex items-start justify-between gap-3 border-b bg-muted/20 p-4">
                      <div>
                        <p className="font-medium text-foreground">{destination.name || `Destino ${index + 1}`}</p>
                        <p className="text-xs text-muted-foreground">{destination.slug || 'slug-pendente'}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="rounded-full text-muted-foreground hover:text-destructive"
                        onClick={() => removeDestination(destination.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="grid gap-4 p-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label>Nome do destino</Label>
                          <Input
                            value={destination.name}
                            onChange={(event) => updateDestination(destination.id, 'name', event.target.value)}
                            placeholder="Ex: PMAX Palmas"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Slug da URL</Label>
                          <Input
                            value={destination.slug}
                            onChange={(event) => updateDestination(destination.id, 'slug', event.target.value)}
                            placeholder="pmax-palmas"
                          />
                        </div>
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label>Instancia Evolution</Label>
                          <Select
                            value={destination.instanceName || undefined}
                            onValueChange={(value) => updateDestination(destination.id, 'instanceName', value)}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Selecione uma instancia" />
                            </SelectTrigger>
                            <SelectContent>
                              {instances.map((instance) => (
                                <SelectItem key={instance.instanceName} value={instance.instanceName}>
                                  {(instance.displayName || instance.instanceName)} - {instance.instanceName}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>WhatsApp de destino</Label>
                          <Input
                            value={destination.phone}
                            onChange={(event) => updateDestination(destination.id, 'phone', event.target.value)}
                            placeholder="Ex: 556338104040"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Mensagem inicial</Label>
                        <Textarea
                          value={destination.defaultMessage}
                          onChange={(event) => updateDestination(destination.id, 'defaultMessage', event.target.value)}
                          className="min-h-20"
                        />
                        <p className="text-xs text-muted-foreground">
                          O codigo de rastreio e acrescentado automaticamente. Se o lead apagar, o sistema ainda
                          casa a conversa pelo clique recente.
                        </p>
                      </div>
                      <div className="grid gap-3">
                        <Label>URL do anuncio</Label>
                        <div className="rounded-xl border bg-muted/30 p-3">
                          <p className="break-all font-mono text-xs leading-relaxed text-foreground">
                            {trackingUrl || 'Preencha instancia e slug para gerar a URL.'}
                          </p>
                        </div>
                        <Button
                          onClick={() => copyTrackingUrl(destination)}
                          disabled={!trackingUrl}
                          variant="outline"
                          className="w-fit rounded-full"
                        >
                          {copiedId === destination.id ? (
                            <Check className="mr-2 h-4 w-4" />
                          ) : (
                            <Copy className="mr-2 h-4 w-4" />
                          )}
                          {copiedId === destination.id ? 'Copiado' : 'Copiar URL'}
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
              <Button onClick={addDestination} variant="outline" className="w-fit rounded-full">
                <Plus className="mr-2 h-4 w-4" />
                Adicionar destino
              </Button>
            </>
          )}
        </StepCard>

        {health && (
          <Card>
            <CardHeader>
              <CardTitle>Saude das conversoes</CardTitle>
              <CardDescription>
                O worker drena a fila automaticamente. Se algo aqui parar de andar, as conversoes deixaram de
                chegar ao Google Ads.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {([
                  ['Enviadas', health.counts.sent, 'text-emerald-600'],
                  ['Na fila', health.counts.pending, 'text-foreground'],
                  ['Em envio', health.counts.processing, 'text-foreground'],
                  ['Repetindo', health.counts.failed, 'text-amber-600'],
                  ['Descartadas', health.counts.dead, 'text-destructive'],
                ] as const).map(([label, value, tone]) => (
                  <div key={label} className="rounded-lg border bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className={`text-2xl font-semibold ${tone}`}>{value}</p>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                <span>
                  Ultima conversao enviada:{' '}
                  <strong className="text-foreground">
                    {health.lastSentAt ? new Date(health.lastSentAt).toLocaleString('pt-BR') : 'nenhuma ainda'}
                  </strong>
                </span>
                <span>
                  Atribuicoes: <strong className="text-foreground">{health.attributedContacts.deterministic}</strong>{' '}
                  por codigo,{' '}
                  <strong className="text-foreground">{health.attributedContacts.probabilistic}</strong> por
                  proximidade
                </span>
              </div>

              {health.recentFailures.length > 0 && (
                <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                  <p className="text-sm font-medium text-destructive">Ultimas falhas</p>
                  {health.recentFailures.map((failure, index) => (
                    <div key={`${failure.eventName}-${index}`} className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{failure.eventName}</span>
                      {' · '}
                      {new Date(failure.updatedAt).toLocaleString('pt-BR')}
                      {' · '}
                      tentativa {failure.attemptCount}
                      <p className="mt-0.5 break-all font-mono">{failure.errorMessage}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Custo, CAC e ROAS por campanha</CardTitle>
                <CardDescription>
                  O custo vem do Google Ads. A receita vem dos negócios ganhos no CRM, atribuídos ao anúncio
                  que originou a conversa.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Select value={periodDays} onValueChange={setPeriodDays}>
                  <SelectTrigger className="h-8 w-[130px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">Últimos 7 dias</SelectItem>
                    <SelectItem value="30">Últimos 30 dias</SelectItem>
                    <SelectItem value="90">Últimos 90 dias</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-full"
                  onClick={loadReport}
                  disabled={reportLoading}
                >
                  {reportLoading ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <BarChart3 className="mr-2 h-3.5 w-3.5" />
                  )}
                  {report ? 'Atualizar' : 'Carregar'}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4">
            {!report && !reportLoading && !reportError && (
              <p className="text-sm text-muted-foreground">
                Clique em Carregar para consultar o Google Ads e cruzar com o seu CRM.
              </p>
            )}

            {reportError && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <p className="text-muted-foreground">{reportError}</p>
              </div>
            )}

            {report && (
              <>
                {report.costUnavailableReason && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <p className="text-muted-foreground">
                      Custo indisponível: {report.costUnavailableReason} O funil abaixo continua válido.
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">Investido</p>
                    <p className="text-xl font-semibold">{formatMoney(report.totals.cost, report.currencyCode)}</p>
                  </div>
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">Receita atribuída</p>
                    <p className="text-xl font-semibold text-emerald-600">
                      {formatMoney(report.totals.revenue, report.currencyCode)}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">CAC</p>
                    <p className="text-xl font-semibold">
                      {report.totals.costPerAcquisition === null
                        ? '—'
                        : formatMoney(report.totals.costPerAcquisition, report.currencyCode)}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">ROAS</p>
                    <p
                      className={`text-xl font-semibold ${
                        report.totals.roas === null
                          ? ''
                          : report.totals.roas >= 1
                            ? 'text-emerald-600'
                            : 'text-destructive'
                      }`}
                    >
                      {report.totals.roas === null ? '—' : `${report.totals.roas.toFixed(2)}x`}
                    </p>
                  </div>
                </div>

                {report.rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nenhuma campanha com clique rastreado ou custo no período.
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full min-w-[720px] text-sm">
                      <thead className="bg-muted/40 text-xs text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">Campanha</th>
                          <th className="px-3 py-2 text-right font-medium">Investido</th>
                          <th className="px-3 py-2 text-right font-medium">Conversas</th>
                          <th className="px-3 py-2 text-right font-medium">Vendas</th>
                          <th className="px-3 py-2 text-right font-medium">Receita</th>
                          <th className="px-3 py-2 text-right font-medium">CAC</th>
                          <th className="px-3 py-2 text-right font-medium">ROAS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.rows.map((row) => (
                          <tr key={row.campaignId} className="border-t">
                            <td className="max-w-[220px] truncate px-3 py-2" title={row.campaignName}>
                              {row.campaignName}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {formatMoney(row.cost, report.currencyCode)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">{row.conversations}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{row.wonDeals}</td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {formatMoney(row.revenue, report.currencyCode)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {row.costPerAcquisition === null
                                ? '—'
                                : formatMoney(row.costPerAcquisition, report.currencyCode)}
                            </td>
                            <td
                              className={`px-3 py-2 text-right tabular-nums ${
                                row.roas === null ? '' : row.roas >= 1 ? 'text-emerald-600' : 'text-destructive'
                              }`}
                            >
                              {row.roas === null ? '—' : `${row.roas.toFixed(2)}x`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card className="border-dashed">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <p className="text-sm text-muted-foreground">
              Guia completo com validacao passo a passo e referencias oficiais do Google.
            </p>
            <Button asChild variant="outline" size="sm" className="rounded-full">
              <Link href="/developer/docs/google-ads-whatsapp">
                <ExternalLink className="mr-2 h-4 w-4" />
                Abrir documentacao
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
