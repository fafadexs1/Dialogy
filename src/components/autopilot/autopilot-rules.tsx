import Link from 'next/link';
import { Edit, Loader2, MessageCircle, Plus, Save, Server, Trash2, Webhook, Wrench, Zap } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import type { NexusFlowInstance } from '@/lib/types';
import { cn } from '@/lib/utils';

type AgentToolCatalogItem = {
  name: string;
  version: string;
  description: string;
  class: string;
  riskLevel: 'low' | 'medium' | 'high';
  requiresHumanApproval: boolean;
  enabledByDefault: boolean;
  source: 'dialogy' | 'mcp';
  serverId?: string;
  serverName?: string;
};

interface AutopilotRulesProps {
  rules: NexusFlowInstance[];
  toolCatalog: AgentToolCatalogItem[];
  enabledToolNames: string[];
  setEnabledToolNames: (toolNames: string[]) => void;
  onSaveTools: () => void;
  isSavingTools: boolean;
  onAdd: () => void;
  onEdit: (rule: NexusFlowInstance) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
}

function getRuleActionSummary(rule: NexusFlowInstance) {
  if (rule.action.type === 'reply') {
    return rule.action.value || 'Resposta textual configurada.';
  }

  const method = rule.action.method || 'POST';
  const url = rule.action.url || 'Webhook sem URL definida';
  return `${method} ${url}`;
}

function groupMcpToolsByServer(tools: AgentToolCatalogItem[]) {
  return tools.reduce<Array<{ serverId: string; serverName: string; tools: AgentToolCatalogItem[] }>>((groups, tool) => {
    const serverId = tool.serverId || 'unknown';
    const serverName = tool.serverName || 'Servidor MCP';
    const existing = groups.find((group) => group.serverId === serverId);
    if (existing) {
      existing.tools.push(tool);
      return groups;
    }
    groups.push({ serverId, serverName, tools: [tool] });
    return groups;
  }, []);
}

