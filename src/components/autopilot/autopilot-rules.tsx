import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Plus, Zap, MessageCircle, Webhook, Trash2, Edit } from 'lucide-react';
import type { NexusFlowInstance } from '@/lib/types';
import { cn } from '@/lib/utils';

interface AutopilotRulesProps {
    rules: NexusFlowInstance[];
    onAdd: () => void;
    onEdit: (rule: NexusFlowInstance) => void;
    onDelete: (id: string) => void;
    onToggle: (id: string, enabled: boolean) => void;
}

export function AutopilotRules({ rules, onAdd, onEdit, onDelete, onToggle }: AutopilotRulesProps) {
    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                        <Zap className="h-5 w-5 text-amber-500" />
                        Habilidades & Regras
                    </h2>
                    <p className="text-sm text-muted-foreground">Ensine o agente a reagir a palavras-chave específicas.</p>
                </div>
                <Button onClick={onAdd} className="gap-2">
                    <Plus className="h-4 w-4" /> Nova Regra
                </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {rules.map((rule) => (
                    <Card key={rule.id} className="relative group overflow-hidden border-muted hover:border-primary/50 transition-all">
                        <div className={cn(
                            "absolute top-0 left-0 w-1 h-full",
                            rule.enabled ? "bg-emerald-500" : "bg-muted"
                        )} />
                        <CardHeader className="pb-2 pl-6">
                            <div className="flex justify-between items-start">
                                <CardTitle className="text-base truncate pr-2" title={rule.name}>
                                    {rule.name}
                                </CardTitle>
                                <Switch
                                    checked={rule.enabled}
                                    onCheckedChange={(checked) => onToggle(rule.id, checked)}
                                />
                            </div>
                            <CardDescription className="line-clamp-2 text-xs h-8">
                                Se cliente disser: <span className="text-foreground italic">"{rule.trigger}"</span>
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="pl-6 pt-2 pb-4">
                            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
                                {rule.action.type === 'reply' ? (
                                    <Badge variant="outline" className="gap-1 bg-blue-500/10 text-blue-500 border-blue-500/20">
                                        <MessageCircle className="h-3 w-3" /> Responde
                                    </Badge>
                                ) : (
                                    <Badge variant="outline" className="gap-1 bg-purple-500/10 text-purple-500 border-purple-500/20">
                                        <Webhook className="h-3 w-3" /> Integração
                                    </Badge>
                                )}
                            </div>

                            <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity justify-end">
                                <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => onEdit(rule)}>
                                    <Edit className="h-4 w-4" />
                                </Button>
                                <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive hover:text-destructive" onClick={() => onDelete(rule.id)}>
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                ))}

                {/* Add New Card Button */}
                <button
                    onClick={onAdd}
                    className="flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-6 text-muted-foreground hover:text-primary hover:border-primary/50 hover:bg-primary/5 transition-all min-h-[180px]"
                >
                    <div className="h-12 w-12 rounded-full bg-muted/50 flex items-center justify-center mb-4 group-hover:bg-primary/10">
                        <Plus className="h-6 w-6" />
                    </div>
                    <p className="font-medium">Criar nova habilidade</p>
                </button>
            </div>
        </div>
    );
}
