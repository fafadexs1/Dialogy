'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  BarChart3,
  BookOpen,
  Check,
  CheckCircle2,
  Code2,
  Copy,
  Edit2,
  ExternalLink,
  Info,
  Link2,
  Loader2,
  Phone,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Sparkles,
  Target,
  Trash2,
  Unplug,
  Zap,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useCurrentUser } from '@/hooks/use-online-status';

type EvolutionInstanceOption = {
  instanceName: string;
  displayName: string | null;
  type: string | null;
};

const CONVERSION_SLOTS = [
  {
    key: 'conversionActionWhatsappMessage' as const,
    title: 'Mensagem recebida',
    hint: 'Dispara quando o lead manda a primeira mensagem no WhatsApp vindo de um anúncio.',
    required: true,
    tag: 'Secundária / Topo de Funil',
    color: 'text-blue-500 border-blue-500/30 bg-blue-500/10',
  },
  {
    key: 'conversionActionLeadQualified' as const,
    title: 'Lead qualificado',
    hint: 'Dispara quando o lead avança do primeiro estágio no CRM.',
    required: false,
    tag: 'Meio de Funil',
    color: 'text-amber-500 border-amber-500/30 bg-amber-500/10',
  },
  {
    key: 'conversionActionSaleWon' as const,
    title: 'Cliente Instalado / Venda fechada',
    hint: 'Dispara quando um negócio é marcado como Ganho no CRM com o valor financeiro real.',
    required: false,
    tag: 'Primária / Foco em ROAS',
    color: 'text-emerald-500 border-emerald-500/30 bg-emerald-500/10',
  },
] as const;

const EMPTY_CONFIG: GoogleAdsIntegrationConfig = {
  customerId: '',
  loginCustomerId: '',
  refreshToken: '',
  conversionActionWhatsappMessage: '',
  conversionActionLeadQualified: '',
  conversionActionSaleWon: '',
  consentAdUserData: '',
  consentAdPersonalization: '',
  destinations: [],
  connected: false,
};

