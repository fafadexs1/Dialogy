'use client';

import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { getGlobalAlertAction, saveGlobalAlertAction } from '@/actions/system-alerts';
import type { GlobalAlertConfig } from '@/lib/system-alerts';
import { Megaphone, Save, Info, AlertTriangle, CheckCircle2, AlertCircle, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function SuperAdminAlertsPage() {
    const { toast } = useToast();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [config, setConfig] = useState<GlobalAlertConfig>({
        active: false,
        message: '',
        color: 'yellow',
        linkUrl: ''
    });

    useEffect(() => {
        const fetchConfig = async () => {
            try {
                const data = await getGlobalAlertAction();
                setConfig(data);
            } catch (error) {
                console.error('Failed to load alert config:', error);
            } finally {
                setLoading(false);
            }
        };
        fetchConfig();
    }, []);

    const handleSave = async () => {
        setSaving(true);
        try {
            const res = await saveGlobalAlertAction(config);
            if (res.success) {
                toast({
                    title: 'Comunicado salvo',
                    description: 'O comunicado global foi atualizado com sucesso.',
                });
            } else {
                toast({
                    title: 'Erro',
                    description: res.error || 'Falha ao salvar o comunicado',
                    variant: 'destructive'
                });
            }
        } catch (error) {
            toast({
                title: 'Erro inesperado',
                description: 'Tente novamente.',
                variant: 'destructive'
            });
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <div className="p-8 text-center text-muted-foreground">Carregando configurações...</div>;
    }

    // Componente de preview simplificado para mostrar como ficará
    const RenderPreview = () => {
        if (!config.message) return <div className="text-muted-foreground text-sm italic">O preview aparecerá aqui...</div>;

        const colorStyles = {
            red: "bg-red-500/10 text-red-600 border-red-500/20 dark:text-red-400 dark:bg-red-500/10",
            yellow: "bg-yellow-500/10 text-yellow-700 border-yellow-500/20 dark:text-yellow-400 dark:bg-yellow-500/10",
            green: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-400 dark:bg-emerald-500/10",
            blue: "bg-blue-500/10 text-blue-700 border-blue-500/20 dark:text-blue-400 dark:bg-blue-500/10",
        };

        const IconMap = {
            red: AlertCircle,
            yellow: AlertTriangle,
            green: CheckCircle2,
            blue: Info
        };
        const Icon = IconMap[config.color];

        return (
            <div className={cn("flex w-full items-center justify-center border-y px-4 py-2 text-sm font-medium transition-colors", colorStyles[config.color])}>
                <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center">
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{config.message}</span>
                    {config.linkUrl ? (
                        <span className="inline-flex items-center gap-1 font-semibold underline underline-offset-4">
                            Saiba mais
                            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                        </span>
                    ) : null}
                </div>
            </div>
        );
    };

    return (
        <div className="flex-1 space-y-4 p-8 pt-6">
            <div className="flex items-center justify-between space-y-2">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Comunicado Global</h2>
                    <p className="text-muted-foreground">
                        Exiba um banner colorido no topo de todos os Inbox para alertar instabilidades (ex: Meta) ou novidades.
                    </p>
                </div>
                <div className="flex items-center space-x-2">
                    <Button onClick={handleSave} disabled={saving} className="gap-2">
                        <Save className="h-4 w-4" />
                        {saving ? 'Salvando...' : 'Salvar Alterações'}
                    </Button>
                </div>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Megaphone className="h-5 w-5 text-primary" />
                            Configurações do Alerta
                        </CardTitle>
                        <CardDescription>
                            Configure a mensagem, nível de severidade e se o alerta está ativo agora.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="flex flex-row items-center justify-between rounded-lg border p-4">
                            <div className="space-y-0.5">
                                <Label className="text-base">Habilitar Comunicado Global</Label>
                                <p className="text-sm text-muted-foreground">
                                    Se ativado, aparece para todos os atendentes.
                                </p>
                            </div>
                            <Switch
                                checked={config.active}
                                onCheckedChange={(val) => setConfig(prev => ({ ...prev, active: val }))}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>Mensagem do Alerta</Label>
                            <Textarea
                                placeholder="A API oficial do WhatsApp (Meta) está apresentando instabilidade..."
                                value={config.message}
                                onChange={(e) => setConfig(prev => ({ ...prev, message: e.target.value }))}
                                rows={3}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>Link para saber mais</Label>
                            <Input
                                placeholder="https://status.meta.com ou /status"
                                value={config.linkUrl}
                                onChange={(e) => setConfig(prev => ({ ...prev, linkUrl: e.target.value }))}
                            />
                            <p className="text-sm text-muted-foreground">
                                Opcional. Aceita URL completa com http(s) ou um caminho interno iniciado por /.
                            </p>
                        </div>

                        <div className="space-y-3">
                            <Label>Gravidade / Cor</Label>
                            <RadioGroup
                                value={config.color}
                                onValueChange={(val: any) => setConfig(prev => ({ ...prev, color: val }))}
                                className="flex flex-col space-y-1"
                            >
                                <div className="flex items-center space-x-2 rounded border p-2 mb-1 hover:bg-muted/50 transition-colors">
                                    <RadioGroupItem value="yellow" id="c-yellow" />
                                    <Label htmlFor="c-yellow" className="flex items-center gap-2 cursor-pointer w-full text-yellow-600 dark:text-yellow-400">
                                        <AlertTriangle className="h-4 w-4" /> Alerta / Instabilidade Menor (Amarelo)
                                    </Label>
                                </div>
                                <div className="flex items-center space-x-2 rounded border p-2 mb-1 hover:bg-muted/50 transition-colors">
                                    <RadioGroupItem value="red" id="c-red" />
                                    <Label htmlFor="c-red" className="flex items-center gap-2 cursor-pointer w-full text-red-600 dark:text-red-400">
                                        <AlertCircle className="h-4 w-4" /> Crítico / Indisponibilidade (Vermelho)
                                    </Label>
                                </div>
                                <div className="flex items-center space-x-2 rounded border p-2 mb-1 hover:bg-muted/50 transition-colors">
                                    <RadioGroupItem value="blue" id="c-blue" />
                                    <Label htmlFor="c-blue" className="flex items-center gap-2 cursor-pointer w-full text-blue-600 dark:text-blue-400">
                                        <Info className="h-4 w-4" /> Informativo / Manutenção Programada (Azul)
                                    </Label>
                                </div>
                                <div className="flex items-center space-x-2 rounded border p-2 mb-1 hover:bg-muted/50 transition-colors">
                                    <RadioGroupItem value="green" id="c-green" />
                                    <Label htmlFor="c-green" className="flex items-center gap-2 cursor-pointer w-full text-emerald-600 dark:text-emerald-400">
                                        <CheckCircle2 className="h-4 w-4" /> Sucesso / Retorno Operacional (Verde)
                                    </Label>
                                </div>
                            </RadioGroup>
                        </div>
                    </CardContent>
                </Card>

                <div className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Preview do Banner</CardTitle>
                            <CardDescription>
                                Como o alerta ficará centralizado no topo do Inbox.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="rounded-lg border bg-surface flex items-center justify-center min-h-[150px] relative overflow-hidden flex-col gap-4">
                                {/* Simulando a header do layout do inbox de forma muito básica */}
                                <div className="absolute top-0 w-full h-10 border-b flex items-center gap-2 px-2 bg-muted/20">
                                    <div className="w-4 h-4 rounded-full bg-slate-200 dark:bg-slate-700 ml-2"></div>
                                    <div className="w-16 h-3 rounded bg-slate-200 dark:bg-slate-700"></div>
                                </div>
                                
                                <div className="w-full mt-10">
                                    <RenderPreview />
                                </div>
                                
                                <div className="flex-1 opacity-20 filter grayscale text-xs p-4 pointer-events-none mt-2">
                                    Listagem dos chats...
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
