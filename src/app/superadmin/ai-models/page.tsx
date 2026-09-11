'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, RefreshCw, Save, Sparkles, Trash2 } from 'lucide-react';

import {
  getAiDecisionModelConfigAction,
  getAiModelCatalogAction,
  getLmStudioConfigAction,
  saveAiDecisionModelConfigAction,
  saveAiModelCatalogAction,
  saveLmStudioConfigAction,
  syncLmStudioModelsAction,
} from '@/actions/ai-models';
import {
  AiModelCatalogEntry,
  AiModelProvider,
  getAiModelProviderLabel,
  getAutopilotSelectableModels,
  isAutopilotRuntimeSupportedModel,
} from '@/lib/ai-models';
import {
  AI_DECISION_MODEL_ROLES,
  DEFAULT_AI_DECISION_MODEL_CONFIG,
  type AiDecisionModelConfig,
  type AiDecisionModelRole,
} from '@/lib/ai-decision-models';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const PROVIDERS: AiModelProvider[] = ['googleai', 'openai', 'codex', 'deepseek', 'lmstudio', 'anthropic', 'other'];

function buildEmptyModel(index: number): AiModelCatalogEntry {
  return {
    id: '',
    label: '',
    provider: 'googleai',
    description: '',
    enabled: true,
  };
}

