import { Bot, Plus, ShieldCheck, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { AutopilotConfig } from '@/lib/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface AutopilotHeaderProps {
    agents: AutopilotConfig[];
    selectedAgentId: string | null;
    onAgentSelect: (id: string) => void;
    onCreateAgent: () => void;
}

export function AutopilotHeader({ agents, selectedAgentId, onAgentSelect, onCreateAgent }: AutopilotHeaderProps) {
    const selectedAgent = agents.find(a => a.id === selectedAgentId);

    return (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 border-b bg-background/50 backdrop-blur-sm sticky top-0 z-10">
            <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                    <Bot className="h-6 w-6 text-white" />
                </div>
                <div>
                    <h1 className="text-xl font-bold flex items-center gap-2">
                        {selectedAgent ? selectedAgent.name : 'Agente de IA'}
                        {selectedAgent?.is_primary && (
                            <Badge variant="secondary" className="gap-1 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 border-emerald-500/20">
                                <ShieldCheck className="h-3 w-3" /> Principal
                            </Badge>
                        )}
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        {selectedAgentId
                            ? 'Gerencie o comportamento e conhecimento do seu agente.'
                            : 'Selecione ou crie um agente para começar.'}
                    </p>
                </div>
            </div>

            <div className="flex items-center gap-2">
                <Select
                    value={selectedAgentId || ''}
                    onValueChange={onAgentSelect}
                >
                    <SelectTrigger className="w-[200px] h-9">
                        <SelectValue placeholder="Selecionar Agente..." />
                    </SelectTrigger>
                    <SelectContent>
                        {agents.length === 0 ? (
                            <SelectItem value="no-agent" disabled>Nenhum agente</SelectItem>
                        ) : (
                            agents.map(agent => (
                                <SelectItem key={agent.id} value={agent.id}>
                                    {agent.name} {agent.is_primary ? '(Principal)' : ''}
                                </SelectItem>
                            ))
                        )}
                    </SelectContent>
                </Select>
                <Button onClick={onCreateAgent} size="sm" className="gap-2">
                    <Plus className="h-4 w-4" />
                    Novo Agente
                </Button>
            </div>
        </div>
    );
}
