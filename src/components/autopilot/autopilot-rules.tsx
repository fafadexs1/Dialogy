import { useState } from 'react';
import Link from 'next/link';
import { Edit, Loader2, MessageCircle, Plus, Save, Server, Trash2, Webhook, Wrench, Zap } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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

type ToolGroup = {
  id: string;
  title: string;
  eyebrow: string;
  description: string;
  tools: AgentToolCatalogItem[];
  source: 'dialogy' | 'mcp';
  href?: string;
};

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

function buildInternalToolGroups(tools: AgentToolCatalogItem[]): ToolGroup[] {
  const groupDefinitions = [
    {
      id: 'internal-attendance',
      title: 'Atendimento',
      eyebrow: 'Ferramentas internas',
      description: 'Transferir, encerrar conversa e registrar notas internas no atendimento atual.',
      names: ['transfer_chat', 'close_chat', 'add_internal_note'],
    },
    {
      id: 'internal-crm',
      title: 'CRM',
      eyebrow: 'Ferramentas internas',
      description: 'Atualizar dados operacionais do contato vinculado ao chat.',
      names: ['crm_update_contact_custom_fields'],
    },
    {
      id: 'internal-sgp',
      title: 'SGP',
      eyebrow: 'Ferramentas internas',
      description: 'Consultar contratos, faturas, PIX e rotinas integradas ao SGP.',
      names: ['sgp_fetch_contracts', 'sgp_fetch_contact_panel_data', 'sgp_generate_invoice_pix', 'sgp_create_payment_promise', 'sgp_open_support_ticket'],
    },
  ];

  const toolByName = new Map(tools.map((tool) => [tool.name, tool]));
  const groupedNames = new Set(groupDefinitions.flatMap((group) => group.names));
  const groups = groupDefinitions
    .map((group) => ({
      id: group.id,
      title: group.title,
      eyebrow: group.eyebrow,
      description: group.description,
      source: 'dialogy' as const,
      tools: group.names.map((name) => toolByName.get(name)).filter((tool): tool is AgentToolCatalogItem => Boolean(tool)),
    }))
    .filter((group) => group.tools.length > 0);

  const otherTools = tools.filter((tool) => !groupedNames.has(tool.name));
  if (otherTools.length > 0) {
    groups.push({
      id: 'internal-other',
      title: 'Outras ferramentas',
      eyebrow: 'Ferramentas internas',
      description: 'Permissoes internas adicionais disponiveis para este agente.',
      source: 'dialogy',
      tools: otherTools,
    });
  }

  return groups;
}

