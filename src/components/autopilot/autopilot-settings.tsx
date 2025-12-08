import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Loader2, Save, Settings2, MessageSquare } from 'lucide-react';
import { Workspace } from '@/lib/types';
import Link from 'next/link';

interface AutopilotSettingsProps {
    agentName: string;
    setAgentName: (name: string) => void;
    aiModel: string;
    setAiModel: (model: string) => void;
    knowledgeBase: string;
    setKnowledgeBase: (kb: string) => void;
    isActive: boolean;
    setIsActive: (active: boolean) => void;
    isPrivate: boolean;
    setIsPrivate: (privateAgent: boolean) => void;
    isPrimary: boolean;
    onSetPrimary: () => void;
    geminiApiKey: string;
    setGeminiApiKey?: (key: string) => void;
    hasGlobalKey?: boolean;
    onSave: () => void;
    isSaving: boolean;
    onDelete: () => void;
    workspace?: Workspace | null;
}

export function AutopilotSettings({
    agentName,
    setAgentName,
    aiModel,
    setAiModel,
    knowledgeBase,
    setKnowledgeBase,
    isActive,
    setIsActive,
    isPrivate,
    setIsPrivate,
    isPrimary,
    onSetPrimary,
    geminiApiKey,
    setGeminiApiKey,
    hasGlobalKey = false,
    onSave,
    isSaving,
    onDelete,
    workspace
}: AutopilotSettingsProps) {
    return (
        <div className="space-y-6">
            <Card className="p-6">
                <div className="flex items-center gap-4 mb-6">
                    <div className="p-3 bg-primary/10 rounded-xl">
                        <Settings2 className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                        <h2 className="text-xl font-semibold">Configurações Gerais</h2>
                        <p className="text-sm text-muted-foreground">Personalize a identidade e o comportamento.</p>
                    </div>
                </div>

                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label>Nome do Agente</Label>
                        <Input
                            value={agentName}
                            onChange={(e) => setAgentName(e.target.value)}
                            placeholder="Ex: Consultor de Vendas"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label>Modelo de IA</Label>
                        <Select value={aiModel} onValueChange={setAiModel}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="googleai/gemini-2.0-flash">
                                    <div className="flex flex-col">
                                        <span className="font-medium">Gemini 2.0 Flash</span>
                                        <span className="text-xs text-muted-foreground">Mais rápido e eficiente (Recomendado)</span>
                                    </div>
                                </SelectItem>
                                <SelectItem value="googleai/gemini-1.5-pro">
                                    <div className="flex flex-col">
                                        <span className="font-medium">Gemini 1.5 Pro</span>
                                        <span className="text-xs text-muted-foreground">Maior capacidade de raciocínio</span>
                                    </div>
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label>Definição do Agente (Persona)</Label>
                        <Textarea
                            value={knowledgeBase}
                            onChange={(e) => setKnowledgeBase(e.target.value)}
                            placeholder="Descreva quem é este agente, seu tom de voz e objetivo principal..."
                            className="min-h-[100px]"
                        />
                        <p className="text-xs text-muted-foreground">
                            Esta definição será usada como o prompt principal do sistema.
                        </p>
                    </div>

                    <div className="space-y-2">
                        <Label>Chave da API Gemini (Integração)</Label>
                        <Input
                            type="password"
                            value={geminiApiKey}
                            onChange={(e) => setGeminiApiKey && setGeminiApiKey(e.target.value)}
                            placeholder="Chave definida em Integrações"
                        />
                        <p className="text-xs text-muted-foreground">
                            Esta chave é sincronizada com a página de Integrações. Deixe em branco para usar a configuração global do servidor, se houver.
                        </p>
                    </div>

                    <div className="pt-4 border-t">
                        <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                                <Label className="text-base">Agente Ativo</Label>
                                <p className="text-sm text-muted-foreground">Quando desativado, o agente não responderá a mensagens.</p>
                            </div>
                            <Switch checked={isActive} onCheckedChange={setIsActive} />
                        </div>
                    </div>

                    <div className="pt-4 border-t">
                        <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                                <Label className="text-base">Agente Privado</Label>
                                <p className="text-sm text-muted-foreground">Se ativado, apenas você poderá ver e usar este agente.</p>
                            </div>
                            <Switch checked={isPrivate} onCheckedChange={setIsPrivate} />
                        </div>
                    </div>

                    <div className="pt-4 border-t">
                        <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                                <Label className="text-base">Agente Principal</Label>
                                <p className="text-sm text-muted-foreground">O agente padrão será usado se nenhum outro for específico para o usuário.</p>
                            </div>
                            <Switch
                                checked={isPrimary}
                                onCheckedChange={(checked) => {
                                    if (checked) onSetPrimary();
                                }}
                                disabled={isPrimary} // Cannot unset primary directly, another must take its place or be set
                            />
                        </div>
                    </div>
                </div>
            </Card>

            <Card className="p-6">
                <div className="flex items-center gap-4 mb-6">
                    <div className="p-3 bg-blue-500/10 rounded-xl">
                        <MessageSquare className="h-6 w-6 text-blue-500" />
                    </div>
                    <div>
                        <h2 className="text-xl font-semibold">Mensagens Globais</h2>
                        <p className="text-sm text-muted-foreground">Definidas nas configurações do workspace.</p>
                    </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                    <div className="p-4 bg-muted/30 rounded-lg border space-y-2">
                        <Label className="text-muted-foreground text-xs uppercase font-bold tracking-wider">Encerramento</Label>
                        <p className="text-sm italic text-foreground/80">"{workspace?.closeMessageTemplate || 'Não definida'}"</p>
                    </div>
                    <div className="p-4 bg-muted/30 rounded-lg border space-y-2">
                        <Label className="text-muted-foreground text-xs uppercase font-bold tracking-wider">Transferência</Label>
                        <p className="text-sm italic text-foreground/80">"{workspace?.transferTeamMessageTemplate || 'Não definida'}"</p>
                    </div>
                </div>
                <div className="mt-4 flex justify-end">
                    <Link href="/settings/workspace" className="text-sm font-medium text-primary hover:underline flex items-center gap-1">
                        Editar mensagens <span aria-hidden="true">&rarr;</span>
                    </Link>
                </div>
            </Card>

            <div className="flex justify-end gap-3 pt-4">
                <Button onClick={onSave} disabled={isSaving} className="min-w-[120px] shadow-md">
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Salvar Alterações
                </Button>
            </div>

            <Card className="p-6 border-red-200 bg-red-50/50 dark:bg-red-950/10">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-semibold text-red-600 dark:text-red-400">Zona de Perigo</h3>
                        <p className="text-sm text-muted-foreground">Excluir este agente removerá todas as suas configurações e regras.</p>
                    </div>
                    <Button variant="destructive" onClick={onDelete}>
                        Excluir Agente
                    </Button>
                </div>
            </Card>
        </div>
    );
}
