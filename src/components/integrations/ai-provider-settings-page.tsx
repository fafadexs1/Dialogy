'use client';

import React, { useEffect, useState } from 'react';
import { Activity, AlertTriangle, ArrowLeft, CheckCircle2, ExternalLink, Loader2, Save } from 'lucide-react';
import Link from 'next/link';

import { getAiModelCatalogAction } from '@/actions/ai-models';
import {
  getIntegrationConfig,
  saveIntegrationConfig,
  testAiProviderConnectionAction,
  type AiProviderConnectionTestResult,
} from '@/actions/integrations';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { useCurrentUser } from '@/hooks/use-online-status';
import {
  getWorkspaceProviderSelectableModels,
  type AiModelCatalogEntry,
  type AiModelProvider,
} from '@/lib/ai-models';

type AiProviderSettingsPageProps = {
  provider: 'openai' | 'deepseek';
  title: string;
  description: string;
  keyLabel: string;
  keyPlaceholder: string;
  keyHref: string;
  docsHref: string;
  selectableProviders: AiModelProvider[];
  defaultModel: string;
  customModelPlaceholder: string;
};

const KEY_SOURCE_LABEL: Record<AiProviderConnectionTestResult['keySource'], string> = {
  'current-form': 'campo atual',
  workspace: 'workspace',
  environment: 'ambiente',
  missing: 'nao configurada',
};

function normalizeProviderModelId(
  model: string,
  provider: AiProviderSettingsPageProps['provider'],
): string | null {
  const normalized = model.trim();
  if (!normalized) return null;
  if (provider === 'deepseek') {
    if (normalized.startsWith('deepseek/')) return normalized;
    if (normalized.includes('/')) return null;
    return `deepseek/${normalized}`;
  }

  if (normalized.startsWith('openai/') || normalized.startsWith('codex/')) return normalized;
  if (normalized.includes('/')) return null;
  return `openai/${normalized}`;
}