function ToolGroupCard({
  group,
  enabledToolSet,
  onOpen,
}: {
  group: ToolGroup;
  enabledToolSet: Set<string>;
  onOpen: (group: ToolGroup) => void;
}) {
  const enabledCount = group.tools.filter((tool) => enabledToolSet.has(tool.name)).length;
  const highRiskCount = group.tools.filter((tool) => tool.riskLevel === 'high').length;

  return (
    <button
      type="button"
      onClick={() => onOpen(group)}
      className="group flex min-h-[176px] w-full flex-col rounded-[24px] border border-border bg-background/80 p-5 text-left shadow-sm transition-all hover:border-primary/40 hover:bg-primary/5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary/40"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-muted text-primary">
            {group.source === 'mcp' ? <Server className="h-5 w-5" /> : <Wrench className="h-5 w-5" />}
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-primary">{group.eyebrow}</div>
            <h3 className="mt-1 truncate text-base font-semibold text-foreground">{group.title}</h3>
          </div>
        </div>
        <Badge variant="outline" className="shrink-0 rounded-full">
          {enabledCount}/{group.tools.length}
        </Badge>
      </div>

      <p className="mt-4 line-clamp-3 text-sm leading-6 text-muted-foreground">{group.description}</p>

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-5">
        <Badge variant="secondary" className="rounded-full">
          {group.tools.length} tool(s)
        </Badge>
        {highRiskCount > 0 && (
          <Badge variant="destructive" className="rounded-full">
            {highRiskCount} alto risco
          </Badge>
        )}
        <span className="ml-auto text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
          Configurar
        </span>
      </div>
    </button>
  );
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
  const [selectedToolGroup, setSelectedToolGroup] = useState<ToolGroup | null>(null);
  const enabledToolSet = new Set(enabledToolNames);
  const internalTools = toolCatalog.filter((tool) => tool.source === 'dialogy');
  const mcpTools = toolCatalog.filter((tool) => tool.source === 'mcp');
  const mcpToolGroups = groupMcpToolsByServer(mcpTools);
  const internalToolGroups = buildInternalToolGroups(internalTools);
  const mcpCards: ToolGroup[] = mcpToolGroups.map((group) => ({
    id: `mcp-${group.serverId}`,
    title: group.serverName,
    eyebrow: 'Servidor MCP',
    description: `${group.tools.length} ferramenta(s) sincronizada(s) neste servidor MCP.`,
    tools: group.tools,
    source: 'mcp',
    href: '/integrations/mcp',
  }));
  const selectedEnabledCount = selectedToolGroup
    ? selectedToolGroup.tools.filter((tool) => enabledToolSet.has(tool.name)).length
    : 0;
  const toggleTool = (toolName: string, nextChecked: boolean) => {
    setEnabledToolNames(
      nextChecked
        ? Array.from(new Set([...enabledToolNames, toolName]))
        : enabledToolNames.filter((name) => name !== toolName)
    );
  };

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden rounded-[28px] border border-border bg-card shadow-sm">
        <CardContent className="grid gap-5 p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-primary">
                <Wrench className="h-3.5 w-3.5" />
                Ferramentas internas
              </div>
              <div>
                <h2 className="text-xl font-semibold text-foreground">Permissoes operacionais do agente</h2>
                <p className="text-sm text-muted-foreground">
                  Entre em um card para escolher quais acoes internas este agente pode executar.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="outline" className="rounded-full">
                {internalTools.filter((tool) => enabledToolSet.has(tool.name)).length} internas ativas
              </Badge>
              <Button onClick={onSaveTools} disabled={isSavingTools} className="rounded-full">
                {isSavingTools ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Salvar tools
              </Button>
            </div>
          </div>

          {internalToolGroups.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {internalToolGroups.map((group) => (
                <ToolGroupCard key={group.id} group={group} enabledToolSet={enabledToolSet} onOpen={setSelectedToolGroup} />
              ))}
            </div>
          ) : (
            <div className="rounded-[24px] border border-dashed border-border bg-muted/20 p-6 text-center">
              <Wrench className="mx-auto h-10 w-10 text-muted-foreground/50" />
              <h3 className="mt-3 text-base font-semibold text-foreground">Nenhuma ferramenta interna disponivel</h3>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                O catalogo interno nao retornou ferramentas para este agente.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

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
                  Entre em um servidor para escolher quais tools MCP este agente pode chamar.
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

          {mcpCards.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {mcpCards.map((group) => (
                <ToolGroupCard key={group.id} group={group} enabledToolSet={enabledToolSet} onOpen={setSelectedToolGroup} />
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

      <Dialog open={Boolean(selectedToolGroup)} onOpenChange={(open) => !open && setSelectedToolGroup(null)}>
        <DialogContent className="flex max-h-[86vh] max-w-3xl flex-col overflow-hidden rounded-[28px] border border-border bg-background p-0 shadow-2xl">
          {selectedToolGroup && (
            <>
              <DialogHeader className="border-b border-border bg-muted/25 px-6 py-5">
                <div className="flex flex-col gap-4 pr-8 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-primary">
                      {selectedToolGroup.source === 'mcp' ? <Server className="h-3.5 w-3.5" /> : <Wrench className="h-3.5 w-3.5" />}
                      {selectedToolGroup.eyebrow}
                    </div>
                    <DialogTitle className="mt-3 truncate text-xl">{selectedToolGroup.title}</DialogTitle>
                    <DialogDescription className="mt-2 leading-6">{selectedToolGroup.description}</DialogDescription>
                  </div>
                  <Badge variant="outline" className="shrink-0 rounded-full">
                    {selectedEnabledCount}/{selectedToolGroup.tools.length} ativas
                  </Badge>
                </div>
              </DialogHeader>

              <div className="min-h-0 overflow-y-auto px-6 py-5">
                <div className="grid gap-3">
                  {selectedToolGroup.tools.map((tool) => {
                    const checked = enabledToolSet.has(tool.name);
                    return (
                      <div key={tool.name} className="flex items-start justify-between gap-4 rounded-2xl border border-border bg-card px-4 py-4">
                        <div className="min-w-0 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="break-all font-mono text-xs font-semibold text-foreground">{tool.name}</span>
                            <Badge variant={tool.riskLevel === 'high' ? 'destructive' : 'outline'} className="rounded-full text-[10px]">
                              {tool.riskLevel}
                            </Badge>
                            {tool.requiresHumanApproval && (
                              <Badge variant="outline" className="rounded-full text-[10px]">
                                aprovacao humana
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs leading-5 text-muted-foreground">{tool.description}</p>
                        </div>
                        <Switch checked={checked} onCheckedChange={(nextChecked) => toggleTool(tool.name, nextChecked)} />
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/20 px-6 py-4">
                {selectedToolGroup.href ? (
                  <Button asChild variant="outline" className="rounded-full">
                    <Link href={selectedToolGroup.href}>Gerenciar servidor</Link>
                  </Button>
                ) : (
                  <div className="text-xs text-muted-foreground">As alteracoes entram no rascunho do agente.</div>
                )}
                <Button onClick={onSaveTools} disabled={isSavingTools} className="rounded-full">
                  {isSavingTools ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Salvar tools
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Card className="overflow-hidden rounded-[28px] border border-border bg-card shadow-sm">
        <CardContent className="flex flex-col gap-4 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
              <Zap className="h-3.5 w-3.5" />
              Automação operacional
            </div>
            <div>
              <h2 className="text-xl font-semibold text-foreground">O que ele pode fazer</h2>
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
          <p className="mt-5 text-base font-semibold">Criar nova acao</p>
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
