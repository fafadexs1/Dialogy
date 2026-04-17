import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
        <div className="space-y-6 max-w-4xl mx-auto">
            <Card className="border-0 shadow-sm bg-white overflow-hidden">
                <CardHeader className="border-b bg-slate-50/50 py-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-slate-900 rounded-lg text-white">
                            <Settings2 className="h-4 w-4" />
                        </div>
                        <div>
                            <CardTitle className="text-lg">Configurações Gerais</CardTitle>
                            <CardDescription>Identidade e comportamento principal do agente.</CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-6 space-y-6">
                    <div className="grid gap-6 md:grid-cols-2">
                        <div className="space-y-2">
                            <Label className="text-sm font-bold text-slate-900">Nome do Agente</Label>
                            <Input
                                value={agentName}
                                onChange={(e) => setAgentName(e.target.value)}
                                placeholder="Ex: Consultor de Vendas"
                                className="rounded-xl border-slate-200"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label className="text-sm font-bold text-slate-900">Modelo de IA</Label>
                            <Select value={aiModel} onValueChange={setAiModel}>
                                <SelectTrigger className="rounded-xl border-slate-200">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="rounded-xl">
                                    <SelectItem value="googleai/gemini-2.0-flash" className="rounded-lg">
                                        <div className="flex flex-col">
                                            <span className="font-bold">Gemini 2.0 Flash</span>
                                            <span className="text-[10px] text-slate-500 uppercase tracking-tighter">Equilibrado (Recomendado)</span>
                                        </div>
                                    </SelectItem>
                                    <SelectItem value="googleai/gemini-1.5-pro" className="rounded-lg">
                                        <div className="flex flex-col">
                                            <span className="font-bold">Gemini 1.5 Pro</span>
                                            <span className="text-[10px] text-slate-500 uppercase tracking-tighter">Alta capacidade</span>
                                        </div>
                                    </SelectItem>
                                    <SelectItem value="googleai/gemini-3-flash-preview" className="rounded-lg">
                                        <div className="flex flex-col">
                                            <span className="font-bold">Gemini 3 Flash</span>
                                            <span className="text-[10px] text-slate-500 uppercase tracking-tighter">Experimental</span>
                                        </div>
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label className="text-sm font-bold text-slate-900">Persona do Agente (Prompt de Sistema)</Label>
                        <Textarea
                            value={knowledgeBase}
                            onChange={(e) => setKnowledgeBase(e.target.value)}
                            placeholder="Descreva quem é este agente, seu tom de voz e como deve agir..."
                            className="min-h-[120px] rounded-xl border-slate-200 resize-none"
                        />
                        <p className="text-[11px] text-slate-500 italic">
                            Esta definição será usada como o núcleo da inteligência deste agente.
                        </p>
                    </div>

                    <div className="space-y-2">
                        <Label className="text-sm font-bold text-slate-900">Chave Gemini (Personalizada)</Label>
                        <Input
                            type="password"
                            value={geminiApiKey}
                            onChange={(e) => setGeminiApiKey && setGeminiApiKey(e.target.value)}
                            placeholder="Deixe vazio para usar a chave global"
                            className="rounded-xl border-slate-200"
                        />
                    </div>

                    <div className="grid gap-4 pt-4 border-t">
                        <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                            <div className="space-y-0.5">
                                <Label className="text-sm font-bold text-slate-900">Status do Agente</Label>
                                <p className="text-xs text-slate-500">Pausar interrompe todas as respostas da IA.</p>
                            </div>
                            <Switch checked={isActive} onCheckedChange={setIsActive} />
                        </div>

                        <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                            <div className="space-y-0.5">
                                <Label className="text-sm font-bold text-slate-900">Privacidade</Label>
                                <p className="text-xs text-slate-500">Agentes privados são visíveis apenas para você.</p>
                            </div>
                            <Switch checked={isPrivate} onCheckedChange={setIsPrivate} />
                        </div>

                        <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                            <div className="space-y-0.5">
                                <Label className="text-sm font-bold text-slate-900">Agente Principal</Label>
                                <p className="text-xs text-slate-500">O padrão será usado se nenhum outro for especificado.</p>
                            </div>
                            <Switch
                                checked={isPrimary}
                                onCheckedChange={(checked) => checked && onSetPrimary()}
                                disabled={isPrimary}
                            />
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card className="border-0 shadow-sm bg-white overflow-hidden">
                <CardHeader className="border-b bg-slate-50/50 py-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-600 rounded-lg text-white">
                            <MessageSquare className="h-4 w-4" />
                        </div>
                        <div>
                            <CardTitle className="text-lg">Mensagens Globais</CardTitle>
                            <CardDescription>Configuradas no nível do Workspace.</CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-6">
                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 space-y-2">
                            <Label className="text-[10px] uppercase font-bold text-slate-400">Encerramento</Label>
                            <p className="text-sm text-slate-700 italic">"{workspace?.closeMessageTemplate || 'Não definida'}"</p>
                        </div>
                        <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 space-y-2">
                            <Label className="text-[10px] uppercase font-bold text-slate-400">Transferência</Label>
                            <p className="text-sm text-slate-700 italic">"{workspace?.transferTeamMessageTemplate || 'Não definida'}"</p>
                        </div>
                    </div>
                    <div className="mt-4 flex justify-end">
                        <Link href="/settings/workspace" className="text-xs font-bold text-teal-600 hover:underline">
                            Editar Mensagens do Workspace &rarr;
                        </Link>
                    </div>
                </CardContent>
            </Card>

            <Card className="border-red-100 bg-red-50/30 overflow-hidden">
                <CardContent className="p-6">
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                        <div className="text-center sm:text-left">
                            <h3 className="text-base font-bold text-red-700 flex items-center justify-center sm:justify-start gap-2">
                                Zona de Perigo
                            </h3>
                            <p className="text-xs text-red-600/80">
                                A remoção do agente é permanente e apaga todo o conhecimento indexado.
                            </p>
                        </div>
                        <Button variant="destructive" onClick={onDelete} className="rounded-full px-8 shadow-sm">
                            Excluir Este Agente
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

