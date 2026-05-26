'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Copy, Loader2, Plus, Save, Trash2 } from 'lucide-react';

import {
  getGoogleAdsIntegrationConfig,
  saveGoogleAdsIntegrationConfig,
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
  destinations: [],
};

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

export default function GadsIntegrationPage() {
  const user = useCurrentUser();
  const { toast } = useToast();
  const workspaceId = user?.activeWorkspaceId;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [instances, setInstances] = useState<EvolutionInstanceOption[]>([]);
  const [config, setConfig] = useState<GoogleAdsIntegrationConfig>(EMPTY_CONFIG);

  const origin = useMemo(() => (typeof window !== 'undefined' ? window.location.origin : ''), []);

  const loadConfig = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const result = await getGoogleAdsIntegrationConfig(workspaceId);
      if (result.error) {
        toast({ title: 'Erro ao carregar GADS', description: result.error, variant: 'destructive' });
      }
      setInstances(result.instances);
      setConfig(result.config || EMPTY_CONFIG);
    } finally {
      setLoading(false);
    }
  }, [toast, workspaceId]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

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

  return (
    <div className="flex min-h-screen flex-col bg-background px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="icon" className="rounded-full">
              <Link href="/integrations">
                <ArrowLeft className="h-5 w-5" />
              </Link>
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-foreground">GADS</h1>
                <Badge variant="outline" className="rounded-full">Google Ads</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Configure multiplos destinos rastreaveis por workspace, campanha, numero ou operacao.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={addDestination} variant="outline" className="rounded-full">
              <Plus className="mr-2 h-4 w-4" />
              Novo destino
            </Button>
            <Button onClick={saveConfig} disabled={saving} className="rounded-full">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Salvar integracao
            </Button>
          </div>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Conta e conversoes</CardTitle>
            <CardDescription>
              Esta configuracao e compartilhada pelos destinos. Cada card abaixo gera uma URL propria para o Google Ads.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="customerId">Customer ID</Label>
                <Input
                  id="customerId"
                  value={config.customerId}
                  onChange={(event) => updateConfig('customerId', event.target.value)}
                  placeholder="Ex: 1234567890"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="loginCustomerId">Login Customer ID</Label>
                <Input
                  id="loginCustomerId"
                  value={config.loginCustomerId}
                  onChange={(event) => updateConfig('loginCustomerId', event.target.value)}
                  placeholder="Opcional para MCC"
                />
              </div>
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="whatsappConversion">Mensagem recebida</Label>
                <Input
                  id="whatsappConversion"
                  value={config.conversionActionWhatsappMessage}
                  onChange={(event) => updateConfig('conversionActionWhatsappMessage', event.target.value)}
                  placeholder="customers/.../conversionActions/..."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="leadQualified">Lead qualificado</Label>
                <Input
                  id="leadQualified"
                  value={config.conversionActionLeadQualified}
                  onChange={(event) => updateConfig('conversionActionLeadQualified', event.target.value)}
                  placeholder="Opcional"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="saleWon">Venda fechada</Label>
                <Input
                  id="saleWon"
                  value={config.conversionActionSaleWon}
                  onChange={(event) => updateConfig('conversionActionSaleWon', event.target.value)}
                  placeholder="Opcional"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Autorizacao da conta Google Ads</CardTitle>
            <CardDescription>
              O refresh token fica salvo somente nesta integracao do workspace e autoriza o envio de conversoes offline para esta conta.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="refreshToken">Refresh token</Label>
                <Input
                  id="refreshToken"
                  type="password"
                  value={config.refreshToken}
                  onChange={(event) => updateConfig('refreshToken', event.target.value)}
                  placeholder="OAuth refresh_token"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <section className="grid gap-4 lg:grid-cols-2">
          {config.destinations.length === 0 ? (
            <Card className="border-dashed lg:col-span-2">
              <CardContent className="flex min-h-56 flex-col items-center justify-center gap-4 text-center">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">Nenhum destino configurado</h2>
                  <p className="text-sm text-muted-foreground">Crie um card para cada campanha, numero ou operacao de atendimento.</p>
                </div>
                <Button onClick={addDestination} className="rounded-full">
                  <Plus className="mr-2 h-4 w-4" />
                  Criar primeiro destino
                </Button>
              </CardContent>
            </Card>
          ) : config.destinations.map((destination, index) => {
            const trackingUrl = buildTrackingUrl(origin, workspaceId, destination);
            return (
              <Card key={destination.id} className="overflow-hidden">
                <CardHeader className="border-b bg-muted/20">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-lg">{destination.name || `Destino ${index + 1}`}</CardTitle>
                      <CardDescription>{destination.slug || 'slug-pendente'}</CardDescription>
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
                </CardHeader>
                <CardContent className="grid gap-4 p-5">
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
                      {copiedId === destination.id ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                      {copiedId === destination.id ? 'Copiado' : 'Copiar URL'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </section>
      </div>
    </div>
  );
}
