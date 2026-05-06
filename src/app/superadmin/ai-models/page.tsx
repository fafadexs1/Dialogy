'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Save, Sparkles, Trash2 } from 'lucide-react';

import { getAiModelCatalogAction, saveAiModelCatalogAction } from '@/actions/ai-models';
import {
  AiModelCatalogEntry,
  AiModelProvider,
  getAiModelProviderLabel,
  isAutopilotRuntimeSupportedModel,
} from '@/lib/ai-models';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const PROVIDERS: AiModelProvider[] = ['googleai', 'openai', 'anthropic', 'other'];

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
  const [models, setModels] = useState<AiModelCatalogEntry[]>([]);
  const [initialSignature, setInitialSignature] = useState('');

  useEffect(() => {
    getAiModelCatalogAction()
      .then((result) => {
        if (result.error) {
          toast({ title: 'Erro ao carregar', description: result.error, variant: 'destructive' });
          return;
        }
        setModels(result.models);
        setInitialSignature(JSON.stringify(result.models));
      })
      .finally(() => setLoading(false));
  }, []);

  const isDirty = useMemo(() => JSON.stringify(models) !== initialSignature, [initialSignature, models]);

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
                Gerencie quais modelos aparecem no Autopilot. O runtime atual suporta diretamente apenas entradas compatíveis com
                `googleai/...`; outros providers podem ser cadastrados agora e ativados quando o backend correspondente existir.
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
                    placeholder="Ex: googleai/gemini-2.0-flash-lite"
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
