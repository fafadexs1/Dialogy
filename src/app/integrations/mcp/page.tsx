'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Code2,
  DatabaseZap,
  KeyRound,
  Loader2,
  PlugZap,
  Plus,
  RefreshCw,
  Save,
  Search,
  Server,
  ShieldCheck,
  TerminalSquare,
  Trash2,
  Wrench,
  XCircle,
} from 'lucide-react';

import {
  deleteMcpServerAction,
  getMcpServersAction,
  syncMcpServerToolsAction,
  testMcpServerConnectionAction,
  upsertMcpServerAction,
} from '@/actions/mcp';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { useCurrentUser } from '@/hooks/use-online-status';
import { cn } from '@/lib/utils';
import type { McpServerConfig, McpServerTransport, McpToolConfig } from '@/services/mcp/types';

const EMPTY_HEADERS = '{\n  "Authorization": "Bearer ..."\n}';
const EMPTY_ARGS = '[\n  "arg1"\n]';
const EMPTY_ENV = '{\n  "API_KEY": "..."\n}';

type StatusFilter = 'all' | 'active' | 'attention';

function formatTransport(transport: McpServerTransport): string {
  if (transport === 'streamable_http') return 'HTTP';
  if (transport === 'sse') return 'SSE';
  return 'Stdio';
}

function formatDate(value?: string | null): string {
  if (!value) return 'Nunca';
  return new Date(value).toLocaleString('pt-BR');
}

function serverEndpoint(server: McpServerConfig): string {
  if (server.transport === 'stdio') {
    return [server.command, ...(server.args || [])].filter(Boolean).join(' ');
  }
  return server.url || '';
}

function toolDisplayName(tool: McpToolConfig): string {
  return tool.title?.trim() || tool.name || tool.qualifiedName;
}

function schemaFieldNames(schema?: Record<string, unknown> | null): string[] {
  const properties = schema && typeof schema === 'object' && !Array.isArray(schema)
    ? (schema as { properties?: unknown }).properties
    : null;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return [];
  return Object.keys(properties).slice(0, 8);
}

