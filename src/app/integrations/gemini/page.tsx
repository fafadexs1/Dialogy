'use client';

import React, { useEffect, useState } from 'react';
import { ArrowLeft, ExternalLink, Loader2, Save } from 'lucide-react';
import Link from 'next/link';

import { getAiModelCatalogAction } from '@/actions/ai-models';
import { getIntegrationConfig, saveIntegrationConfig } from '@/actions/integrations';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { useCurrentUser } from '@/hooks/use-online-status';
import {
  DEFAULT_AUTOPILOT_MODEL,
  getWorkspaceGeminiSelectableModels,
  normalizeGoogleAiModelId,
  type AiModelCatalogEntry,
} from '@/lib/ai-models';

export default function GeminiIntegrationPage() {
  const user = useCurrentUser();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(DEFAULT_AUTOPILOT_MODEL);
  const [customModel, setCustomModel] = useState('');
  const [modelOptions, setModelOptions] = useState<AiModelCatalogEntry[]>([]);

  useEffect(() => {
    async function loadConfig() {
      if (!user?.activeWorkspaceId) return;

      try {
        const [{ config }, catalogResult] = await Promise.all([
          getIntegrationConfig(user.activeWorkspaceId, 'gemini'),
          getAiModelCatalogAction(),
        ]);
        const selectableModels = getWorkspaceGeminiSelectableModels(catalogResult.models);
        setModelOptions(selectableModels);
        const defaultModel = selectableModels.some((item) => item.id === DEFAULT_AUTOPILOT_MODEL)
          ? DEFAULT_AUTOPILOT_MODEL
          : selectableModels[0]?.id || DEFAULT_AUTOPILOT_MODEL;

        if (config) {
          setApiKey(config.apiKey || '');

          const currentModel = normalizeGoogleAiModelId(config.aiModel) || defaultModel;
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
        console.error('Erro ao carregar configuracao:', error);
        toast({ title: 'Erro', description: 'Nao foi possivel carregar as configuracoes.', variant: 'destructive' });
      } finally {
        setLoading(false);
      }
    }

    loadConfig();
  }, [user?.activeWorkspaceId]);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
      if (!user?.activeWorkspaceId) return;

    setSaving(true);
    try {
      const finalModel = normalizeGoogleAiModelId(model === 'custom' ? customModel : model);
      if (!finalModel) {
        toast({ title: 'Modelo obrigatorio', description: 'Selecione ou informe um modelo Gemini.', variant: 'destructive' });
        return;
      }
      const result = await saveIntegrationConfig(
        user.activeWorkspaceId,
        'gemini',
        {
          apiKey,
          aiModel: finalModel,
        },
        true
      );

      if (result.success) {
        toast({ title: 'Configuracoes salvas!', description: 'Sua integracao com o Gemini foi atualizada.' });
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
            <h1 className="text-2xl font-bold">Google Gemini</h1>
            <p className="text-muted-foreground">Configure a inteligencia artificial do Google para suas respostas inteligentes.</p>
          </div>
        </div>

        <Card>
          <form onSubmit={handleSave}>
            <CardHeader>
              <CardTitle>Configuracao da API</CardTitle>
              <CardDescription>
                Configure a chave de API da sua organizacao para ativar o Gemini.
                <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center text-primary hover:underline">
                  Obter chave <ExternalLink className="ml-1 h-3 w-3" />
                </a>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="apiKey">Chave de API do Workspace</Label>
                <Input
                  id="apiKey"
                  type="password"
                  placeholder="Ex: AIzaSy..."
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Esta chave sera usada por todos os membros do workspace para gerar respostas inteligentes.
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
                      placeholder="Ex: gemini-2.5-flash"
                      value={customModel}
                      onChange={(event) => setCustomModel(event.target.value)}
                      className="mt-1"
                    />
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  A lista exibe os modelos Gemini habilitados pelo superadmin. Escolha "Outro" para digitar um ID Google especifico.
                  <a href="https://ai.google.dev/gemini-api/docs/models/gemini" target="_blank" rel="noreferrer" className="ml-1 text-primary hover:underline">
                    Ver lista de modelos
                  </a>
                </p>
              </div>
            </CardContent>
            <CardFooter className="flex justify-end border-t bg-muted/20 p-4">
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
