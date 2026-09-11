'use client';

import React, { useCallback, useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  BrainCircuit,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  XCircle,
} from 'lucide-react';

import { getAiModelCatalogAction } from '@/actions/ai-models';
import {
  listAiProviderCredentialsAction,
  removeAiProviderCredentialAction,
  saveAiProviderCredentialAction,
  testAiProviderConnectionAction,
  type AiProviderConnectionTestResult,
  type AiProviderCredentialSummary,
} from '@/actions/integrations';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/hooks/use-toast';
import { useCurrentUser } from '@/hooks/use-online-status';
import {
  AI_CREDENTIAL_PROVIDER_META,
  AI_CREDENTIAL_PROVIDERS,
  getAiCredentialProviderLabel,
  normalizeAiCredentialModel,
  type AiCredentialProvider,
} from '@/lib/ai-provider-credentials';
import {
  getAiModelLabel,
  getWorkspaceProviderSelectableModels,
  type AiModelCatalogEntry,
} from '@/lib/ai-models';
import { cn } from '@/lib/utils';

const CUSTOM_MODEL_VALUE = '__custom_model__';

const PROVIDER_UI: Record<AiCredentialProvider, {
  keyHref: string;
  keyPlaceholder: string;
  customPlaceholder: string;
  tone: string;
}> = {
  gemini: {
    keyHref: 'https://aistudio.google.com/app/apikey',
    keyPlaceholder: 'AIza...',
    customPlaceholder: 'Ex: gemini-2.5-flash-lite',
    tone: 'border-amber-200 bg-amber-50 text-amber-700',
  },
  openai: {
    keyHref: 'https://platform.openai.com/api-keys',
    keyPlaceholder: 'sk-...',
    customPlaceholder: 'Ex: gpt-5.4-mini ou codex/gpt-5.3-codex',
    tone: 'border-sky-200 bg-sky-50 text-sky-700',
  },
  deepseek: {
    keyHref: 'https://platform.deepseek.com/api_keys',
    keyPlaceholder: 'sk-...',
    customPlaceholder: 'Ex: deepseek-flash',
    tone: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  },
};

type FormState = {
  provider: AiCredentialProvider;
  model: string;
  customModel: string;
  apiKey: string;
  isActive: boolean;
};

function emptyForm(provider: AiCredentialProvider, catalog: AiModelCatalogEntry[]): FormState {
  const options = getWorkspaceProviderSelectableModels(
    catalog,
    AI_CREDENTIAL_PROVIDER_META[provider].modelProviders,
  );
  const defaultModel = options.some((option) => option.id === AI_CREDENTIAL_PROVIDER_META[provider].defaultModel)
    ? AI_CREDENTIAL_PROVIDER_META[provider].defaultModel
    : options[0]?.id || AI_CREDENTIAL_PROVIDER_META[provider].defaultModel;

  return {
    provider,
    model: defaultModel,
    customModel: '',
    apiKey: '',
    isActive: true,
  };
}

function providerForNewCredential(credentials: AiProviderCredentialSummary[]): AiCredentialProvider {
  return AI_CREDENTIAL_PROVIDERS.find((provider) => (
    !credentials.some((credential) => credential.provider === provider)
  )) || 'deepseek';
}

function resolveSelectedModel(form: FormState): string | null {
  return normalizeAiCredentialModel(
    form.provider,
    form.model === CUSTOM_MODEL_VALUE ? form.customModel : form.model,
  );
}

function testStatusVariant(result: AiProviderConnectionTestResult | null) {
  if (!result) return null;
  return result.ok
    ? {
        icon: <CheckCircle2 className="h-4 w-4" />,
        title: 'Conexao validada',
        className: 'border-emerald-200 bg-emerald-50 text-emerald-900',
      }
    : {
        icon: <XCircle className="h-4 w-4" />,
        title: 'Falha no teste',
        className: 'border-red-200 bg-red-50 text-red-900',
      };
}