export function AiProviderSettingsPage(props: AiProviderSettingsPageProps) {
  const user = useCurrentUser();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(props.defaultModel);
  const [customModel, setCustomModel] = useState('');
  const [modelOptions, setModelOptions] = useState<AiModelCatalogEntry[]>([]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AiProviderConnectionTestResult | null>(null);

  useEffect(() => {
    async function loadConfig() {
      if (!user?.activeWorkspaceId) return;

      try {
        const [{ config }, catalogResult] = await Promise.all([
          getIntegrationConfig(user.activeWorkspaceId, props.provider),
          getAiModelCatalogAction(),
        ]);
        const selectableModels = getWorkspaceProviderSelectableModels(catalogResult.models, props.selectableProviders);
        setModelOptions(selectableModels);
        const defaultModel = selectableModels.some((item) => item.id === props.defaultModel)
          ? props.defaultModel
          : selectableModels[0]?.id || props.defaultModel;

        if (config) {
          setApiKey(config.apiKey || '');

          const currentModel = normalizeProviderModelId(config.aiModel || '', props.provider) || defaultModel;
          const isKnownModel = selectableModels.some((item) => item.id === currentModel);

          if (isKnownModel) {
            setModel(currentModel);
          } else {
            setModel('custom');
            setCustomModel(currentModel);
          }
        } else {
          setModel(defaultModel);
        }
      } catch (error) {
        console.error('[AI_PROVIDER_SETTINGS] Failed to load config:', error);
        toast({ title: 'Erro', description: 'Nao foi possivel carregar as configuracoes.', variant: 'destructive' });
      } finally {
        setLoading(false);
      }
    }

    loadConfig();
  }, [props.defaultModel, props.provider, props.selectableProviders, user?.activeWorkspaceId]);

  const resolveFinalModel = () => normalizeProviderModelId(
    model === 'custom' ? customModel : model,
    props.provider,
  );

  const handleTestConnection = async () => {
    if (!user?.activeWorkspaceId) return;

    const finalModel = resolveFinalModel();
    if (!finalModel) {
      toast({ title: 'Modelo obrigatorio', description: 'Selecione ou informe um modelo valido.', variant: 'destructive' });
      return;
    }

    setTesting(true);
    setTestResult(null);
    try {
      const result = await testAiProviderConnectionAction({
        workspaceId: user.activeWorkspaceId,
        provider: props.provider,
        apiKey,
        model: finalModel,
      });
      setTestResult(result);
      toast({
        title: result.ok ? 'Conexao validada' : 'Falha no teste',
        description: result.ok ? `${props.title} respondeu corretamente.` : result.message,
        variant: result.ok ? 'default' : 'destructive',
      });
    } catch {
      toast({ title: 'Erro inesperado', description: 'Nao foi possivel testar este provedor.', variant: 'destructive' });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user?.activeWorkspaceId) return;

    const finalModel = resolveFinalModel();
    if (!finalModel) {
      toast({ title: 'Modelo obrigatorio', description: 'Selecione ou informe um modelo valido.', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {

      const result = await saveIntegrationConfig(
        user.activeWorkspaceId,
        props.provider,
        {
          apiKey,
          aiModel: finalModel,
        },
        true,
      );

      if (result.success) {
        toast({ title: 'Configuracoes salvas!', description: `${props.title} foi atualizado para este workspace.` });
      } else {
        toast({ title: 'Erro ao salvar', description: result.error, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Erro inesperado', description: 'Ocorreu um erro ao salvar as configuracoes.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-muted/40 p-4 sm:p-6">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/integrations">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">{props.title}</h1>
            <p className="text-muted-foreground">{props.description}</p>
          </div>
        </div>

        <Card>
          <form onSubmit={handleSave}>
            <CardHeader>
              <CardTitle>Configuracao da API</CardTitle>
              <CardDescription>
                Configure a chave de API da sua organizacao para ativar este provedor.
                <a href={props.keyHref} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center text-primary hover:underline">
                  Obter chave <ExternalLink className="ml-1 h-3 w-3" />
                </a>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="apiKey">{props.keyLabel}</Label>
                <Input
                  id="apiKey"
                  type="password"
                  placeholder={props.keyPlaceholder}
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Esta chave sera usada pelo Autopilot deste workspace quando um modelo deste provedor for selecionado.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="model">Modelo de IA</Label>
                <Select value={model} onValueChange={setModel}>
                  <SelectTrigger id="model">
                    <SelectValue placeholder="Selecione um modelo" />
                  </SelectTrigger>
                  <SelectContent>
                    {modelOptions.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.label}
                      </SelectItem>
                    ))}
                    <SelectItem value="custom">Outro (Digitar ID do Modelo)</SelectItem>
                  </SelectContent>
                </Select>

                {model === 'custom' && (
                  <div className="mt-2">
                    <Label htmlFor="customModel" className="text-xs">ID do Modelo Personalizado</Label>
                    <Input
                      id="customModel"
                      placeholder={props.customModelPlaceholder}
                      value={customModel}
                      onChange={(event) => setCustomModel(event.target.value)}
                      className="mt-1"
                    />
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  A lista usa os modelos habilitados pelo superadmin.
                  <a href={props.docsHref} target="_blank" rel="noreferrer" className="ml-1 text-primary hover:underline">
                    Ver documentacao
                  </a>
                </p>
              </div>

              {testResult && (
                <Alert variant={testResult.ok ? 'default' : 'destructive'}>
                  {testResult.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                  <AlertTitle>{testResult.ok ? 'Conexao validada' : 'Falha no teste'}</AlertTitle>
                  <AlertDescription>
                    <span className="block">
                      Modelo: {testResult.model} · {testResult.durationMs}ms · chave: {KEY_SOURCE_LABEL[testResult.keySource]}
                    </span>
                    <span className="block">{testResult.message}</span>
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
            <CardFooter className="flex flex-col gap-3 border-t bg-muted/20 p-4 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={handleTestConnection} disabled={testing || saving}>
                {testing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {!testing && <Activity className="mr-2 h-4 w-4" />}
                Testar Conexao
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <Save className="mr-2 h-4 w-4" />
                Salvar Configuracoes
              </Button>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  );
}