function toolAnnotationBadges(tool: McpToolConfig) {
  const annotations = tool.annotations || {};
  return [
    annotations.readOnlyHint ? { label: 'Leitura', className: 'border-sky-200 bg-sky-50 text-sky-700' } : null,
    annotations.idempotentHint ? { label: 'Idempotente', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' } : null,
    annotations.destructiveHint ? { label: 'Destrutiva', className: 'border-red-200 bg-red-50 text-red-700' } : null,
    annotations.openWorldHint ? { label: 'Externa', className: 'border-amber-200 bg-amber-50 text-amber-700' } : null,
  ].filter((item): item is { label: string; className: string } => Boolean(item));
}

function serverMatchesQuery(server: McpServerConfig, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  const haystack = [
    server.name,
    server.url,
    server.command,
    server.transport,
    ...(server.tools || []).flatMap((tool) => [
      tool.name,
      tool.title,
      tool.description,
      tool.qualifiedName,
    ]),
  ].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(normalized);
}

function filteredTools(server: McpServerConfig, query: string): McpToolConfig[] {
  const normalized = query.trim().toLowerCase();
  const tools = server.tools || [];
  if (!normalized) return tools;
  return tools.filter((tool) => [
    tool.name,
    tool.title,
    tool.description,
    tool.qualifiedName,
  ].filter(Boolean).join(' ').toLowerCase().includes(normalized));
}

export default function McpIntegrationPage() {
  const user = useCurrentUser();
  const { toast } = useToast();
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [transport, setTransport] = useState<McpServerTransport>('streamable_http');
  const [isActive, setIsActive] = useState(true);
  const [headersJson, setHeadersJson] = useState('{}');
  const [command, setCommand] = useState('');
  const [argsJson, setArgsJson] = useState('[]');
  const [envJson, setEnvJson] = useState('{}');
  const [cwd, setCwd] = useState('');

  const workspaceId = user?.activeWorkspaceId;

  const selectedServer = useMemo(
    () => servers.find((server) => server.id === editingId) || null,
    [editingId, servers],
  );

  const totals = useMemo(() => {
    const totalTools = servers.reduce((sum, server) => sum + (server.tools?.length || 0), 0);
    return {
      servers: servers.length,
      active: servers.filter((server) => server.isActive).length,
      healthy: servers.filter((server) => server.healthStatus === 'healthy').length,
      attention: servers.filter((server) => server.lastError || server.healthStatus === 'unreachable').length,
      tools: totalTools,
    };
  }, [servers]);

  const visibleServers = useMemo(() => (
    servers
      .filter((server) => serverMatchesQuery(server, query))
      .filter((server) => {
        if (statusFilter === 'active') return server.isActive;
        if (statusFilter === 'attention') return Boolean(server.lastError || server.healthStatus === 'unreachable');
        return true;
      })
  ), [query, servers, statusFilter]);

  const loadServers = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const result = await getMcpServersAction(workspaceId);
      if (result.error) {
        toast({ title: 'Erro ao carregar MCP', description: result.error, variant: 'destructive' });
      }
      setServers(result.servers || []);
    } finally {
      setLoading(false);
    }
  }, [toast, workspaceId]);

  useEffect(() => {
    void loadServers();
  }, [loadServers]);

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setUrl('');
    setTransport('streamable_http');
    setIsActive(true);
    setHeadersJson('{}');
    setCommand('');
    setArgsJson('[]');
    setEnvJson('{}');
    setCwd('');
  };

  const editServer = (server: McpServerConfig) => {
    setEditingId(server.id);
    setName(server.name);
    setUrl(server.url || '');
    setTransport(server.transport);
    setIsActive(server.isActive);
    setHeadersJson(JSON.stringify(server.headers || {}, null, 2));
    setCommand(server.command || '');
    setArgsJson(JSON.stringify(server.args || [], null, 2));
    setEnvJson(JSON.stringify(server.env || {}, null, 2));
    setCwd(server.cwd || '');
  };

  const parseServerJson = () => {
    try {
      return {
        headers: headersJson.trim() ? JSON.parse(headersJson) as Record<string, string> : {},
        args: argsJson.trim() ? JSON.parse(argsJson) as string[] : [],
        env: envJson.trim() ? JSON.parse(envJson) as Record<string, string> : {},
      };
    } catch {
      toast({ title: 'JSON invalido', description: 'Confira headers, argumentos e variaveis de ambiente.', variant: 'destructive' });
      return null;
    }
  };

  const saveServer = async () => {
    if (!workspaceId) return;
    const parsed = parseServerJson();
    if (!parsed) return;

    setSaving(true);
    try {
      const result = await upsertMcpServerAction({
        workspaceId,
        id: editingId,
        name,
        url,
        transport,
        headers: parsed.headers,
        command,
        args: parsed.args,
        env: parsed.env,
        cwd,
        isActive,
      });

      if (!result.success) {
        toast({ title: 'Erro ao salvar MCP', description: result.error, variant: 'destructive' });
        return;
      }

      toast({ title: 'Servidor MCP salvo' });
      resetForm();
      await loadServers();
    } finally {
      setSaving(false);
    }
  };

  const toggleServer = async (server: McpServerConfig) => {
    if (!workspaceId) return;
    setUpdatingId(server.id);
    try {
      const result = await upsertMcpServerAction({
        workspaceId,
        id: server.id,
        name: server.name,
        url: server.url,
        transport: server.transport,
        headers: server.headers,
        command: server.command,
        args: server.args,
        env: server.env,
        cwd: server.cwd,
        isActive: !server.isActive,
      });

      if (!result.success) {
        toast({ title: 'Erro ao atualizar MCP', description: result.error, variant: 'destructive' });
        return;
      }
      toast({ title: server.isActive ? 'Servidor MCP pausado' : 'Servidor MCP ativado' });
      await loadServers();
    } finally {
      setUpdatingId(null);
    }
  };

  const syncServer = async (serverId: string) => {
    if (!workspaceId) return;
    setSyncingId(serverId);
    try {
      const result = await syncMcpServerToolsAction(workspaceId, serverId);
      if (!result.success) {
        toast({ title: 'Falha ao sincronizar tools', description: result.error, variant: 'destructive' });
        await loadServers();
        return;
      }
      toast({ title: 'Tools sincronizadas', description: `${result.tools?.length || 0} tool(s) encontradas.` });
      await loadServers();
    } finally {
      setSyncingId(null);
    }
  };

  const deleteServer = async (serverId: string) => {
    if (!workspaceId || !confirm('Remover este servidor MCP?')) return;
    const result = await deleteMcpServerAction(workspaceId, serverId);
    if (!result.success) {
      toast({ title: 'Erro ao remover MCP', description: result.error, variant: 'destructive' });
      return;
    }
    toast({ title: 'Servidor MCP removido' });
    if (editingId === serverId) resetForm();
    await loadServers();
  };

  const testServer = async (serverId: string) => {
    if (!workspaceId) return;
    setTestingId(serverId);
    try {
      const result = await testMcpServerConnectionAction(workspaceId, serverId);
      if (!result.success) {
        toast({ title: 'MCP indisponivel', description: result.error, variant: 'destructive' });
      } else {
        toast({
          title: 'MCP conectado',
          description: `${result.toolCount || 0} tool(s), ${result.latencyMs || 0} ms.`,
        });
      }
      await loadServers();
    } finally {
      setTestingId(null);
    }
  };

  return (
    <TooltipProvider>
      <div className="flex h-full min-w-0 flex-col overflow-y-auto bg-muted/30 px-4 py-4 sm:px-6 lg:px-8">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
          <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <Button asChild variant="ghost" size="icon" className="shrink-0 rounded-full">
                <Link href="/integrations">
                  <ArrowLeft className="h-5 w-5" />
                </Link>
              </Button>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-semibold tracking-tight text-foreground">MCP</h1>
                  <Badge variant="outline" className="rounded-full">{totals.tools} tool(s)</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Servidores e ferramentas MCP liberadas para os agentes deste workspace.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void loadServers()} variant="outline" disabled={loading}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Atualizar
              </Button>
              <Button onClick={resetForm}>
                <Plus className="mr-2 h-4 w-4" />
                Novo servidor
              </Button>
            </div>
          </header>

          <section className="grid gap-3 md:grid-cols-4">
            <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">Servidores</span>
                <Server className="h-4 w-4 text-primary" />
              </div>
              <div className="mt-2 text-2xl font-semibold text-foreground">{totals.servers}</div>
            </div>
            <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">Ativos</span>
                <PlugZap className="h-4 w-4 text-emerald-600" />
              </div>
              <div className="mt-2 text-2xl font-semibold text-foreground">{totals.active}</div>
            </div>
            <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">Conectados</span>
                <CheckCircle2 className="h-4 w-4 text-sky-600" />
              </div>
              <div className="mt-2 text-2xl font-semibold text-foreground">{totals.healthy}</div>
            </div>
            <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">Atenção</span>
                <AlertTriangle className="h-4 w-4 text-amber-600" />
              </div>
              <div className="mt-2 text-2xl font-semibold text-foreground">{totals.attention}</div>
            </div>
          </section>

          <main className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
            <section className="min-w-0 space-y-4">
              <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 shadow-sm md:flex-row md:items-center">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Buscar servidor, endpoint ou tool"
                    className="pl-9"
                  />
                </div>
                <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
                  <SelectTrigger className="w-full md:w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="active">Ativos</SelectItem>
                    <SelectItem value="attention">Com atenção</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {loading ? (
                <Card>
                  <CardContent className="flex h-60 items-center justify-center">
                    <Loader2 className="h-7 w-7 animate-spin text-primary" />
                  </CardContent>
                </Card>
              ) : servers.length === 0 ? (
                <Card className="border-dashed bg-card">
                  <CardContent className="flex min-h-[320px] flex-col items-center justify-center gap-4 px-6 text-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-border bg-muted">
                      <Wrench className="h-7 w-7 text-muted-foreground" />
                    </div>
                    <div>
                      <h2 className="text-base font-semibold text-foreground">Nenhum servidor MCP cadastrado</h2>
                      <p className="mt-1 max-w-md text-sm text-muted-foreground">
                        Cadastre um servidor no painel ao lado e sincronize as tools.
                      </p>
                    </div>
                    <Button onClick={resetForm}>
                      <Plus className="mr-2 h-4 w-4" />
                      Novo servidor
                    </Button>
                  </CardContent>
                </Card>
              ) : visibleServers.length === 0 ? (
                <Card className="border-dashed bg-card">
                  <CardContent className="flex min-h-[260px] flex-col items-center justify-center gap-3 text-center">
                    <Search className="h-8 w-8 text-muted-foreground" />
                    <div>
                      <h2 className="text-base font-semibold text-foreground">Nada encontrado</h2>
                      <p className="mt-1 text-sm text-muted-foreground">Ajuste a busca ou o filtro de status.</p>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-4">
                  {visibleServers.map((server) => (
                    <McpServerCard
                      key={server.id}
                      server={server}
                      query={query}
                      isEditing={editingId === server.id}
                      isSyncing={syncingId === server.id}
                      isTesting={testingId === server.id}
                      isUpdating={updatingId === server.id}
                      onEdit={() => editServer(server)}
                      onSync={() => void syncServer(server.id)}
                      onTest={() => void testServer(server.id)}
                      onDelete={() => void deleteServer(server.id)}
                      onToggle={() => void toggleServer(server)}
                    />
                  ))}
                </div>
              )}
            </section>

            <aside className="min-w-0 xl:sticky xl:top-4 xl:self-start">
              <Card className="border border-border bg-card shadow-sm">
                <CardHeader className="border-b border-border/70">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle>{selectedServer ? 'Editar MCP' : 'Novo MCP'}</CardTitle>
                      <CardDescription>
                        {selectedServer ? selectedServer.name : 'Configure o servidor e sincronize as tools.'}
                      </CardDescription>
                    </div>
                    {selectedServer && (
                      <Button type="button" variant="ghost" size="sm" onClick={resetForm}>
                        Limpar
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="grid gap-4 p-5">
                  <div className="grid gap-2">
                    <Label>Nome</Label>
                    <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex: ERP MCP" />
                  </div>

                  <div className="grid gap-2">
                    <Label>Transporte</Label>
                    <Select value={transport} onValueChange={(value) => setTransport(value as McpServerTransport)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="streamable_http">Streamable HTTP</SelectItem>
                        <SelectItem value="sse">SSE legado</SelectItem>
                        <SelectItem value="stdio">Stdio</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {transport === 'stdio' ? (
                    <>
                      <div className="grid gap-2">
                        <Label>Comando</Label>
                        <Input value={command} onChange={(event) => setCommand(event.target.value)} placeholder="node, npx, python, uvx..." />
                      </div>
                      <div className="grid gap-2">
                        <Label>Argumentos JSON</Label>
                        <Textarea
                          value={argsJson}
                          onChange={(event) => setArgsJson(event.target.value)}
                          placeholder={EMPTY_ARGS}
                          className="min-h-28 font-mono text-xs"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label>Env JSON</Label>
                        <Textarea
                          value={envJson}
                          onChange={(event) => setEnvJson(event.target.value)}
                          placeholder={EMPTY_ENV}
                          className="min-h-28 font-mono text-xs"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label>Diretorio de trabalho</Label>
                        <Input value={cwd} onChange={(event) => setCwd(event.target.value)} placeholder="/app ou C:\\caminho\\do\\servidor" />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="grid gap-2">
                        <Label>URL do endpoint MCP</Label>
                        <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/mcp" />
                      </div>
                      <div className="grid gap-2">
                        <Label>Headers JSON</Label>
                        <Textarea
                          value={headersJson}
                          onChange={(event) => setHeadersJson(event.target.value)}
                          placeholder={EMPTY_HEADERS}
                          className="min-h-32 font-mono text-xs"
                        />
                      </div>
                    </>
                  )}

                  <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/30 p-4">
                    <div>
                      <Label>Ativo</Label>
                      <p className="mt-1 text-xs text-muted-foreground">Servidor expõe tools para agentes.</p>
                    </div>
                    <Switch checked={isActive} onCheckedChange={setIsActive} />
                  </div>

                  <Button onClick={saveServer} disabled={saving}>
                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Salvar MCP
                  </Button>
                </CardContent>
              </Card>
            </aside>
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}

function McpServerCard({
  server,
  query,
  isEditing,
  isSyncing,
  isTesting,
  isUpdating,
  onEdit,
  onSync,
  onTest,
  onDelete,
  onToggle,
}: {
  server: McpServerConfig;
  query: string;
  isEditing: boolean;
  isSyncing: boolean;
  isTesting: boolean;
  isUpdating: boolean;
  onEdit: () => void;
  onSync: () => void;
  onTest: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const tools = filteredTools(server, query);
  const endpoint = serverEndpoint(server);
  const health = server.healthStatus || 'unknown';
  const healthClass = health === 'healthy'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : health === 'unreachable'
      ? 'border-red-200 bg-red-50 text-red-700'
      : 'border-slate-200 bg-slate-50 text-slate-700';

  return (
    <Card className={cn('overflow-hidden border border-border bg-card shadow-sm', isEditing && 'ring-2 ring-primary/30')}>
      <CardHeader className="border-b border-border/70 bg-background">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
                {server.transport === 'stdio' ? <TerminalSquare className="h-5 w-5" /> : <Server className="h-5 w-5" />}
              </div>
              <div className="min-w-0">
                <CardTitle className="truncate text-lg">{server.name}</CardTitle>
                <CardDescription className="mt-1 break-all font-mono text-xs">
                  {endpoint || 'Endpoint nao configurado'}
                </CardDescription>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge variant={server.isActive ? 'default' : 'secondary'} className="rounded-full">
              {server.isActive ? 'Ativo' : 'Inativo'}
            </Badge>
            <Badge variant="outline" className="rounded-full">
              {formatTransport(server.transport)}
            </Badge>
            <Badge variant="outline" className={cn('rounded-full border', healthClass)}>
              {health === 'healthy' ? 'Conectado' : health === 'unreachable' ? 'Indisponivel' : 'Nao testado'}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="grid gap-5 p-5">
        <div className="grid gap-3 md:grid-cols-3">
          <Metric icon={Wrench} label="Tools" value={String(server.tools?.length || 0)} />
          <Metric icon={Clock3} label="Sincronizacao" value={formatDate(server.syncedAt)} />
          <Metric
            icon={Activity}
            label="Ultimo teste"
            value={server.healthLatencyMs != null ? `${server.healthLatencyMs} ms` : formatDate(server.healthCheckedAt)}
          />
        </div>

        {server.lastError && (
          <div className="flex gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="line-clamp-3">{server.lastError}</span>
          </div>
        )}

        <div className="rounded-lg border border-border">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-4 py-3">
            <div className="flex items-center gap-2">
              <DatabaseZap className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-foreground">Tools deste MCP</span>
            </div>
            <Badge variant="outline" className="rounded-full">{tools.length} visivel(is)</Badge>
          </div>

          {tools.length === 0 ? (
            <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 px-5 py-8 text-center">
              <Wrench className="h-7 w-7 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">Nenhuma tool sincronizada</p>
              <p className="max-w-md text-xs text-muted-foreground">
                Use sincronizar para descobrir as ferramentas expostas por este servidor.
              </p>
            </div>
          ) : (
            <div className="max-h-[520px] overflow-y-auto overscroll-contain [scrollbar-width:thin]">
              <div className="divide-y divide-border">
                {tools.map((tool) => (
                  <McpToolRow key={tool.qualifiedName} tool={tool} />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={onEdit} variant={isEditing ? 'default' : 'outline'}>
            <Code2 className="mr-2 h-4 w-4" />
            {isEditing ? 'Editando' : 'Editar'}
          </Button>
          <Button onClick={onSync} disabled={isSyncing}>
            {isSyncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Sincronizar
          </Button>
          <Button onClick={onTest} disabled={isTesting} variant="outline">
            {isTesting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Activity className="mr-2 h-4 w-4" />}
            Testar
          </Button>
          <Button onClick={onToggle} disabled={isUpdating} variant="outline">
            {isUpdating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlugZap className="mr-2 h-4 w-4" />}
            {server.isActive ? 'Pausar' : 'Ativar'}
          </Button>
          <Button onClick={onDelete} variant="destructive">
            <Trash2 className="mr-2 h-4 w-4" />
            Remover
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function McpToolRow({ tool }: { tool: McpToolConfig }) {
  const fields = schemaFieldNames(tool.inputSchema);
  const badges = toolAnnotationBadges(tool);

  return (
    <div className="grid gap-3 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-start">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p className="truncate text-sm font-semibold text-foreground">{toolDisplayName(tool)}</p>
          {badges.length === 0 && (
            <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 text-slate-700">
              Sem anotacoes
            </Badge>
          )}
          {badges.map((badge) => (
            <Badge key={badge.label} variant="outline" className={cn('rounded-full border', badge.className)}>
              {badge.label}
            </Badge>
          ))}
        </div>
        <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{tool.qualifiedName}</p>
        {tool.description && (
          <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">{tool.description}</p>
        )}
      </div>

      <div className="grid gap-2 rounded-lg border border-border bg-muted/20 p-3">
        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
          <KeyRound className="h-3.5 w-3.5 text-primary" />
          Entrada
        </div>
        {fields.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {fields.map((field) => (
              <Tooltip key={field}>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="max-w-[180px] truncate rounded-full bg-background">
                    {field}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>{field}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />
            Sem schema de entrada
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-2 truncate text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}