export default function AiModelsSuperadminPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingDecisionModels, setSavingDecisionModels] = useState(false);
  const [savingLmStudio, setSavingLmStudio] = useState(false);
  const [syncingLmStudio, setSyncingLmStudio] = useState(false);
  const [models, setModels] = useState<AiModelCatalogEntry[]>([]);
  const [initialSignature, setInitialSignature] = useState('');
  const [decisionModels, setDecisionModels] = useState<AiDecisionModelConfig>(DEFAULT_AI_DECISION_MODEL_CONFIG);
  const [initialDecisionSignature, setInitialDecisionSignature] = useState('');
  const [lmStudioBaseUrl, setLmStudioBaseUrl] = useState('');
  const [lmStudioApiToken, setLmStudioApiToken] = useState('');
  const [initialLmStudioSignature, setInitialLmStudioSignature] = useState('');

  useEffect(() => {
    Promise.all([getAiModelCatalogAction(), getLmStudioConfigAction(), getAiDecisionModelConfigAction()])
      .then(([catalogResult, lmStudioResult, decisionResult]) => {
        if (catalogResult.error) {
          toast({ title: 'Erro ao carregar', description: catalogResult.error, variant: 'destructive' });
          return;
        }
        setModels(catalogResult.models);
        setInitialSignature(JSON.stringify(catalogResult.models));
        setDecisionModels(decisionResult.config);
        setInitialDecisionSignature(JSON.stringify(decisionResult.config));

        if (!lmStudioResult.error) {
          setLmStudioBaseUrl(lmStudioResult.config.baseUrl);
          setLmStudioApiToken(lmStudioResult.config.apiToken);
          setInitialLmStudioSignature(JSON.stringify(lmStudioResult.config));
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const isDirty = useMemo(() => JSON.stringify(models) !== initialSignature, [initialSignature, models]);
  const isDecisionDirty = useMemo(() => JSON.stringify(decisionModels) !== initialDecisionSignature, [decisionModels, initialDecisionSignature]);
  const decisionModelOptions = useMemo(() => {
    const options = getAutopilotSelectableModels(models);
    const existingIds = new Set(options.map((model) => model.id));
    const currentModels = AI_DECISION_MODEL_ROLES
      .map((role) => decisionModels[role.id]?.model)
      .filter((model): model is string => Boolean(model?.trim()))
      .filter((model, index, all) => !existingIds.has(model) && all.indexOf(model) === index);

    return [
      ...options,
      ...currentModels.map((model): AiModelCatalogEntry => ({
        id: model,
        label: `Atual: ${model}`,
        provider: 'other',
        description: 'Modelo configurado atualmente, mas fora do catalogo global.',
        enabled: true,
      })),
    ];
  }, [decisionModels, models]);
  const lmStudioSignature = JSON.stringify({ baseUrl: lmStudioBaseUrl.trim(), apiToken: lmStudioApiToken.trim() });
  const isLmStudioDirty = lmStudioSignature !== initialLmStudioSignature;

  const summary = useMemo(() => {
    const enabled = models.filter((entry) => entry.enabled).length;
    const supported = models.filter((entry) => entry.enabled && isAutopilotRuntimeSupportedModel(entry)).length;
    return { total: models.length, enabled, supported };
  }, [models]);

  const updateModel = (index: number, updates: Partial<AiModelCatalogEntry>) => {
    setModels((current) => current.map((entry, currentIndex) => (
      currentIndex === index ? { ...entry, ...updates } : entry
    )));
  };

  const removeModel = (index: number) => {
    setModels((current) => current.filter((_, currentIndex) => currentIndex !== index));
  };

  const addModel = () => {
    setModels((current) => [...current, buildEmptyModel(current.length + 1)]);
  };

  const updateDecisionModel = (role: AiDecisionModelRole, updates: Partial<AiDecisionModelConfig[AiDecisionModelRole]>) => {
    setDecisionModels((current) => ({
      ...current,
      [role]: {
        ...current[role],
        ...updates,
      },
    }));
  };

  const handleSave = async () => {
    const normalized = models
      .map((entry) => ({
        ...entry,
        id: entry.id.trim(),
        label: entry.label.trim(),
        description: entry.description?.trim() || '',
      }))
      .filter((entry) => entry.id.length > 0 && entry.label.length > 0);

    if (normalized.length === 0) {
      toast({ title: 'Catálogo vazio', description: 'Adicione pelo menos um modelo válido.', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const result = await saveAiModelCatalogAction(normalized);
      if (!result.success) {
        toast({ title: 'Erro ao salvar', description: result.error, variant: 'destructive' });
        return;
      }

      setModels(normalized);
      setInitialSignature(JSON.stringify(normalized));
      toast({ title: 'Catálogo salvo', description: 'Os modelos globais foram atualizados.' });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDecisionModels = async () => {
    setSavingDecisionModels(true);
    try {
      const result = await saveAiDecisionModelConfigAction(decisionModels);
      if (!result.success) {
        toast({ title: 'Erro ao salvar modelos de decisao', description: result.error, variant: 'destructive' });
        return;
      }

      setInitialDecisionSignature(JSON.stringify(decisionModels));
      toast({ title: 'Modelos de decisao salvos', description: 'O Autopilot passara a usar estes modelos nos classificadores.' });
    } finally {
      setSavingDecisionModels(false);
    }
  };

  const handleSaveLmStudio = async () => {
    setSavingLmStudio(true);
    try {
      const result = await saveLmStudioConfigAction({ baseUrl: lmStudioBaseUrl, apiToken: lmStudioApiToken });
      if (!result.success) {
        toast({ title: 'Erro ao salvar LM Studio', description: result.error, variant: 'destructive' });
        return;
      }

      const normalized = { baseUrl: lmStudioBaseUrl.trim().replace(/\/+$/, ''), apiToken: lmStudioApiToken.trim() };
      setLmStudioBaseUrl(normalized.baseUrl);
      setLmStudioApiToken(normalized.apiToken);
      setInitialLmStudioSignature(JSON.stringify(normalized));
      toast({ title: 'LM Studio salvo', description: 'Endpoint global atualizado.' });
    } finally {
      setSavingLmStudio(false);
    }
  };

  const handleSyncLmStudio = async () => {
    setSyncingLmStudio(true);
    try {
      const result = await syncLmStudioModelsAction();
      if (!result.success || !result.models) {
        toast({ title: 'Erro ao sincronizar LM Studio', description: result.error, variant: 'destructive' });
        return;
      }

      setModels(result.models);
      setInitialSignature(JSON.stringify(result.models));
      toast({
        title: 'LM Studio sincronizado',
        description: `${result.discoveredCount || 0} modelo(s) local(is) encontrados. O catalogo global foi atualizado.`,
      });
    } finally {
      setSyncingLmStudio(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              IA Global
            </div>
            <div className="space-y-1">
              <h1 className="text-3xl font-bold tracking-tight text-foreground">Catálogo de Modelos</h1>
              <p className="max-w-3xl text-sm text-muted-foreground">
                Gerencie quais modelos aparecem no Autopilot. O runtime suporta entradas `googleai/...`, `openai/...`, `codex/...`, `deepseek/...` e `lmstudio/...`.
                O endpoint do LM Studio é configurado somente nesta área e não fica disponível para workspaces.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Badge variant="secondary" className="rounded-full px-3 py-1">{summary.total} cadastrados</Badge>
            <Badge variant="secondary" className="rounded-full px-3 py-1">{summary.enabled} ativos</Badge>
            <Badge variant="outline" className="rounded-full px-3 py-1">{summary.supported} suportados no Autopilot</Badge>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button onClick={addModel} variant="outline" className="rounded-full">
            <Plus className="mr-2 h-4 w-4" />
            Novo modelo
          </Button>
          <Button onClick={handleSave} disabled={saving || !isDirty} className="rounded-full">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Salvar catálogo
          </Button>
        </div>
      </header>

      <Card className="border-border bg-card shadow-sm">
        <CardHeader>
          <CardTitle>Modelos de decisao do Autopilot</CardTitle>
          <CardDescription>
            Escolha os modelos usados pelos classificadores rapidos. Quando salvo aqui, estes valores substituem as variaveis `AI_TOOL_INTENT_GATE_MODEL`, `AI_INTENT_CLASSIFIER_MODEL` e `AI_WORKFLOW_CLASSIFIER_MODEL`.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {AI_DECISION_MODEL_ROLES.map((role) => (
            <div key={role.id} className="grid gap-4 rounded-lg border border-border bg-muted/20 p-4 lg:grid-cols-12">
              <div className="space-y-1 lg:col-span-4">
                <div className="text-sm font-semibold text-foreground">{role.label}</div>
                <p className="text-xs text-muted-foreground">{role.description}</p>
              </div>

              <div className="space-y-2 lg:col-span-5">
                <Label>Modelo</Label>
                <Select
                  value={decisionModels[role.id].model}
                  onValueChange={(value) => updateDecisionModel(role.id, { model: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um modelo" />
                  </SelectTrigger>
                  <SelectContent>
                    {decisionModelOptions.map((model) => (
                      <SelectItem key={`${role.id}-${model.id}`} value={model.id}>
                        {model.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2 lg:col-span-3">
                <Label>Timeout (ms)</Label>
                <Input
                  type="number"
                  min={500}
                  max={15000}
                  step={100}
                  value={decisionModels[role.id].timeoutMs}
                  onChange={(event) => updateDecisionModel(role.id, {
                    timeoutMs: Number.parseInt(event.target.value, 10) || role.defaultTimeoutMs,
                  })}
                />
              </div>
            </div>
          ))}

          <div className="flex justify-end">
            <Button onClick={handleSaveDecisionModels} disabled={savingDecisionModels || !isDecisionDirty}>
              {savingDecisionModels ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Salvar modelos de decisao
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card shadow-sm">
        <CardHeader>
          <CardTitle>LM Studio Global</CardTitle>
          <CardDescription>
            Configure o servidor OpenAI-compatible usado pelos modelos `lmstudio/...`. Somente superadmins acessam estes dados.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-12">
          <div className="space-y-2 lg:col-span-7">
            <Label htmlFor="lm-studio-base-url">Endpoint</Label>
            <Input
              id="lm-studio-base-url"
              value={lmStudioBaseUrl}
              onChange={(event) => setLmStudioBaseUrl(event.target.value)}
              placeholder="Ex: http://host.docker.internal:1234/v1"
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-2 lg:col-span-5">
            <Label htmlFor="lm-studio-api-token">Token</Label>
            <Input
              id="lm-studio-api-token"
              type="password"
              value={lmStudioApiToken}
              onChange={(event) => setLmStudioApiToken(event.target.value)}
              placeholder="Opcional quando a autenticacao estiver desativada"
              className="font-mono text-xs"
            />
          </div>
          <div className="flex flex-wrap gap-3 lg:col-span-12">
            <Button onClick={handleSaveLmStudio} disabled={savingLmStudio || !isLmStudioDirty}>
              {savingLmStudio ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Salvar LM Studio
            </Button>
            <Button type="button" variant="outline" onClick={handleSyncLmStudio} disabled={syncingLmStudio || isLmStudioDirty}>
              {syncingLmStudio ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Sincronizar modelos
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4">
        {models.map((model, index) => {
          const supported = isAutopilotRuntimeSupportedModel(model);

          return (
            <Card key={`${model.id || 'new'}-${index}`} className="overflow-hidden border-border bg-card shadow-sm">
              <CardHeader className="border-b border-border/60 bg-muted/30">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-base text-foreground">
                      {model.label?.trim() || `Modelo ${index + 1}`}
                    </CardTitle>
                    <CardDescription>
                      {supported
                        ? 'Disponível no Autopilot atual.'
                        : 'Cadastrado no catálogo, mas indisponível no runtime atual.'}
                    </CardDescription>
                  </div>

                  <div className="flex items-center gap-2">
                    <Badge
                      variant={supported ? 'secondary' : 'outline'}
                      className={cn('rounded-full px-3 py-1', supported && 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300')}
                    >
                      {supported ? 'Suportado' : 'Pendente de runtime'}
                    </Badge>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="rounded-full text-muted-foreground hover:text-destructive"
                      onClick={() => removeModel(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="grid gap-4 p-6 lg:grid-cols-12">
                <div className="space-y-2 lg:col-span-4">
                  <Label>Rótulo</Label>
                  <Input
                    value={model.label}
                    onChange={(event) => updateModel(index, { label: event.target.value })}
                    placeholder="Ex: Gemini 2.0 Flash Lite"
                  />
                </div>

                <div className="space-y-2 lg:col-span-4">
                  <Label>ID do modelo</Label>
                  <Input
                    value={model.id}
                    onChange={(event) => updateModel(index, { id: event.target.value })}
                    placeholder={model.provider === 'lmstudio' ? 'Ex: google/gemma-4-e4b' : model.provider === 'deepseek' ? 'Ex: deepseek-flash' : model.provider === 'codex' ? 'Ex: gpt-5.3-codex' : model.provider === 'openai' ? 'Ex: gpt-5.5' : 'Ex: googleai/gemini-2.5-flash-lite'}
                    className="font-mono text-xs"
                  />
                </div>

                <div className="space-y-2 lg:col-span-2">
                  <Label>Provider</Label>
                  <Select
                    value={model.provider}
                    onValueChange={(value) => updateModel(index, { provider: value as AiModelProvider })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PROVIDERS.map((provider) => (
                        <SelectItem key={provider} value={provider}>
                          {getAiModelProviderLabel(provider)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between rounded-2xl border border-border bg-muted/30 px-4 py-3 lg:col-span-2">
                  <div className="space-y-0.5">
                    <div className="text-sm font-medium text-foreground">Ativo</div>
                    <div className="text-xs text-muted-foreground">Exibe no catálogo</div>
                  </div>
                  <Switch checked={model.enabled} onCheckedChange={(checked) => updateModel(index, { enabled: checked })} />
                </div>

                <div className="space-y-2 lg:col-span-12">
                  <Label>Descrição</Label>
                  <Input
                    value={model.description || ''}
                    onChange={(event) => updateModel(index, { description: event.target.value })}
                    placeholder="Ex: Mais rápido para atendimento, mais barato, experimental..."
                  />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
