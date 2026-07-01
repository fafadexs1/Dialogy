'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Activity, ArrowLeft, Loader2, Plus, RefreshCw, Save, Trash2, Wrench } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useCurrentUser } from '@/hooks/use-online-status';
import {
  deleteMcpServerAction,
  getMcpServersAction,
  syncMcpServerToolsAction,
  testMcpServerConnectionAction,
  upsertMcpServerAction,
} from '@/actions/mcp';
import type { McpServerConfig, McpServerTransport } from '@/services/mcp/types';

const EMPTY_HEADERS = '{\n  "Authorization": "Bearer ..."\n}';
const EMPTY_ARGS = '[\n  "arg1"\n]';
const EMPTY_ENV = '{\n  "API_KEY": "..."\n}';

export default function McpIntegrationPage() {
  const user = useCurrentUser();
  const { toast } = useToast();
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

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
    [editingId, servers]
  );

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

  const saveServer = async () => {
    if (!workspaceId) return;
    setSaving(true);
    try {
      let headers: Record<string, string> = {};
      let args: string[] = [];
      let env: Record<string, string> = {};
      try {
        headers = headersJson.trim() ? JSON.parse(headersJson) : {};
        args = argsJson.trim() ? JSON.parse(argsJson) : [];
        env = envJson.trim() ? JSON.parse(envJson) : {};
      } catch {
        toast({ title: 'JSON invalido', description: 'Confira headers, argumentos e variaveis de ambiente.', variant: 'destructive' });
        return;
      }

      const result = await upsertMcpServerAction({
        workspaceId,
        id: editingId,
        name,
        url,
        transport,
        headers,
        command,
        args,
        env,
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
    <div className="flex h-full min-w-0 flex-col gap-6 bg-background px-4 py-4 sm:px-6 lg:px-8">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="rounded-full">
            <Link href="/integrations">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">MCP</h1>
            <p className="text-sm text-muted-foreground">Conecte servidores MCP e sincronize tools para os agentes.</p>
          </div>
        </div>
        <Button onClick={resetForm} variant="outline" className="rounded-full">
          <Plus className="mr-2 h-4 w-4" />
          Novo servidor
        </Button>
      </header>

      <main className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid gap-4">
          {loading ? (
            <Card><CardContent className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></CardContent></Card>
          ) : servers.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex min-h-52 flex-col items-center justify-center gap-3 text-center">
                <Wrench className="h-10 w-10 text-muted-foreground" />
                <div>
                  <h2 className="font-semibold text-foreground">Nenhum servidor MCP cadastrado</h2>
                  <p className="text-sm text-muted-foreground">Cadastre um endpoint MCP remoto para descobrir tools.</p>
                </div>
              </CardContent>
            </Card>
          ) : servers.map((server) => (
            <Card key={server.id} className="overflow-hidden">
              <CardHeader className="border-b border-border/60 bg-muted/20">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-lg">{server.name}</CardTitle>
                    <CardDescription className="break-all">
                      {server.transport === 'stdio' ? `${server.command || ''} ${(server.args || []).join(' ')}` : server.url}
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={server.isActive ? 'default' : 'secondary'}>{server.isActive ? 'Ativo' : 'Inativo'}</Badge>
                    <Badge variant="outline">{server.transport}</Badge>
                    {server.healthStatus && server.healthStatus !== 'unknown' && (
                      <Badge variant={server.healthStatus === 'healthy' ? 'default' : 'destructive'}>
                        {server.healthStatus === 'healthy' ? 'Conectado' : 'Indisponivel'}
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4 p-5">
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span>{server.tools?.length || 0} tool(s)</span>
                  {server.syncedAt && <span>Sincronizado em {new Date(server.syncedAt).toLocaleString()}</span>}
                  {server.healthCheckedAt && (
                    <span>
                      Testado em {new Date(server.healthCheckedAt).toLocaleString()}
                      {server.healthLatencyMs != null ? ` (${server.healthLatencyMs} ms)` : ''}
                    </span>
                  )}
                </div>
                {server.lastError && (
                  <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                    {server.lastError}
                  </p>
                )}
                <div className="grid gap-2">
                  {(server.tools || []).map((tool) => (
                    <div key={tool.qualifiedName} className="rounded-xl border border-border bg-muted/20 p-3">
                      <div className="text-sm font-medium text-foreground">{tool.qualifiedName}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{tool.description || tool.title || 'Sem descricao'}</div>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => editServer(server)} variant="outline" className="rounded-full">Editar</Button>
                  <Button onClick={() => syncServer(server.id)} disabled={syncingId === server.id} className="rounded-full">
                    {syncingId === server.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                    Sincronizar tools
                  </Button>
                  <Button onClick={() => testServer(server.id)} disabled={testingId === server.id} variant="outline" className="rounded-full">
                    {testingId === server.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Activity className="mr-2 h-4 w-4" />}
                    Testar conexao
                  </Button>
                  <Button onClick={() => deleteServer(server.id)} variant="destructive" className="rounded-full">
                    <Trash2 className="mr-2 h-4 w-4" />
                    Remover
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>{selectedServer ? 'Editar servidor' : 'Novo servidor'}</CardTitle>
            <CardDescription>Use HTTP/SSE para servidores remotos ou stdio para iniciar um processo local.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex: ERP MCP" />
            </div>
            <div className="space-y-2">
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
                <div className="space-y-2">
                  <Label>Comando</Label>
                  <Input value={command} onChange={(event) => setCommand(event.target.value)} placeholder="node, npx, python, uvx..." />
                </div>
                <div className="space-y-2">
                  <Label>Argumentos JSON</Label>
                  <Textarea
                    value={argsJson}
                    onChange={(event) => setArgsJson(event.target.value)}
                    placeholder={EMPTY_ARGS}
                    className="min-h-28 font-mono text-xs"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Env JSON</Label>
                  <Textarea
                    value={envJson}
                    onChange={(event) => setEnvJson(event.target.value)}
                    placeholder={EMPTY_ENV}
                    className="min-h-28 font-mono text-xs"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Diretorio de trabalho</Label>
                  <Input value={cwd} onChange={(event) => setCwd(event.target.value)} placeholder="/app ou C:\\caminho\\do\\servidor" />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <Label>URL do endpoint MCP</Label>
                  <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/mcp" />
                </div>
                <div className="space-y-2">
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
            <div className="flex items-center justify-between rounded-xl border border-border p-4">
              <div>
                <Label>Ativo</Label>
                <p className="text-xs text-muted-foreground">Somente servidores ativos expõem tools para agentes.</p>
              </div>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>
            <Button onClick={saveServer} disabled={saving} className="rounded-full">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Salvar servidor
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