export function AiModelCredentialsPage() {
  const user = useCurrentUser();
  const [loading, setLoading] = useState(true);
  const [credentials, setCredentials] = useState<AiProviderCredentialSummary[]>([]);
  const [catalog, setCatalog] = useState<AiModelCatalogEntry[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<AiCredentialProvider | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm('deepseek', []));
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [removingProvider, setRemovingProvider] = useState<AiCredentialProvider | null>(null);
  const [testResult, setTestResult] = useState<AiProviderConnectionTestResult | null>(null);

  const loadData = useCallback(async () => {
    if (!user?.activeWorkspaceId) return;

    setLoading(true);
    try {
      const [credentialResult, catalogResult] = await Promise.all([
        listAiProviderCredentialsAction(user.activeWorkspaceId),
        getAiModelCatalogAction(),
      ]);

      if (credentialResult.error) {
        toast({ title: 'Erro', description: credentialResult.error, variant: 'destructive' });
      }
      setCredentials(credentialResult.credentials || []);
      setCatalog(catalogResult.models || []);
    } catch (error) {
      console.error('[AI_MODEL_CREDENTIALS_PAGE] Failed to load:', error);
      toast({ title: 'Erro', description: 'Nao foi possivel carregar os modelos de IA.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [user?.activeWorkspaceId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const modelOptions = useMemo(() => (
    getWorkspaceProviderSelectableModels(
      catalog,
      AI_CREDENTIAL_PROVIDER_META[form.provider].modelProviders,
    )
  ), [catalog, form.provider]);

  const activeCount = credentials.filter((credential) => credential.isActive && credential.hasApiKey).length;
  const finalModel = resolveSelectedModel(form);
  const currentProviderUi = PROVIDER_UI[form.provider];
  const currentProviderLabel = getAiCredentialProviderLabel(form.provider);
  const status = testStatusVariant(testResult);

  const openCreateDialog = () => {
    const provider = providerForNewCredential(credentials);
    setEditingProvider(null);
    setForm(emptyForm(provider, catalog));
    setTestResult(null);
    setDialogOpen(true);
  };

  const openEditDialog = (credential: AiProviderCredentialSummary) => {
    const options = getWorkspaceProviderSelectableModels(
      catalog,
      AI_CREDENTIAL_PROVIDER_META[credential.provider].modelProviders,
    );
    const knownModel = options.some((option) => option.id === credential.model);

    setEditingProvider(credential.provider);
    setForm({
      provider: credential.provider,
      model: knownModel ? credential.model : CUSTOM_MODEL_VALUE,
      customModel: knownModel ? '' : credential.model,
      apiKey: '',
      isActive: credential.isActive,
    });
    setTestResult(null);
    setDialogOpen(true);
  };

  const setProvider = (provider: AiCredentialProvider) => {
    setForm(emptyForm(provider, catalog));
    setTestResult(null);
  };

  const handleTest = async () => {
    if (!user?.activeWorkspaceId || !finalModel) {
      toast({ title: 'Modelo obrigatorio', description: 'Selecione ou informe um modelo valido.', variant: 'destructive' });
      return;
    }

    setTesting(true);
    setTestResult(null);
    try {
      const result = await testAiProviderConnectionAction({
        workspaceId: user.activeWorkspaceId,
        provider: form.provider,
        apiKey: form.apiKey,
        model: finalModel,
      });
      setTestResult(result);
      toast({
        title: result.ok ? 'Conexao validada' : 'Falha no teste',
        description: result.ok ? `${currentProviderLabel} respondeu corretamente.` : result.message,
        variant: result.ok ? 'default' : 'destructive',
      });
    } catch {
      toast({ title: 'Erro inesperado', description: 'Nao foi possivel testar este modelo.', variant: 'destructive' });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user?.activeWorkspaceId || !finalModel) {
      toast({ title: 'Modelo obrigatorio', description: 'Selecione ou informe um modelo valido.', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const result = await saveAiProviderCredentialAction({
        workspaceId: user.activeWorkspaceId,
        provider: form.provider,
        apiKey: form.apiKey,
        model: finalModel,
        isActive: form.isActive,
      });

      if (!result.success) {
        toast({ title: 'Erro ao salvar', description: result.error, variant: 'destructive' });
        return;
      }

      toast({ title: 'Modelo salvo', description: `${currentProviderLabel} ficou disponivel para selecao.` });
      setDialogOpen(false);
      await loadData();
    } catch {
      toast({ title: 'Erro inesperado', description: 'Nao foi possivel salvar este modelo.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (credential: AiProviderCredentialSummary) => {
    if (!user?.activeWorkspaceId) return;
    const confirmed = window.confirm(`Remover ${credential.providerLabel} deste workspace?`);
    if (!confirmed) return;

    setRemovingProvider(credential.provider);
    try {
      const result = await removeAiProviderCredentialAction({
        workspaceId: user.activeWorkspaceId,
        provider: credential.provider,
      });
      if (!result.success) {
        toast({ title: 'Erro ao remover', description: result.error, variant: 'destructive' });
        return;
      }
      toast({ title: 'Modelo removido', description: `${credential.providerLabel} saiu da lista de selecao.` });
      await loadData();
    } catch {
      toast({ title: 'Erro inesperado', description: 'Nao foi possivel remover este modelo.', variant: 'destructive' });
    } finally {
      setRemovingProvider(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-muted/30 p-4 sm:p-6">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <Link href="/integrations">
              <Button variant="ghost" size="icon" className="shrink-0">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight text-foreground">Modelos de IA</h1>
                <Badge variant="outline" className="rounded-full">
                  {activeCount} ativo(s)
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Gemini, OpenAI/Codex e DeepSeek ficam no mesmo painel do workspace.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void loadData()} disabled={loading}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Atualizar
            </Button>
            <Button onClick={openCreateDialog}>
              <Plus className="mr-2 h-4 w-4" />
              Adicionar modelo
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {AI_CREDENTIAL_PROVIDERS.map((provider) => {
            const credential = credentials.find((item) => item.provider === provider);
            const isReady = Boolean(credential?.isActive && credential.hasApiKey);
            return (
              <Card key={provider} className="border border-border bg-card shadow-sm">
                <CardContent className="flex items-center gap-4 p-5">
                  <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border', PROVIDER_UI[provider].tone)}>
                    <BrainCircuit className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {getAiCredentialProviderLabel(provider)}
                      </p>
                      <span className={cn('h-2 w-2 rounded-full', isReady ? 'bg-emerald-500' : 'bg-slate-300')} />
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {credential ? getAiModelLabel(credential.model, catalog) : 'Nao adicionado'}
                    </p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card className="border border-border bg-card shadow-sm">
          <CardHeader className="flex flex-col gap-3 border-b border-border/70 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-lg">Modelos adicionados</CardTitle>
              <CardDescription>
                Somente modelos ativos com chave salva entram no seletor do Autopilot.
              </CardDescription>
            </div>
            <Badge variant="secondary" className="w-fit rounded-full">
              {credentials.length} configurado(s)
            </Badge>
          </CardHeader>
          <CardContent className="p-0">
            {credentials.length === 0 ? (
              <div className="flex min-h-[260px] flex-col items-center justify-center gap-4 px-6 py-12 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-dashed border-border bg-muted">
                  <KeyRound className="h-6 w-6 text-muted-foreground" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-foreground">Nenhum modelo adicionado</h2>
                  <p className="mt-1 max-w-md text-sm text-muted-foreground">
                    Adicione um provedor, escolha o modelo e salve a chave para liberar a selecao nos agentes.
                  </p>
                </div>
                <Button onClick={openCreateDialog}>
                  <Plus className="mr-2 h-4 w-4" />
                  Adicionar modelo
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Provedor</TableHead>
                    <TableHead>Modelo</TableHead>
                    <TableHead>Chave</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[150px] text-right">Acoes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {credentials.map((credential) => {
                    const isRemoving = removingProvider === credential.provider;
                    return (
                      <TableRow key={credential.provider}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className={cn('flex h-9 w-9 items-center justify-center rounded-lg border', PROVIDER_UI[credential.provider].tone)}>
                              <BrainCircuit className="h-4 w-4" />
                            </div>
                            <span className="font-medium">{credential.providerLabel}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium text-foreground">{getAiModelLabel(credential.model, catalog)}</div>
                          <div className="text-xs text-muted-foreground">{credential.model}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={credential.hasApiKey ? 'outline' : 'destructive'} className="rounded-full">
                            {credential.hasApiKey ? 'Salva' : 'Ausente'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={credential.isActive ? 'default' : 'secondary'} className="rounded-full">
                            {credential.isActive ? 'Ativo' : 'Pausado'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button variant="outline" size="icon" onClick={() => openEditDialog(credential)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="icon"
                              disabled={isRemoving}
                              onClick={() => void handleRemove(credential)}
                            >
                              {isRemoving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          <form onSubmit={handleSave} className="space-y-5">
            <DialogHeader>
              <DialogTitle>{editingProvider ? 'Editar modelo de IA' : 'Adicionar modelo de IA'}</DialogTitle>
              <DialogDescription>
                Escolha o provedor, o modelo e a chave que este workspace vai usar.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-5">
              <div className="grid gap-2">
                <Label>Provedor</Label>
                <Select
                  value={form.provider}
                  onValueChange={(value) => setProvider(value as AiCredentialProvider)}
                  disabled={Boolean(editingProvider)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AI_CREDENTIAL_PROVIDERS.map((provider) => (
                      <SelectItem key={provider} value={provider}>
                        {getAiCredentialProviderLabel(provider)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label>Modelo</Label>
                <Select
                  value={form.model}
                  onValueChange={(value) => {
                    setForm((current) => ({ ...current, model: value }));
                    setTestResult(null);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um modelo" />
                  </SelectTrigger>
                  <SelectContent>
                    {modelOptions.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.label}
                      </SelectItem>
                    ))}
                    <SelectItem value={CUSTOM_MODEL_VALUE}>Outro modelo</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {form.model === CUSTOM_MODEL_VALUE && (
                <div className="grid gap-2">
                  <Label htmlFor="custom-model">ID do modelo</Label>
                  <Input
                    id="custom-model"
                    value={form.customModel}
                    placeholder={currentProviderUi.customPlaceholder}
                    onChange={(event) => {
                      setForm((current) => ({ ...current, customModel: event.target.value }));
                      setTestResult(null);
                    }}
                  />
                </div>
              )}

              <div className="grid gap-2">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="api-key">Chave da API</Label>
                  <a
                    href={currentProviderUi.keyHref}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    Obter chave
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <Input
                  id="api-key"
                  type="password"
                  value={form.apiKey}
                  placeholder={editingProvider ? 'Deixe vazio para manter a chave salva' : currentProviderUi.keyPlaceholder}
                  onChange={(event) => {
                    setForm((current) => ({ ...current, apiKey: event.target.value }));
                    setTestResult(null);
                  }}
                />
              </div>

              <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/30 p-4">
                <div>
                  <Label htmlFor="active-model">Disponivel para selecao</Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Quando ativo, este modelo aparece para os agentes do workspace.
                  </p>
                </div>
                <Switch
                  id="active-model"
                  checked={form.isActive}
                  onCheckedChange={(checked) => setForm((current) => ({ ...current, isActive: checked }))}
                />
              </div>

              {status && (
                <Alert className={cn('border', status.className)}>
                  <div className="flex items-start gap-2">
                    {status.icon}
                    <div>
                      <AlertTitle>{status.title}</AlertTitle>
                      <AlertDescription>
                        {testResult?.message}
                      </AlertDescription>
                    </div>
                  </div>
                </Alert>
              )}
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={handleTest} disabled={testing || saving}>
                {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                Testar
              </Button>
              <Button type="submit" disabled={saving || testing}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
                Salvar modelo
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