export function AutopilotRules({
  rules,
  toolCatalog,
  enabledToolNames,
  setEnabledToolNames,
  onSaveTools,
  isSavingTools,
  onAdd,
  onEdit,
  onDelete,
  onToggle,
}: AutopilotRulesProps) {
  const enabledToolSet = new Set(enabledToolNames);
  const mcpTools = toolCatalog.filter((tool) => tool.source === 'mcp');
  const mcpToolGroups = groupMcpToolsByServer(mcpTools);

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden rounded-[28px] border border-border bg-card shadow-sm">
        <CardContent className="grid gap-5 p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-primary">
                <Wrench className="h-3.5 w-3.5" />
                Ferramentas MCP
              </div>
              <div>
                <h2 className="text-xl font-semibold text-foreground">Servidores e tools do agente</h2>
                <p className="text-sm text-muted-foreground">
                  Habilite aqui quais tools MCP este agente pode chamar durante o atendimento.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="outline" className="rounded-full">
                {mcpTools.filter((tool) => enabledToolSet.has(tool.name)).length} MCP ativas
              </Badge>
              <Button onClick={onSaveTools} disabled={isSavingTools} className="rounded-full">
                {isSavingTools ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Salvar tools
              </Button>
            </div>
          </div>

          {mcpToolGroups.length > 0 ? (
            <div className="grid gap-4">
              {mcpToolGroups.map((group) => (
                <div key={group.serverId} className="rounded-[24px] border border-border bg-muted/20 p-4">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-background text-primary shadow-sm">
                        <Server className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-foreground">{group.serverName}</div>
                        <div className="text-xs text-muted-foreground">{group.tools.length} tool(s) sincronizada(s)</div>
                      </div>
                    </div>
                    <Button asChild variant="outline" size="sm" className="rounded-full">
                      <Link href="/integrations/mcp">Gerenciar servidor</Link>
                    </Button>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    {group.tools.map((tool) => {
                      const checked = enabledToolSet.has(tool.name);
                      return (
                        <div key={tool.name} className="flex items-start justify-between gap-4 rounded-2xl border border-border bg-background/80 px-4 py-4">
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate font-mono text-xs font-semibold text-foreground">{tool.name}</span>
                              <Badge variant={tool.riskLevel === 'high' ? 'destructive' : 'outline'} className="rounded-full text-[10px]">
                                {tool.riskLevel}
                              </Badge>
                            </div>
                            <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">{tool.description}</p>
                          </div>
                          <Switch
                            checked={checked}
                            onCheckedChange={(nextChecked) => {
                              setEnabledToolNames(
                                nextChecked
                                  ? Array.from(new Set([...enabledToolNames, tool.name]))
                                  : enabledToolNames.filter((name) => name !== tool.name)
                              );
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-[24px] border border-dashed border-border bg-muted/20 p-6 text-center">
              <Server className="mx-auto h-10 w-10 text-muted-foreground/50" />
              <h3 className="mt-3 text-base font-semibold text-foreground">Nenhuma tool MCP sincronizada</h3>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                Cadastre um servidor em Integrações &gt; MCP, sincronize as tools e volte aqui para habilitar no agente.
              </p>
              <Button asChild className="mt-4 rounded-full">
                <Link href="/integrations/mcp">Abrir integração MCP</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden rounded-[28px] border border-border bg-card shadow-sm">
        <CardContent className="flex flex-col gap-4 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
              <Zap className="h-3.5 w-3.5" />
              Automação operacional
            </div>
            <div>
              <h2 className="text-xl font-semibold text-foreground">Habilidades e regras</h2>
              <p className="text-sm text-muted-foreground">
                Configure gatilhos específicos para respostas dirigidas ou integrações por webhook.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="outline" className="rounded-full">
              {rules.filter((rule) => rule.enabled).length} ativas
            </Badge>
            <Button onClick={onAdd} className="rounded-full">
              <Plus className="mr-2 h-4 w-4" />
              Nova regra
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {rules.map((rule) => (
          <Card
            key={rule.id}
            className="group relative min-w-0 overflow-hidden rounded-[26px] border border-border bg-card shadow-sm transition-all duration-200 hover:border-primary/35 hover:shadow-lg"
          >
            <div
              className={cn(
                'absolute left-0 top-0 h-full w-1',
                rule.enabled ? 'bg-emerald-500' : 'bg-muted'
              )}
            />

            <CardContent className="grid gap-5 p-5 pl-6">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <Badge
                      variant={rule.enabled ? 'secondary' : 'outline'}
                      className={cn(
                        'rounded-full px-3 py-1',
                        rule.enabled && 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      )}
                    >
                      {rule.enabled ? 'Ativa' : 'Pausada'}
                    </Badge>
                    {rule.action.type === 'reply' ? (
                      <Badge variant="outline" className="gap-1 rounded-full border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300">
                        <MessageCircle className="h-3 w-3" />
                        Resposta
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1 rounded-full border-violet-500/20 bg-violet-500/10 text-violet-700 dark:text-violet-300">
                        <Webhook className="h-3 w-3" />
                        Webhook
                      </Badge>
                    )}
                  </div>

                  <h3 className="truncate text-base font-semibold text-foreground" title={rule.name}>
                    {rule.name}
                  </h3>
                </div>

                <Switch checked={rule.enabled} onCheckedChange={(checked) => onToggle(rule.id, checked)} />
              </div>

              <div className="rounded-2xl border border-border bg-muted/30 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Gatilho</div>
                <p className="mt-2 line-clamp-3 text-sm leading-6 text-foreground">
                  Quando o cliente disser algo parecido com "{rule.trigger}"
                </p>
              </div>

              <div className="rounded-2xl border border-border bg-background/80 px-4 py-4">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Ação configurada</div>
                <p className="mt-2 line-clamp-3 break-words text-sm leading-6 text-foreground">
                  {getRuleActionSummary(rule)}
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-border/60 pt-4 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100">
                <Button size="sm" variant="outline" className="rounded-full" onClick={() => onEdit(rule)}>
                  <Edit className="mr-2 h-4 w-4" />
                  Editar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="rounded-full text-destructive hover:text-destructive"
                  onClick={() => onDelete(rule.id)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Excluir
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}

        <button
          type="button"
          onClick={onAdd}
          className="flex min-h-[260px] flex-col items-center justify-center rounded-[26px] border-2 border-dashed border-border bg-muted/20 p-6 text-center text-muted-foreground transition-all hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-background shadow-sm">
            <Plus className="h-6 w-6" />
          </div>
          <p className="mt-5 text-base font-semibold">Criar nova habilidade</p>
          <p className="mt-2 max-w-xs text-sm leading-6">
            Adicione gatilhos para atendimento guiado, respostas imediatas ou integração com sistemas externos.
          </p>
        </button>
      </div>

      {rules.length === 0 && (
        <Card className="overflow-hidden rounded-[28px] border border-dashed border-border bg-card shadow-sm">
          <CardContent className="flex flex-col items-center justify-center px-6 py-12 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-muted text-muted-foreground">
              <Zap className="h-7 w-7" />
            </div>
            <h3 className="mt-5 text-lg font-semibold text-foreground">Nenhuma regra criada</h3>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              O agente ainda está operando apenas com prompt e base de conhecimento. Use regras quando quiser respostas
              determinísticas para cenários específicos.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
