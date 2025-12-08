
'use client';

import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { Loader2, Save, ArrowLeft, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { getAutopilotConfig, saveAutopilotConfig, createAutopilotAgent } from '@/actions/autopilot';
import type { AutopilotConfig } from '@/lib/types';
import { useCurrentUser } from '@/hooks/use-online-status';

const GEMINI_MODELS = [
    { value: 'gemini-2.0-flash-exp', label: 'Gemini 2.0 Flash (Experimental)' },
    { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
    { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
    { value: 'gemini-1.0-pro', label: 'Gemini 1.0 Pro' },
    { value: 'custom', label: 'Outro (Digitar ID do Modelo)' },
];

export default function GeminiIntegrationPage() {
    const user = useCurrentUser();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [config, setConfig] = useState<AutopilotConfig | null>(null);
    const [apiKey, setApiKey] = useState('');
    const [model, setModel] = useState('gemini-2.0-flash-exp');
    const [customModel, setCustomModel] = useState('');

    useEffect(() => {
        async function loadConfig() {
            if (!user?.activeWorkspaceId) return;

            try {
                const res = await getAutopilotConfig(user.activeWorkspaceId);

                if (res.config) {
                    setConfig(res.config);
                    setApiKey(res.config.gemini_api_key || '');

                    const currentModel = res.config.ai_model || 'gemini-2.0-flash-exp';
                    const isKnownModel = GEMINI_MODELS.some(m => m.value === currentModel);

                    if (isKnownModel) {
                        setModel(currentModel);
                    } else {
                        setModel('custom');
                        setCustomModel(currentModel);
                    }
                } else {
                    const createRes = await createAutopilotAgent(user.activeWorkspaceId, 'Agente Gemini');
                    if (createRes.success && createRes.id) {
                        const newRes = await getAutopilotConfig(user.activeWorkspaceId, createRes.id);
                        if (newRes.config) {
                            setConfig(newRes.config);
                            setApiKey('');
                            setModel('gemini-2.0-flash-exp');
                        }
                    }
                }
            } catch (error) {
                console.error('Erro ao carregar configuração:', error);
                toast({ title: 'Erro', description: 'Não foi possível carregar as configurações.', variant: 'destructive' });
            } finally {
                setLoading(false);
            }
        }

        loadConfig();
    }, [user?.activeWorkspaceId]);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!config) return;

        setSaving(true);
        try {
            const formData = new FormData();
            formData.append('workspaceId', config.workspace_id);
            formData.append('configId', config.id);
            formData.append('geminiApiKey', apiKey);

            const finalModel = model === 'custom' ? customModel : model;
            formData.append('aiModel', finalModel);

            const result = await saveAutopilotConfig(null, formData);

            if (result.success) {
                toast({ title: 'Configurações salvas!', description: 'Sua integração com o Gemini foi atualizada.' });
            } else {
                toast({ title: 'Erro ao salvar', description: result.error, variant: 'destructive' });
            }
        } catch (error) {
            toast({ title: 'Erro inesperado', description: 'Ocorreu um erro ao salvar as configurações.', variant: 'destructive' });
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-muted/40 p-4 sm:p-6 overflow-y-auto">
            <div className="max-w-3xl mx-auto w-full space-y-6">
                <div className="flex items-center gap-4">
                    <Link href="/integrations">
                        <Button variant="ghost" size="icon">
                            <ArrowLeft className="h-4 w-4" />
                        </Button>
                    </Link>
                    <div>
                        <h1 className="text-2xl font-bold">Google Gemini</h1>
                        <p className="text-muted-foreground">Configure a inteligência artificial do Google para suas respostas inteligentes.</p>
                    </div>
                </div>

                <Card>
                    <form onSubmit={handleSave}>
                        <CardHeader>
                            <CardTitle>Configuração da API</CardTitle>
                            <CardDescription>
                                Configure a chave de API da sua organização para ativar o Gemini.
                                <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center ml-1">
                                    Obter chave <ExternalLink className="h-3 w-3 ml-1" />
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
                                    onChange={(e) => setApiKey(e.target.value)}
                                />
                                <p className="text-xs text-muted-foreground">
                                    Esta chave será usada por todos os membros do workspace para gerar respostas e transcrições.
                                </p>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="model">Modelo de IA</Label>
                                <Select value={model} onValueChange={setModel}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Selecione um modelo" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {GEMINI_MODELS.map((m) => (
                                            <SelectItem key={m.value} value={m.value}>
                                                {m.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>

                                {model === 'custom' && (
                                    <div className="mt-2">
                                        <Label htmlFor="customModel" className="text-xs">ID do Modelo Personalizado</Label>
                                        <Input
                                            id="customModel"
                                            placeholder="Ex: gemini-1.5-pro-002"
                                            value={customModel}
                                            onChange={(e) => setCustomModel(e.target.value)}
                                            className="mt-1"
                                        />
                                    </div>
                                )}

                                <p className="text-xs text-muted-foreground">
                                    Selecione um modelo da lista ou escolha "Outro" para digitar o ID de um modelo específico.
                                    <a href="https://ai.google.dev/gemini-api/docs/models/gemini" target="_blank" rel="noreferrer" className="text-primary hover:underline ml-1">
                                        Ver lista de modelos
                                    </a>
                                </p>
                            </div>
                        </CardContent>
                        <CardFooter className="flex justify-end border-t p-4 bg-muted/20">
                            <Button type="submit" disabled={saving}>
                                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                <Save className="mr-2 h-4 w-4" />
                                Salvar Configurações
                            </Button>
                        </CardFooter>
                    </form>
                </Card>
            </div>
        </div>
    );
}