function slugify(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
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

  const [activeTab, setActiveTab] = useState('links');

  // Estado para Modal de Criação / Edição de Destino
  const [editingDestination, setEditingDestination] = useState<GoogleAdsDestination | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [selectedScriptDestination, setSelectedScriptDestination] = useState<GoogleAdsDestination | null>(null);

  const origin = useMemo(() => (typeof window !== 'undefined' ? window.location.origin : ''), []);

  const connected = Boolean(config.connected);
  const accountSelected = Boolean(config.customerId);
  const conversionsMapped = Boolean(config.conversionActionWhatsappMessage);

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

      if (!result.config?.connected) {
        setActiveTab('account');
      }
    } finally {
      setLoading(false);
    }
  }, [toast, workspaceId]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const connectedParam = params.get('gads_connected');
    const errorParam = params.get('gads_error');
    if (!connectedParam && !errorParam) return;

    if (connectedParam) {
      toast({ title: 'Conta Google Ads conectada com sucesso!', description: 'Agora escolha a conta de anúncios.' });
      setActiveTab('account');
    } else {
      toast({
        title: 'Não foi possível conectar',
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
      if (result.error) setReportError(result.error);
      setReport(result.report);
    } finally {
      setReportLoading(false);
    }
  }, [periodDays, workspaceId]);

  const updateConfig = <K extends keyof GoogleAdsIntegrationConfig>(
    key: K,
    value: GoogleAdsIntegrationConfig[K]
  ) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const openNewDestinationModal = () => {
    const index = config.destinations.length + 1;
    const name = `Campanha ${index}`;
    const slug = slugify(name);
    const id = Math.random().toString(36).slice(2, 10);
    setEditingDestination({
      id,
      name,
      slug: slug || id,
      instanceName: instances[0]?.instanceName || '',
      phone: '',
      defaultMessage: 'Olá! Vim pelo anúncio e gostaria de saber mais.',
    });
    setIsCreatingNew(true);
  };

  const openEditDestinationModal = (dest: GoogleAdsDestination) => {
    setEditingDestination({ ...dest });
    setIsCreatingNew(false);
  };

  const saveDestinationModal = async () => {
    if (!editingDestination || !workspaceId) return;
    if (!editingDestination.name.trim()) {
      toast({ title: 'Nome obrigatório', description: 'Dê um nome para a campanha/destino.', variant: 'destructive' });
      return;
    }
    if (!editingDestination.slug.trim()) {
      toast({ title: 'Slug obrigatório', description: 'Defina um slug para o link.', variant: 'destructive' });
      return;
    }

    const currentSlug = slugify(editingDestination.slug);
    const sanitizedDest: GoogleAdsDestination = {
      ...editingDestination,
      slug: currentSlug,
      phone: editingDestination.phone.replace(/\D/g, ''),
    };

    let newDestinations: GoogleAdsDestination[];
    if (isCreatingNew) {
      newDestinations = [...config.destinations, sanitizedDest];
    } else {
      newDestinations = config.destinations.map((d) => (d.id === sanitizedDest.id ? sanitizedDest : d));
    }

    const newConfig = { ...config, destinations: newDestinations };
    setConfig(newConfig);
    setEditingDestination(null);

    setSaving(true);
    try {
      const result = await saveGoogleAdsIntegrationConfig(workspaceId, newConfig);
      if (result.error) {
        toast({ title: 'Erro ao salvar destino', description: result.error, variant: 'destructive' });
        return;
      }
      toast({
        title: isCreatingNew ? 'Destino criado e salvo!' : 'Destino atualizado com sucesso!',
        description: 'O link de rastreamento já está pronto para uso.',
      });
      await loadConfig();
    } finally {
      setSaving(false);
    }
  };

  const removeDestination = async (id: string) => {
    if (!workspaceId) return;
    if (!confirm('Deseja excluir este destino de anúncio?')) return;

    const newDestinations = config.destinations.filter((d) => d.id !== id);
    const newConfig = { ...config, destinations: newDestinations };
    setConfig(newConfig);

    setSaving(true);
    try {
      const result = await saveGoogleAdsIntegrationConfig(workspaceId, newConfig);
      if (result.error) {
        toast({ title: 'Erro ao remover', description: result.error, variant: 'destructive' });
        return;
      }
      toast({ title: 'Destino removido com sucesso' });
      await loadConfig();
    } finally {
      setSaving(false);
    }
  };

  const saveConfig = async () => {
    if (!workspaceId) return;
    setSaving(true);
    try {
      const result = await saveGoogleAdsIntegrationConfig(workspaceId, config);
      if (result.error) {
        toast({ title: 'Erro ao salvar configurações', description: result.error, variant: 'destructive' });
        return;
      }
      toast({
        title: 'Configurações salvas com sucesso!',
        description: 'Os dados foram gravados no sistema.',
      });
      await loadConfig();
    } finally {
      setSaving(false);
    }
  };

  const copyTrackingUrl = async (destination: GoogleAdsDestination) => {
    const url = buildTrackingUrl(origin, workspaceId || '', destination);
    if (!url) {
      toast({
        title: 'URL Incompleta',
        description: 'Selecione a instância do WhatsApp e preencha o slug para gerar a URL.',
        variant: 'destructive',
      });
      return;
    }
    await navigator.clipboard.writeText(url);
    setCopiedId(destination.id);
    toast({
      title: 'URL copiada para a área de transferência!',
      description: 'Cole esta URL no campo "URL Final" do anúncio no Google Ads.',
    });
    setTimeout(() => setCopiedId(null), 2500);
  };

  const disconnect = async () => {
    if (!workspaceId) return;
    if (!confirm('Deseja realmente desconectar a conta do Google Ads?')) return;
    const result = await disconnectGoogleAdsAccount(workspaceId);
    if (result.error) {
      toast({ title: 'Erro ao desconectar', description: result.error, variant: 'destructive' });
      return;
    }
    toast({ title: 'Conta do Google Ads desconectada' });
    await loadConfig();
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        <p className="text-base text-muted-foreground font-medium">Carregando integração com o Google Ads...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="mx-auto max-w-6xl space-y-6 px-4 sm:px-6 pt-6">
        {/* Top Header */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Link
              href="/developer"
              className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              Voltar ao Developer Hub
            </Link>

            <div className="flex items-center gap-3">
              <Button asChild variant="outline" size="sm" className="rounded-full h-9 px-4 text-sm font-medium">
                <Link href="/developer/docs/conversions">
                  <BookOpen className="mr-2 h-4 w-4 text-blue-500" />
                  Tutorial Passo a Passo
                </Link>
              </Button>
              <Button onClick={saveConfig} disabled={saving} size="sm" className="rounded-full h-9 px-5 text-sm font-medium shadow-sm">
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Salvar Tudo
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-5">
            <div className="space-y-1.5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
                  <Target className="h-6 w-6" />
                </div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">Google Ads + WhatsApp</h1>
                {connected ? (
                  <Badge className="bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15 border-0 font-medium text-xs px-2.5 py-0.5">
                    Conectado
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground text-xs px-2.5 py-0.5">Não conectado</Badge>
                )}
              </div>
              <p className="text-sm sm:text-base text-muted-foreground leading-relaxed max-w-3xl">
                Rastreamento de cliques (GCLID), casamentos determinísticos no WhatsApp e retorno de conversões offline para o Google Ads.
              </p>
            </div>
          </div>
        </div>

        {/* LAYOUT: MENU VERTICAL NA ESQUERDA + CONTEÚDO NA DIREITA */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="flex flex-col lg:flex-row items-start gap-6">
            
            {/* MENU VERTICAL LATERAL NA ESQUERDA */}
            <div className="w-full lg:w-72 shrink-0 space-y-4 lg:sticky lg:top-6">
              <Card className="border-border/60 shadow-sm overflow-hidden p-2.5">
                <div className="px-3.5 py-2.5 border-b mb-1.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Navegação GADS</span>
                </div>
                <TabsList className="flex flex-col h-auto bg-transparent p-0 gap-1.5 w-full">
                  <TabsTrigger
                    value="links"
                    className="w-full justify-start px-3.5 py-3 rounded-xl text-sm font-semibold data-[state=active]:bg-muted data-[state=active]:text-foreground transition-all flex items-center gap-2.5"
                  >
                    <Link2 className="h-4 w-4 text-blue-500 shrink-0" />
                    <span className="flex-1 text-left">Links & Slugs</span>
                    {config.destinations.length > 0 && (
                      <Badge variant="secondary" className="h-5 px-2 text-xs rounded-full font-mono">
                        {config.destinations.length}
                      </Badge>
                    )}
                  </TabsTrigger>

                  <TabsTrigger
                    value="conversions"
                    className="w-full justify-start px-3.5 py-3 rounded-xl text-sm font-semibold data-[state=active]:bg-muted data-[state=active]:text-foreground transition-all flex items-center gap-2.5"
                  >
                    <Target className="h-4 w-4 text-amber-500 shrink-0" />
                    <span className="flex-1 text-left">Conversões</span>
                    {conversionsMapped && (
                      <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                    )}
                  </TabsTrigger>

                  <TabsTrigger
                    value="account"
                    className="w-full justify-start px-3.5 py-3 rounded-xl text-sm font-semibold data-[state=active]:bg-muted data-[state=active]:text-foreground transition-all flex items-center gap-2.5"
                  >
                    <Settings2 className="h-4 w-4 text-slate-500 shrink-0" />
                    <span className="flex-1 text-left">Conta & Acesso</span>
                  </TabsTrigger>

                  <TabsTrigger
                    value="roas"
                    className="w-full justify-start px-3.5 py-3 rounded-xl text-sm font-semibold data-[state=active]:bg-muted data-[state=active]:text-foreground transition-all flex items-center gap-2.5"
                  >
                    <BarChart3 className="h-4 w-4 text-emerald-500 shrink-0" />
                    <span className="flex-1 text-left">Relatório & ROAS</span>
                  </TabsTrigger>

                  <TabsTrigger
                    value="health"
                    className="w-full justify-start px-3.5 py-3 rounded-xl text-sm font-semibold data-[state=active]:bg-muted data-[state=active]:text-foreground transition-all flex items-center gap-2.5"
                  >
                    <Activity className="h-4 w-4 text-purple-500 shrink-0" />
                    <span className="flex-1 text-left">Diagnósticos</span>
                  </TabsTrigger>
                </TabsList>

                {/* Resumo de Status Rápido no Menu */}
                <div className="mt-3.5 pt-3.5 border-t px-3.5 pb-2 space-y-2.5 text-xs text-muted-foreground">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">Google OAuth:</span>
                    <strong className={connected ? 'text-emerald-600 font-semibold' : 'text-amber-600 font-semibold'}>
                      {connected ? 'Conectado' : 'Pendente'}
                    </strong>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-medium">Conta Anúncios:</span>
                    <strong className="text-foreground font-mono truncate max-w-[110px]" title={config.customerId || 'Não selecionada'}>
                      {config.customerId || '—'}
                    </strong>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-medium">Destinos Ativos:</span>
                    <strong className="text-foreground font-semibold">{config.destinations.length}</strong>
                  </div>
                </div>
              </Card>

              {/* Card de Atalho para o Tutorial */}
              <Card className="border-blue-500/20 bg-blue-500/5 shadow-sm p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-blue-600 dark:text-blue-400">
                  <Sparkles className="h-4 w-4" />
                  Guia de Conversões
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Aprenda como configurar o Data Manager e registrar vendas no CRM com valor em R$.
                </p>
                <Button asChild variant="outline" size="sm" className="w-full rounded-full text-xs h-8 border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-500/10 font-medium">
                  <Link href="/developer/docs/conversions">
                    Abrir Tutorial
                    <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                  </Link>
                </Button>
              </Card>
            </div>

            {/* CONTEÚDO PRINCIPAL (DIREITA) */}
            <div className="flex-1 w-full min-w-0">
              
              {/* ========================================================================= */}
              {/* TAB 1: LINKS & SLUGS (GRID DE CARDS SEPARADOS)                            */}
              {/* ========================================================================= */}
              <TabsContent value="links" className="space-y-6 m-0 focus-visible:outline-none">
                <div className="space-y-4">
                  {/* Cabeçalho da Seção de Links */}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-lg sm:text-xl font-bold text-foreground flex items-center gap-2">
                        <Link2 className="h-5 w-5 text-blue-500" />
                        Links de Rastreamento (Destinos & Slugs)
                      </h2>
                      <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">
                        Cada card representa um link parametrizado para usar no <strong>Google Ads</strong> ou nos <strong>botões do seu site</strong>.
                      </p>
                    </div>

                    <Button onClick={openNewDestinationModal} size="sm" className="rounded-full h-9 px-4 text-sm font-medium shadow-sm">
                      <Plus className="mr-1.5 h-4 w-4" />
                      Criar Novo Destino
                    </Button>
                  </div>

                  {/* GRID INVISÍVEL DE CARDS SEPARADOS */}
                  {config.destinations.length === 0 ? (
                    <div className="flex min-h-60 flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-border/80 bg-muted/10 p-8 text-center">
                      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-500">
                        <Link2 className="h-7 w-7" />
                      </div>
                      <div className="space-y-1.5">
                        <h3 className="text-base sm:text-lg font-bold text-foreground">Nenhum destino criado ainda</h3>
                        <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
                          Crie um card para gerar o link que captura o GCLID e direciona para o seu WhatsApp com a mensagem codificada.
                        </p>
                      </div>
                      <Button onClick={openNewDestinationModal} className="rounded-full shadow-sm text-sm h-10 px-5">
                        <Plus className="mr-2 h-4 w-4" />
                        Criar Primeiro Destino
                      </Button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {config.destinations.map((destination, index) => {
                        const trackingUrl = buildTrackingUrl(origin, workspaceId || '', destination);
                        const isComplete = Boolean(destination.instanceName && destination.phone && destination.slug);

                        return (
                          <Card
                            key={destination.id}
                            className="border-border/60 shadow-sm hover:border-blue-500/40 transition-all duration-200 flex flex-col justify-between overflow-hidden bg-card"
                          >
                            <CardHeader className="p-4 pb-3.5 border-b bg-muted/20">
                              <div className="flex items-start justify-between gap-3">
                                <div className="space-y-1.5 min-w-0">
                                  <h3 className="font-bold text-base text-foreground truncate" title={destination.name}>
                                    {destination.name}
                                  </h3>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <Badge variant="outline" className="text-xs font-mono text-blue-500 border-blue-500/30 px-2 py-0.5">
                                      dest: {destination.slug}
                                    </Badge>
                                    {isComplete ? (
                                      <Badge className="bg-emerald-500/15 text-emerald-600 border-0 text-xs font-medium px-2 py-0.5">
                                        Pronto
                                      </Badge>
                                    ) : (
                                      <Badge variant="outline" className="text-amber-600 border-amber-500/30 text-xs px-2 py-0.5">
                                        Incompleto
                                      </Badge>
                                    )}
                                  </div>
                                </div>

                                <div className="flex items-center gap-1">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted"
                                    onClick={() => openEditDestinationModal(destination)}
                                    title="Editar destino"
                                  >
                                    <Edit2 className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                    onClick={() => removeDestination(destination.id)}
                                    title="Excluir destino"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                            </CardHeader>

                            <CardContent className="p-4 space-y-4 flex-1 flex flex-col justify-between">
                              {/* Metadados do WhatsApp */}
                              <div className="space-y-2 text-sm">
                                <div className="flex items-center justify-between text-muted-foreground">
                                  <span className="font-medium">WhatsApp:</span>
                                  <strong className="text-foreground font-mono text-sm">
                                    {destination.phone || 'Não configurado'}
                                  </strong>
                                </div>
                                <div className="flex items-center justify-between text-muted-foreground">
                                  <span className="font-medium">Instância:</span>
                                  <span className="text-foreground font-medium truncate max-w-[160px]">
                                    {destination.instanceName || 'Não selecionada'}
                                  </span>
                                </div>
                              </div>

                              {/* Caixa da URL */}
                              <div className="rounded-xl border bg-muted/40 p-3 space-y-1.5">
                                <div className="flex items-center justify-between text-xs text-muted-foreground font-medium">
                                  <span>URL Final do Anúncio:</span>
                                  {trackingUrl && <span className="text-emerald-600 font-semibold">GCLID incluso</span>}
                                </div>
                                <p className="font-mono text-xs text-foreground/90 break-all line-clamp-2 select-all leading-relaxed">
                                  {trackingUrl || 'Preencha instância e telefone para gerar.'}
                                </p>
                              </div>

                              {/* Botões de Ação do Card */}
                              <div className="flex flex-wrap items-center gap-2 pt-1">
                                <Button
                                  onClick={() => copyTrackingUrl(destination)}
                                  disabled={!trackingUrl}
                                  size="sm"
                                  className="flex-1 rounded-full text-xs font-semibold h-8 shadow-sm"
                                >
                                  {copiedId === destination.id ? (
                                    <Check className="mr-1.5 h-3.5 w-3.5 text-white" />
                                  ) : (
                                    <Copy className="mr-1.5 h-3.5 w-3.5" />
                                  )}
                                  {copiedId === destination.id ? 'Copiado!' : 'Copiar URL'}
                                </Button>

                                {trackingUrl && (
                                  <>
                                    <Button
                                      asChild
                                      variant="outline"
                                      size="sm"
                                      className="rounded-full text-xs h-8 px-3"
                                      title="Testar redirecionamento em nova aba"
                                    >
                                      <a href={trackingUrl} target="_blank" rel="noopener noreferrer">
                                        <ExternalLink className="h-3.5 w-3.5" />
                                      </a>
                                    </Button>

                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="rounded-full text-xs h-8 px-3 text-purple-600 dark:text-purple-400 font-medium"
                                      onClick={() => setSelectedScriptDestination(destination)}
                                      title="Gerar script para botão do site"
                                    >
                                      <Code2 className="h-3.5 w-3.5 mr-1" />
                                      Site
                                    </Button>
                                  </>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}

                      {/* Card de Adicionar Novo Destino no Grid */}
                      <button
                        onClick={openNewDestinationModal}
                        className="flex min-h-48 flex-col items-center justify-center gap-2.5 rounded-2xl border-2 border-dashed border-border hover:border-blue-500/50 bg-muted/5 hover:bg-muted/15 transition-all p-6 text-center group cursor-pointer"
                      >
                        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted group-hover:bg-blue-500/10 group-hover:text-blue-500 transition-colors">
                          <Plus className="h-6 w-6" />
                        </div>
                        <div>
                          <p className="text-base font-bold text-foreground group-hover:text-blue-500 transition-colors">
                            Adicionar Novo Destino
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Crie um link para outra campanha ou número
                          </p>
                        </div>
                      </button>
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* ========================================================================= */}
              {/* TAB 2: MAPEAMENTO DE CONVERSÕES                                           */}
              {/* ========================================================================= */}
              <TabsContent value="conversions" className="space-y-6 m-0 focus-visible:outline-none">
                <Card className="border-border/60 shadow-sm">
                  <CardHeader className="pb-4">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <CardTitle className="text-lg sm:text-xl font-bold flex items-center gap-2">
                          <Target className="h-5 w-5 text-amber-500" />
                          Mapeamento das Ações de Conversão
                        </CardTitle>
                        <CardDescription className="text-sm text-muted-foreground mt-1 leading-relaxed">
                          Vincule os eventos do funil às ações de conversão criadas na sua conta do Google Ads.
                        </CardDescription>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9 rounded-full text-xs font-medium"
                        onClick={loadConversionActions}
                        disabled={actionsLoading || !config.customerId}
                      >
                        <RefreshCw className={`mr-2 h-3.5 w-3.5 ${actionsLoading ? 'animate-spin' : ''}`} />
                        Atualizar Ações da Conta
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-6 pt-0">
                    {!accountSelected ? (
                      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-muted-foreground flex items-center gap-3">
                        <AlertCircle className="h-5 w-5 text-amber-600 shrink-0" />
                        <div>
                          <p className="font-semibold text-foreground">Conta do Google Ads não selecionada</p>
                          <p className="text-xs mt-0.5">Acesse a aba <strong>Conta & Acesso</strong> para escolher a conta de anúncios antes de mapear conversões.</p>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-5">
                        <div className="grid gap-4">
                          {CONVERSION_SLOTS.map((slot) => (
                            <div key={slot.key} className="rounded-2xl border bg-muted/10 p-5 space-y-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2.5">
                                  <Label className="text-base font-bold">{slot.title}</Label>
                                  <Badge variant="outline" className={`text-xs font-semibold px-2.5 py-0.5 ${slot.color}`}>
                                    {slot.tag}
                                  </Badge>
                                </div>
                                {config[slot.key] && (
                                  <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
                                    <Check className="h-4 w-4" /> Ação Vinculada
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground leading-relaxed">{slot.hint}</p>

                              <Select
                                value={config[slot.key] || 'none'}
                                onValueChange={(value) => updateConfig(slot.key, value === 'none' ? '' : value)}
                                disabled={actionsLoading || conversionActions.length === 0}
                              >
                                <SelectTrigger className="h-11 text-sm bg-background">
                                  <SelectValue placeholder={actionsLoading ? 'Carregando ações...' : 'Não enviar este evento'} />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none" className="text-sm">Não enviar este evento</SelectItem>
                                  {conversionActions.map((action) => (
                                    <SelectItem key={action.resourceName} value={action.resourceName} className="text-sm">
                                      {action.name} (ID: {action.resourceName.split('/').pop()})
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          ))}
                        </div>

                        <div className="flex justify-end pt-2 border-t">
                          <Button onClick={saveConfig} disabled={saving} size="sm" className="rounded-full h-9 px-5 font-semibold text-sm shadow-sm">
                            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                            Salvar Mapeamentos
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* ========================================================================= */}
              {/* TAB 3: CONTA & ACESSO                                                     */}
              {/* ========================================================================= */}
              <TabsContent value="account" className="space-y-6 m-0 focus-visible:outline-none">
                <Card className="border-border/60 shadow-sm">
                  <CardHeader className="pb-4">
                    <CardTitle className="text-lg sm:text-xl font-bold flex items-center gap-2">
                      <Settings2 className="h-5 w-5 text-slate-500" />
                      Conexão com a Conta do Google Ads
                    </CardTitle>
                    <CardDescription className="text-sm text-muted-foreground mt-1 leading-relaxed">
                      Gerencie a autorização OAuth e a conta de anúncios vinculada a este workspace.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6 pt-0">
                    {/* Status da Conexão */}
                    <div className="rounded-2xl border bg-muted/10 p-5 space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <div className="flex items-center gap-3.5">
                          <div className={`flex h-11 w-11 items-center justify-center rounded-xl font-bold text-sm ${connected ? 'bg-emerald-500/10 text-emerald-600' : 'bg-muted text-muted-foreground'}`}>
                            <Target className="h-6 w-6" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="font-bold text-base text-foreground">Autorização Google Ads</h4>
                              {connected ? (
                                <Badge className="bg-emerald-500/15 text-emerald-600 border-0 text-xs px-2 py-0.5">Ativa</Badge>
                              ) : (
                                <Badge variant="outline" className="text-muted-foreground text-xs px-2 py-0.5">Inativa</Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground mt-0.5">
                              {connected
                                ? 'Conexão ativa e autenticada com segurança.'
                                : 'Conecte sua conta do Google para permitir envio de conversões.'}
                            </p>
                          </div>
                        </div>

                        {connected ? (
                          <Button variant="outline" size="sm" className="rounded-full text-xs h-8 text-destructive hover:bg-destructive/10" onClick={disconnect}>
                            <Unplug className="mr-1.5 h-3.5 w-3.5" />
                            Desconectar Conta
                          </Button>
                        ) : (
                          <Button asChild size="sm" className="rounded-full text-sm h-9 px-4 shadow-sm font-medium">
                            <a href="/api/integrations/google-ads/auth">
                              <Link2 className="mr-2 h-4 w-4" />
                              Conectar com o Google
                            </a>
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Seleção de Conta */}
                    <div className="grid gap-5 md:grid-cols-2">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label htmlFor="customerId" className="text-sm font-semibold">Conta de Anúncios (Customer ID)</Label>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs rounded-full text-muted-foreground"
                            onClick={loadAccounts}
                            disabled={accountsLoading || !connected}
                          >
                            <RefreshCw className={`mr-1.5 h-3 w-3 ${accountsLoading ? 'animate-spin' : ''}`} />
                            Recarregar
                          </Button>
                        </div>

                        <Select
                          value={config.customerId || 'none'}
                          onValueChange={(value) => updateConfig('customerId', value === 'none' ? '' : value)}
                          disabled={accountsLoading || accounts.length === 0 || !connected}
                        >
                          <SelectTrigger id="customerId" className="h-11 text-sm bg-background">
                            <SelectValue placeholder={accountsLoading ? 'Carregando contas...' : 'Selecione uma conta'} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none" className="text-sm">Nenhuma conta selecionada</SelectItem>
                            {accounts.map((acc) => (
                              <SelectItem key={acc.customerId} value={acc.customerId} className="text-sm">
                                {acc.descriptiveName || `Conta ${acc.customerId}`} ({acc.customerId})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="loginCustomerId" className="text-sm font-semibold">Conta Gerenciadora / MCC (Opcional)</Label>
                        <Input
                          id="loginCustomerId"
                          value={config.loginCustomerId}
                          onChange={(e) => updateConfig('loginCustomerId', e.target.value.replace(/\D/g, ''))}
                          placeholder="Ex: 1234567890 (apenas se usar MCC)"
                          className="h-11 text-sm"
                          disabled={!connected}
                        />
                      </div>
                    </div>

                    <div className="flex justify-end pt-2 border-t">
                      <Button onClick={saveConfig} disabled={saving} size="sm" className="rounded-full h-9 px-5 font-semibold text-sm shadow-sm">
                        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                        Salvar Configurações da Conta
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* ========================================================================= */}
              {/* TAB 4: RELATÓRIO & ROAS                                                   */}
              {/* ========================================================================= */}
              <TabsContent value="roas" className="space-y-6 m-0 focus-visible:outline-none">
                <Card className="border-border/60 shadow-sm">
                  <CardHeader className="pb-4">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <CardTitle className="text-lg sm:text-xl font-bold flex items-center gap-2">
                          <BarChart3 className="h-5 w-5 text-emerald-500" />
                          Custo, CAC e ROAS por Campanha
                        </CardTitle>
                        <CardDescription className="text-sm text-muted-foreground mt-1 leading-relaxed">
                          Cruza o investimento de anúncios do Google com a receita real de vendas fechadas no CRM.
                        </CardDescription>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <Select value={periodDays} onValueChange={setPeriodDays}>
                          <SelectTrigger className="h-9 w-[140px] text-xs font-medium">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="7" className="text-xs">Últimos 7 dias</SelectItem>
                            <SelectItem value="30" className="text-xs">Últimos 30 dias</SelectItem>
                            <SelectItem value="90" className="text-xs">Últimos 90 dias</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9 rounded-full text-xs font-medium px-4"
                          onClick={loadReport}
                          disabled={reportLoading || !config.customerId}
                        >
                          {reportLoading ? (
                            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="mr-2 h-3.5 w-3.5" />
                          )}
                          {report ? 'Atualizar Dados' : 'Carregar Dados'}
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-5 pt-0">
                    {!report && !reportLoading && !reportError && (
                      <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground space-y-2">
                        <BarChart3 className="h-9 w-9 text-muted-foreground/50 mx-auto" />
                        <p className="text-sm font-medium">Clique em <strong>Carregar Dados</strong> para consultar as métricas do Google Ads cruzadas com o CRM.</p>
                      </div>
                    )}

                    {reportError && (
                      <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3.5 text-xs">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                        <p className="text-muted-foreground text-sm">{reportError}</p>
                      </div>
                    )}

                    {report && (
                      <div className="space-y-5">
                        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
                          <div className="rounded-xl border bg-muted/20 p-4 space-y-1">
                            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Investido no Google</p>
                            <p className="text-2xl font-bold text-foreground">{formatMoney(report.totals.cost, report.currencyCode)}</p>
                          </div>
                          <div className="rounded-xl border bg-emerald-500/5 border-emerald-500/20 p-4 space-y-1">
                            <p className="text-xs text-emerald-600 font-medium uppercase tracking-wider">Receita no CRM</p>
                            <p className="text-2xl font-bold text-emerald-600">
                              {formatMoney(report.totals.revenue, report.currencyCode)}
                            </p>
                          </div>
                          <div className="rounded-xl border bg-muted/20 p-4 space-y-1">
                            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">CAC Médio</p>
                            <p className="text-2xl font-bold text-foreground">
                              {report.totals.costPerAcquisition === null
                                ? '—'
                                : formatMoney(report.totals.costPerAcquisition, report.currencyCode)}
                            </p>
                          </div>
                          <div className="rounded-xl border bg-muted/20 p-4 space-y-1">
                            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">ROAS Geral</p>
                            <p
                              className={`text-2xl font-bold ${
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
                          <p className="text-sm text-muted-foreground text-center py-6">
                            Nenhuma campanha com clique rastreado ou custo no período selecionado.
                          </p>
                        ) : (
                          <div className="overflow-x-auto rounded-xl border">
                            <table className="w-full min-w-[700px] text-sm">
                              <thead className="bg-muted/40 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                <tr>
                                  <th className="px-4 py-3 text-left">Campanha</th>
                                  <th className="px-4 py-3 text-right">Investido</th>
                                  <th className="px-4 py-3 text-right">Conversas</th>
                                  <th className="px-4 py-3 text-right">Vendas</th>
                                  <th className="px-4 py-3 text-right">Receita</th>
                                  <th className="px-4 py-3 text-right">CAC</th>
                                  <th className="px-4 py-3 text-right">ROAS</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y text-sm">
                                {report.rows.map((row) => (
                                  <tr key={row.campaignId} className="hover:bg-muted/20 transition-colors">
                                    <td className="max-w-[240px] truncate px-4 py-3 font-medium text-foreground" title={row.campaignName}>
                                      {row.campaignName}
                                    </td>
                                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                                      {formatMoney(row.cost, report.currencyCode)}
                                    </td>
                                    <td className="px-4 py-3 text-right tabular-nums font-medium">{row.conversations}</td>
                                    <td className="px-4 py-3 text-right tabular-nums font-bold text-emerald-600">{row.wonDeals}</td>
                                    <td className="px-4 py-3 text-right tabular-nums font-bold text-foreground">
                                      {formatMoney(row.revenue, report.currencyCode)}
                                    </td>
                                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                                      {row.costPerAcquisition === null
                                        ? '—'
                                        : formatMoney(row.costPerAcquisition, report.currencyCode)}
                                    </td>
                                    <td
                                      className={`px-4 py-3 text-right tabular-nums font-bold ${
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
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* ========================================================================= */}
              {/* TAB 5: DIAGNÓSTICOS & SAÚDE                                               */}
              {/* ========================================================================= */}
              <TabsContent value="health" className="space-y-6 m-0 focus-visible:outline-none">
                {health && (
                  <Card className="border-border/60 shadow-sm">
                    <CardHeader className="pb-4">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-lg sm:text-xl font-bold flex items-center gap-2">
                          <Zap className="h-5 w-5 text-amber-500" />
                          Monitoramento em Tempo Real das Conversões
                        </CardTitle>
                        <Badge variant="outline" className="text-xs font-mono px-2.5 py-0.5">
                          Data Manager API v1
                        </Badge>
                      </div>
                      <CardDescription className="text-sm text-muted-foreground mt-1 leading-relaxed">
                        O worker drena a fila continuamente e consulta a confirmação assíncrona do Google Ads.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6 pt-0">
                      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-5">
                        {([
                          ['Enviadas', health.counts.sent, 'text-emerald-600 bg-emerald-500/5 border-emerald-500/20'],
                          ['Na Fila', health.counts.pending, 'text-blue-600 bg-blue-500/5 border-blue-500/20'],
                          ['Em Envio', health.counts.processing, 'text-purple-600 bg-purple-500/5 border-purple-500/20'],
                          ['Repetindo', health.counts.failed, 'text-amber-600 bg-amber-500/5 border-amber-500/20'],
                          ['Descartadas', health.counts.dead, 'text-destructive bg-destructive/5 border-destructive/20'],
                        ] as const).map(([label, value, style]) => (
                          <div key={label} className={`rounded-xl border p-4 ${style}`}>
                            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{label}</p>
                            <p className="text-2xl font-bold mt-1">{value}</p>
                          </div>
                        ))}
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-4 text-xs text-muted-foreground border-t pt-4">
                        <span>
                          Última conversão enviada:{' '}
                          <strong className="text-foreground text-sm font-semibold">
                            {health.lastSentAt ? new Date(health.lastSentAt).toLocaleString('pt-BR') : 'Nenhuma no período'}
                          </strong>
                        </span>
                        <span>
                          Atribuições:{' '}
                          <strong className="text-emerald-600 text-sm font-semibold">{health.attributedContacts.deterministic}</strong> determinísticas,{' '}
                          <strong className="text-muted-foreground text-sm font-semibold">{health.attributedContacts.probabilistic}</strong> por proximidade
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>
            </div>
          </div>
        </Tabs>

        {/* MODAL: CRIAR / EDITAR DESTINO */}
        {editingDestination && (
          <Dialog open={Boolean(editingDestination)} onOpenChange={() => setEditingDestination(null)}>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-xl font-bold">
                  <Link2 className="h-5 w-5 text-blue-500" />
                  {isCreatingNew ? 'Novo Destino de Anúncio' : `Editar Destino: ${editingDestination.name}`}
                </DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground leading-relaxed">
                  Configure o nome, o slug identificador e o número de WhatsApp para este anúncio.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-2">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold">Nome da Campanha / Anúncio</Label>
                    <Input
                      value={editingDestination.name}
                      onChange={(e) => {
                        const newName = e.target.value;
                        const currentAutoSlug = slugify(editingDestination.name);
                        const shouldUpdateSlug = !editingDestination.slug || editingDestination.slug === currentAutoSlug;
                        setEditingDestination({
                          ...editingDestination,
                          name: newName,
                          slug: shouldUpdateSlug ? slugify(newName) || editingDestination.slug : editingDestination.slug,
                        });
                      }}
                      placeholder="Ex: Fibra 500 Mega - Google Ads"
                      className="h-11 text-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-semibold">Slug da URL</Label>
                      <span className="text-xs text-muted-foreground font-mono">auto-formatado</span>
                    </div>
                    <Input
                      value={editingDestination.slug}
                      onChange={(e) =>
                        setEditingDestination({
                          ...editingDestination,
                          slug: slugify(e.target.value),
                        })
                      }
                      placeholder="fibra-500-mega"
                      className="h-11 font-mono text-sm"
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold">Instância do WhatsApp</Label>
                    <Select
                      value={editingDestination.instanceName || undefined}
                      onValueChange={(val) => setEditingDestination({ ...editingDestination, instanceName: val })}
                    >
                      <SelectTrigger className="h-11 text-sm">
                        <SelectValue placeholder="Selecione uma instância" />
                      </SelectTrigger>
                      <SelectContent>
                        {instances.map((inst) => (
                          <SelectItem key={inst.instanceName} value={inst.instanceName} className="text-sm">
                            {inst.displayName ? `${inst.displayName} (${inst.instanceName})` : inst.instanceName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-semibold">WhatsApp de Atendimento</Label>
                    <div className="relative">
                      <Input
                        value={editingDestination.phone}
                        onChange={(e) =>
                          setEditingDestination({
                            ...editingDestination,
                            phone: e.target.value.replace(/\D/g, ''),
                          })
                        }
                        placeholder="Ex: 5563999998888"
                        className="h-11 font-mono text-sm"
                      />
                      <Phone className="absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Mensagem Pré-preenchida no WhatsApp</Label>
                  <Textarea
                    value={editingDestination.defaultMessage}
                    onChange={(e) => setEditingDestination({ ...editingDestination, defaultMessage: e.target.value })}
                    className="min-h-20 text-sm resize-none"
                    placeholder="Olá! Gostaria de saber mais sobre o anúncio."
                  />
                  <p className="text-xs text-muted-foreground">
                    O Dialogy anexa automaticamente o código determinístico ao final da mensagem.
                  </p>
                </div>

                {/* Prévia da URL */}
                <div className="rounded-xl border bg-muted/40 p-3.5 space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-muted-foreground font-medium">
                    <span className="font-semibold text-foreground">Prévia da URL Gerada:</span>
                    <span>?dest={editingDestination.slug || '...'}</span>
                  </div>
                  <p className="font-mono text-xs text-foreground/90 break-all leading-relaxed">
                    {buildTrackingUrl(origin, workspaceId || '', editingDestination) || 'Preencha instância e telefone para ver a URL.'}
                  </p>
                </div>
              </div>

              <DialogFooter className="gap-2 sm:gap-0 pt-2">
                <Button variant="ghost" size="sm" className="rounded-full text-sm h-9 px-4 font-medium" onClick={() => setEditingDestination(null)}>
                  Cancelar
                </Button>
                <Button onClick={saveDestinationModal} disabled={saving} size="sm" className="rounded-full text-sm h-9 px-5 font-semibold shadow-sm">
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                  Salvar Destino
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {/* MODAL: SCRIPT PARA O SITE */}
        {selectedScriptDestination && (
          <Dialog open={Boolean(selectedScriptDestination)} onOpenChange={() => setSelectedScriptDestination(null)}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-xl font-bold">
                  <Code2 className="h-6 w-6 text-purple-500" />
                  Script de Rastreamento para o Site
                </DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground leading-relaxed">
                  Cole este script no seu site (WordPress, Elementor, HTML) para que qualquer botão de WhatsApp repasse automaticamente o GCLID do Google Ads para o Dialogy.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3.5 pt-2">
                <div className="rounded-xl border bg-muted/40 p-4 font-mono text-xs text-foreground/90 overflow-x-auto leading-relaxed">
                  <pre>{`<script>
  document.addEventListener("DOMContentLoaded", function () {
    const params = window.location.search;
    const linkDialogy = "${origin}/t/wpp/${workspaceId}/${selectedScriptDestination.instanceName}?dest=${selectedScriptDestination.slug}";
    const botoes = document.querySelectorAll('a[href*="wa.me"], a[href*="whatsapp"], .btn-whatsapp');
    botoes.forEach(function (btn) {
      btn.href = linkDialogy + (params ? params.replace('?', '&') : '');
    });
  });
</script>`}</pre>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    onClick={() => {
                      const code = `<script>\n  document.addEventListener("DOMContentLoaded", function () {\n    const params = window.location.search;\n    const linkDialogy = "${origin}/t/wpp/${workspaceId}/${selectedScriptDestination.instanceName}?dest=${selectedScriptDestination.slug}";\n    const botoes = document.querySelectorAll('a[href*="wa.me"], a[href*="whatsapp"], .btn-whatsapp');\n    botoes.forEach(function (btn) {\n      btn.href = linkDialogy + (params ? params.replace('?', '&') : '');\n    });\n  });\n</script>`;
                      navigator.clipboard.writeText(code);
                      toast({ title: 'Script copiado com sucesso!' });
                    }}
                    className="rounded-full text-sm h-9 px-5 font-semibold"
                  >
                    <Copy className="mr-2 h-4 w-4" />
                    Copiar Código
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </div>
  );
}
