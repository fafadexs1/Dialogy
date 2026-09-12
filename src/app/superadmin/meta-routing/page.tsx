'use client';

import React, { useState, useEffect, useTransition, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Route,
  Activity,
  Database,
  AlertTriangle,
  CheckCircle2,
  RotateCcw,
  Unlock,
  ShieldAlert,
  Trash2,
  Plus,
  Search,
  FileCode,
  Clock,
  ArrowRight,
  Eye,
  Server,
  Network,
  RefreshCw,
  GitFork,
  HelpCircle
} from 'lucide-react';
import {
  getMetaRoutingOverview,
  createWabaRouteAction,
  createPhoneRouteAction,
  deleteWabaRouteAction,
  deletePhoneRouteAction,
  replayDeliveriesAction,
  decryptPayloadAction,
  getBreakGlassLogs,
  initializeMetaRoutingTablesAction,
  syncPlatformRoutesAction,
  MetaRoutingOverview
} from '@/actions/meta-routing';

export default function MetaRoutingDashboard() {
  const { toast } = useToast();
  const [data, setData] = useState<MetaRoutingOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [auditLogsLoading, setAuditLogsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');

  // Filter States
  const [statusFilter, setStatusFilter] = useState('');
  const [wabaFilter, setWabaFilter] = useState('');
  const [phoneFilter, setPhoneFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Bulk Selection
  const [selectedDeliveries, setSelectedDeliveries] = useState<string[]>([]);

  // Dialog States
  const [isWabaDialogOpen, setIsWabaDialogOpen] = useState(false);
  const [isPhoneDialogOpen, setIsPhoneDialogOpen] = useState(false);
  const [isDecryptDialogOpen, setIsDecryptDialogOpen] = useState(false);
  const [isErrorDialogOpen, setIsErrorDialogOpen] = useState(false);

  // Form States
  const [wabaIdInput, setWabaIdInput] = useState('');
  const [wabaClusterInput, setWabaClusterInput] = useState('');
  const [wabaStateInput, setWabaStateInput] = useState('active');

  const [phoneIdInput, setPhoneIdInput] = useState('');
  const [phoneWabaInput, setPhoneWabaInput] = useState('');
  const [phoneInstanceInput, setPhoneInstanceInput] = useState('');
  const [phoneWorkspaceInput, setPhoneWorkspaceInput] = useState('');
  const [phoneStateInput, setPhoneStateInput] = useState('active');

  const [selectedDelivery, setSelectedDelivery] = useState<any | null>(null);
  const [decryptReason, setDecryptReason] = useState('');
  const [decryptedPayload, setDecryptedPayload] = useState<string | null>(null);
  const [selectedError, setSelectedError] = useState<string | null>(null);

  // Transitions
  const [isPending, startTransition] = useTransition();
  const [actionLoading, setActionLoading] = useState(false);

  // Load Main Data
  const loadData = useCallback(async (customFilters?: {
    status?: string;
    waba_id?: string;
    phone_number_id?: string;
    q?: string;
  }) => {
    setLoading(true);
    setLoadError(null);
    try {
      const activeFilters = customFilters || {
        status: statusFilter,
        waba_id: wabaFilter,
        phone_number_id: phoneFilter,
        q: searchQuery
      };
      const res = await getMetaRoutingOverview(activeFilters);
      if (res.error) {
        setLoadError(res.error);
        toast({ title: 'Erro ao carregar dados', description: res.error, variant: 'destructive' });
      } else {
        setData(res.data);
      }
    } catch (e: any) {
      setLoadError(e.message || 'Falha de rede.');
      toast({ title: 'Erro de comunicação', description: e.message || 'Falha de rede.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [statusFilter, wabaFilter, phoneFilter, searchQuery, toast]);

  // Load Audit Logs
  const loadAuditLogs = useCallback(async () => {
    setAuditLogsLoading(true);
    try {
      const res = await getBreakGlassLogs();
      if (res.success && res.logs) {
        setAuditLogs(res.logs);
      }
    } catch (e) {
      console.error('Audit logs error:', e);
    } finally {
      setAuditLogsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync tab change
  const handleTabChange = (value: string) => {
    setActiveTab(value);
    if (value === 'audit') {
      loadAuditLogs();
    } else {
      loadData();
    }
  };

  // Filter handlers
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadData();
  };

  const handleResetFilters = () => {
    setStatusFilter('');
    setWabaFilter('');
    setPhoneFilter('');
    setSearchQuery('');
    loadData({ status: '', waba_id: '', phone_number_id: '', q: '' });
  };

  // Table Setup Action
  const handleInitializeDb = async () => {
    setActionLoading(true);
    try {
      const res = await initializeMetaRoutingTablesAction();
      if (res.success) {
        toast({
          title: 'Banco inicializado!',
          description: 'As tabelas de roteamento foram criadas e populadas com sucesso.',
        });
        loadData();
      } else {
        toast({
          title: 'Erro na inicialização',
          description: res.error || 'Erro desconhecido',
          variant: 'destructive',
        });
      }
    } catch (e: any) {
      toast({ title: 'Falha na inicialização', description: e.message, variant: 'destructive' });
    } finally {
      setActionLoading(false);
    }
  };

  // Sync Routes from evolution_api_instances Action
  const handleSyncPlatformRoutes = async () => {
    setActionLoading(true);
    try {
      const res = await syncPlatformRoutesAction();
      if (res.success) {
        toast({
          title: 'Rotas Sincronizadas!',
          description: `${res.count} instâncias/telefones da plataforma foram importados com sucesso.`,
        });
        loadData();
      } else {
        toast({
          title: 'Erro na Sincronização',
          description: res.error || 'Erro desconhecido',
          variant: 'destructive',
        });
      }
    } catch (e: any) {
      toast({ title: 'Falha na Sincronização', description: e.message, variant: 'destructive' });
    } finally {
      setActionLoading(false);
    }
  };

  // Create WABA Route Action
  const handleCreateWabaRoute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wabaIdInput || !wabaClusterInput) {
      toast({ title: 'Aviso', description: 'Preencha todos os campos obrigatórios.', variant: 'destructive' });
      return;
    }
    setActionLoading(true);
    try {
      const res = await createWabaRouteAction({
        waba_id: wabaIdInput,
        cluster_id: wabaClusterInput,
        state: wabaStateInput
      });
      if (res.success) {
        toast({ title: 'Rota de WABA salva!', description: `A rota para ${wabaIdInput} foi configurada.` });
        setIsWabaDialogOpen(false);
        setWabaIdInput('');
        setWabaClusterInput('');
        setWabaStateInput('active');
        loadData();
      } else {
        toast({ title: 'Erro ao salvar rota', description: res.error, variant: 'destructive' });
      }
    } catch (e: any) {
      toast({ title: 'Erro de processamento', description: e.message, variant: 'destructive' });
    } finally {
      setActionLoading(false);
    }
  };

  // Create Phone Route Action
  const handleCreatePhoneRoute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneIdInput || !phoneWabaInput || !phoneInstanceInput || !phoneWorkspaceInput) {
      toast({ title: 'Aviso', description: 'Preencha todos os campos obrigatórios.', variant: 'destructive' });
      return;
    }
    setActionLoading(true);
    try {
      const res = await createPhoneRouteAction({
        phone_number_id: phoneIdInput,
        waba_id: phoneWabaInput,
        instance_id: phoneInstanceInput,
        workspace_id: phoneWorkspaceInput,
        state: phoneStateInput
      });
      if (res.success) {
        toast({ title: 'Rota de Telefone salva!', description: `A rota para o número ${phoneIdInput} foi configurada.` });
        setIsPhoneDialogOpen(false);
        setPhoneIdInput('');
        setPhoneWabaInput('');
        setPhoneInstanceInput('');
        setPhoneWorkspaceInput('');
        setPhoneStateInput('active');
        loadData();
      } else {
        toast({ title: 'Erro ao salvar rota', description: res.error, variant: 'destructive' });
      }
    } catch (e: any) {
      toast({ title: 'Erro de processamento', description: e.message, variant: 'destructive' });
    } finally {
      setActionLoading(false);
    }
  };

  // Delete Actions
  const handleDeleteWabaRoute = async (waba_id: string) => {
    if (!confirm(`Deseja realmente excluir a rota da WABA ${waba_id}?`)) return;
    try {
      const res = await deleteWabaRouteAction(waba_id);
      if (res.success) {
        toast({ title: 'Rota removida', description: 'A rota de WABA foi excluída com sucesso.' });
        loadData();
      } else {
        toast({ title: 'Erro ao excluir', description: res.error, variant: 'destructive' });
      }
    } catch (e: any) {
      toast({ title: 'Erro de rede', description: e.message, variant: 'destructive' });
    }
  };

  const handleDeletePhoneRoute = async (phone_id: string) => {
    if (!confirm(`Deseja realmente excluir a rota do número ${phone_id}?`)) return;
    try {
      const res = await deletePhoneRouteAction(phone_id);
      if (res.success) {
        toast({ title: 'Rota removida', description: 'A rota de telefone foi excluída com sucesso.' });
        loadData();
      } else {
        toast({ title: 'Erro ao excluir', description: res.error, variant: 'destructive' });
      }
    } catch (e: any) {
      toast({ title: 'Erro de rede', description: e.message, variant: 'destructive' });
    }
  };

  // Replay Action
  const handleReplay = async (ids: string[]) => {
    setActionLoading(true);
    try {
      const res = await replayDeliveriesAction(ids);
      if (res.success) {
        toast({
          title: 'Replay agendado!',
          description: `${res.count} webhook(s) alterados para 'pending' para reprocessamento imediato.`,
        });
        setSelectedDeliveries([]);
        loadData();
      } else {
        toast({ title: 'Erro no replay', description: res.error, variant: 'destructive' });
      }
    } catch (e: any) {
      toast({ title: 'Erro de comunicação', description: e.message, variant: 'destructive' });
    } finally {
      setActionLoading(false);
    }
  };

  // Decryption Submit Action
  const handleDecryptSubmit = async () => {
    if (!selectedDelivery || !decryptReason || decryptReason.trim().length < 10) {
      toast({ title: 'Validação', description: 'Forneça uma justificativa detalhada com mais de 10 caracteres.', variant: 'destructive' });
      return;
    }
    setActionLoading(true);
    try {
      const res = await decryptPayloadAction({
        delivery_id: selectedDelivery.id,
        reason: decryptReason
      });
      if (res.success && res.decryptedPayload) {
        setDecryptedPayload(res.decryptedPayload);
        toast({ title: 'Acesso Break-Glass Autorizado', description: 'O payload bruto foi descriptografado e auditado.' });
      } else {
        toast({ title: 'Erro de autorização', description: res.error, variant: 'destructive' });
      }
    } catch (e: any) {
      toast({ title: 'Erro na descriptografia', description: e.message, variant: 'destructive' });
    } finally {
      setActionLoading(false);
    }
  };

  // Helper formatting functions
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('pt-BR');
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'processed':
        return <Badge className="bg-emerald-500 hover:bg-emerald-600 text-white font-medium">processed</Badge>;
      case 'pending':
        return <Badge className="bg-amber-500 hover:bg-amber-600 text-white font-medium animate-pulse">pending</Badge>;
      case 'delivering':
        return <Badge className="bg-blue-500 hover:bg-blue-600 text-white font-medium">delivering</Badge>;
      case 'retry':
        return <Badge className="bg-indigo-500 hover:bg-indigo-600 text-white font-medium">retry</Badge>;
      case 'quarantined':
        return <Badge variant="destructive" className="font-semibold gap-1"><AlertTriangle className="h-3 w-3" /> quarantined</Badge>;
      case 'dead_letter':
        return <Badge variant="destructive" className="bg-red-800 hover:bg-red-900 font-semibold gap-1"><ShieldAlert className="h-3 w-3" /> dead_letter</Badge>;
      case 'accepted':
        return <Badge className="bg-cyan-500 hover:bg-cyan-600 text-white font-medium">accepted</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const toggleSelectDelivery = (id: string) => {
    setSelectedDeliveries(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = (deliveryList: any[]) => {
    const replayableIds = deliveryList
      .filter(d => ['quarantined', 'dead_letter', 'retry', 'pending'].includes(d.status))
      .map(d => d.id);
    
    if (selectedDeliveries.length === replayableIds.length) {
      setSelectedDeliveries([]);
    } else {
      setSelectedDeliveries(replayableIds);
    }
  };

  return (
    <div className="space-y-6">
      {/* Upper header controls */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2 text-primary">
            <Route className="h-8 w-8 text-primary" /> Roteamento de Webhooks Meta
          </h1>
          <p className="text-muted-foreground mt-1 text-sm md:text-base">
            Distribuição determinística por cluster proprietário, tratamento de falhas e auditoria break-glass.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {data && (
            <Badge variant={data.dbConnected ? 'secondary' : 'destructive'} className="h-7 text-xs font-semibold">
              {data.dbConnected ? (
                <span className="flex items-center gap-1.5 text-emerald-500">
                  <Database className="h-3.5 w-3.5" /> Banco Conectado (Produção)
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-red-500">
                  <AlertTriangle className="h-3.5 w-3.5 animate-bounce" /> Modo de Fallback (Mock)
                </span>
              )}
            </Badge>
          )}
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => {
              if (activeTab === 'audit') loadAuditLogs();
              else loadData();
            }} 
            disabled={loading || auditLogsLoading}
            className="h-8 gap-1.5"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${(loading || auditLogsLoading) ? 'animate-spin' : ''}`} />
            Atualizar Dados
          </Button>
          {data?.dbConnected && (
            <Button 
              variant="default" 
              size="sm" 
              onClick={handleSyncPlatformRoutes}
              disabled={loading || actionLoading}
              className="h-8 gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
            >
              <Server className="h-3.5 w-3.5" />
              Sincronizar Plataforma
            </Button>
          )}
        </div>
      </div>

      {loadError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-5 w-5" />
          <AlertTitle>Não foi possível atualizar o painel</AlertTitle>
          <AlertDescription>
            {loadError} {data ? 'Os dados exibidos são da última atualização bem-sucedida. ' : ''}
            Use “Atualizar Dados” para tentar novamente.
          </AlertDescription>
        </Alert>
      )}

      {/* Database Setup Banner */}
      {data && !data.dbConnected && (
        <Alert className="border-amber-500/50 bg-amber-500/10 text-amber-500 dark:border-amber-500/30 dark:bg-amber-500/5">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          <AlertTitle className="font-bold text-base">Tabelas de Roteamento Ausentes</AlertTitle>
          <AlertDescription className="text-sm mt-1 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <span>
              O banco de dados não possui as tabelas operacionais do novo Relay Inbox (e.g. <code>meta_whatsapp_waba_routes</code>). 
              O painel está rodando em modo sandbox persistente. Você pode inicializar as tabelas reais agora se desejar.
            </span>
            <Button 
              size="sm" 
              variant="default"
              onClick={handleInitializeDb}
              disabled={actionLoading}
              className="bg-amber-600 hover:bg-amber-700 text-white font-semibold shrink-0"
            >
              {actionLoading ? 'Processando...' : 'Criar tabelas no Banco'}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Metrics Cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-6">
        <Card className="border border-border/60">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs font-semibold uppercase tracking-wider">Fila Ativa</CardDescription>
            <CardTitle className="text-2xl font-bold flex items-center justify-between">
              {loading ? '...' : data?.statistics.pendingCount ?? '—'}
              <Clock className="h-4 w-4 text-amber-500" />
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <span className="text-[10px] text-muted-foreground">Status pending</span>
          </CardContent>
        </Card>

        <Card className="border border-border/60">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs font-semibold uppercase tracking-wider">Quarentena</CardDescription>
            <CardTitle className="text-2xl font-bold text-red-500 flex items-center justify-between">
              {loading ? '...' : data?.statistics.quarantineCount ?? '—'}
              <AlertTriangle className="h-4 w-4 text-red-500" />
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <span className="text-[10px] text-muted-foreground">Sem rota resolvida</span>
          </CardContent>
        </Card>

        <Card className="border border-border/60">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs font-semibold uppercase tracking-wider">Dead-Letter (DLQ)</CardDescription>
            <CardTitle className="text-2xl font-bold text-red-600 flex items-center justify-between">
              {loading ? '...' : data?.statistics.dlqCount ?? '—'}
              <ShieldAlert className="h-4 w-4 text-red-600" />
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <span className="text-[10px] text-muted-foreground">Falha após 20 retries</span>
          </CardContent>
        </Card>

        <Card className="border border-border/60">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs font-semibold uppercase tracking-wider">Taxa de Sucesso</CardDescription>
            <CardTitle className="text-2xl font-bold text-emerald-500 flex items-center justify-between">
              {loading ? '...' : data ? `${data.statistics.successRate}%` : '—'}
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <span className="text-[10px] text-muted-foreground">Entregas aceitas</span>
          </CardContent>
        </Card>

        <Card className="border border-border/60 col-span-2">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs font-semibold uppercase tracking-wider">Latência da Fila</CardDescription>
            <CardTitle className="text-2xl font-bold flex items-center justify-between font-mono">
              {loading ? '...' : data ? `${data.statistics.avgLatencyMs}ms` : '—'}
              <Network className="h-4 w-4 text-blue-500" />
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">Média Processamento</span>
            <span className="text-[10px] text-red-400 font-mono">Max: {data ? `${data.statistics.maxLatencyMs}ms` : '—'}</span>
          </CardContent>
        </Card>
      </div>

      {/* Main Tabs Container */}
      <Tabs defaultValue="overview" className="space-y-4" onValueChange={handleTabChange}>
        <TabsList className="bg-card border w-full justify-start p-1 h-auto flex-wrap md:w-fit">
          <TabsTrigger value="overview" className="py-2 px-4">Configuração de Rotas</TabsTrigger>
          <TabsTrigger value="deliveries" className="py-2 px-4">Fila de Entregas</TabsTrigger>
          <TabsTrigger value="audit" className="py-2 px-4 flex items-center gap-1.5">
            <ShieldAlert className="h-3.5 w-3.5 text-red-500" /> Auditoria Break-Glass
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Routing Configuration */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            {/* WABA Routes Panel */}
            <Card className="border border-border/60">
              <CardHeader className="flex flex-row items-start justify-between pb-3">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2"><GitFork className="h-5 w-5 text-primary" /> Roteamento por WABA ID</CardTitle>
                  <CardDescription>
                    Define em qual cluster (Evolution API) residem todas as instâncias e números de uma mesma WABA.
                  </CardDescription>
                </div>
                <Button size="sm" onClick={() => setIsWabaDialogOpen(true)} className="h-8">
                  <Plus className="h-4 w-4 mr-1" /> WABA
                </Button>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>WABA ID</TableHead>
                        <TableHead>Cluster Destino</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead className="text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loading ? (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Carregando...</TableCell>
                        </TableRow>
                      ) : !data || data.wabaRoutes.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Nenhuma rota de WABA cadastrada.</TableCell>
                        </TableRow>
                      ) : (
                        data.wabaRoutes.map((route) => {
                          const clusterName = data.clusters.find(c => c.id === route.cluster_id)?.name || route.cluster_id;
                          return (
                            <TableRow key={route.waba_id}>
                              <TableCell className="font-semibold">{route.waba_id}</TableCell>
                              <TableCell className="font-mono text-xs max-w-[150px] truncate" title={clusterName}>
                                {clusterName}
                              </TableCell>
                              <TableCell>
                                <Badge 
                                  variant={
                                    route.state === 'active' ? 'default' : 
                                    route.state === 'migrating' ? 'secondary' : 'outline'
                                  }
                                >
                                  {route.state}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  onClick={() => handleDeleteWabaRoute(route.waba_id)}
                                  className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-500/10"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {/* Phone Number Routes Panel */}
            <Card className="border border-border/60">
              <CardHeader className="flex flex-row items-start justify-between pb-3">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2"><Server className="h-5 w-5 text-primary" /> Roteamento por Phone ID</CardTitle>
                  <CardDescription>
                    Mapeia o número corporativo Meta para a instância proprietária e workspace da Dialogy.
                  </CardDescription>
                </div>
                <Button size="sm" onClick={() => setIsPhoneDialogOpen(true)} className="h-8">
                  <Plus className="h-4 w-4 mr-1" /> Telefone
                </Button>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Phone Number ID</TableHead>
                        <TableHead>WABA ID</TableHead>
                        <TableHead>Instância / Workspace</TableHead>
                        <TableHead className="text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loading ? (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Carregando...</TableCell>
                        </TableRow>
                      ) : !data || data.phoneRoutes.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Nenhuma rota de telefone cadastrada.</TableCell>
                        </TableRow>
                      ) : (
                        data.phoneRoutes.map((route) => {
                          const clusterName = data.clusters.find(c => c.id === route.instance_id)?.name || route.instance_id;
                          return (
                            <TableRow key={route.phone_number_id}>
                              <TableCell className="font-semibold">{route.phone_number_id}</TableCell>
                              <TableCell className="text-xs">{route.waba_id}</TableCell>
                              <TableCell className="text-xs">
                                <div className="font-mono text-muted-foreground truncate max-w-[150px]" title={`Cluster: ${clusterName}`}>
                                  C: {clusterName}
                                </div>
                                <div className="font-mono text-muted-foreground truncate max-w-[150px]" title={`Workspace: ${route.workspace_id}`}>
                                  W: {route.workspace_id}
                                </div>
                              </TableCell>
                              <TableCell className="text-right">
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  onClick={() => handleDeletePhoneRoute(route.phone_number_id)}
                                  className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-500/10"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Tab 2: Queue & Deliveries */}
        <TabsContent value="deliveries" className="space-y-4">
          {/* Filters Form */}
          <Card className="border border-border/60">
            <CardContent className="pt-6">
              <form onSubmit={handleSearchSubmit} className="grid gap-3 md:grid-cols-[1.5fr_1fr_1fr_1fr_auto_auto]">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input 
                    placeholder="Buscar por Event Key ou erro..." 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-8 h-9"
                  />
                </div>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">Status (Todos)</option>
                  <option value="pending">Pending (Pendente)</option>
                  <option value="processed">Processed (Sucesso)</option>
                  <option value="retry">Retry (Retentando)</option>
                  <option value="quarantined">Quarantined (Quarentena)</option>
                  <option value="dead_letter">Dead Letter (DLQ)</option>
                </select>
                <select
                  value={wabaFilter}
                  onChange={(e) => setWabaFilter(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">WABA (Todas)</option>
                  {data?.wabaRoutes.map(w => (
                    <option key={w.waba_id} value={w.waba_id}>{w.waba_id}</option>
                  ))}
                </select>
                <select
                  value={phoneFilter}
                  onChange={(e) => setPhoneFilter(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">Telefone (Todos)</option>
                  {data?.phoneRoutes.map(p => (
                    <option key={p.phone_number_id} value={p.phone_number_id}>{p.phone_number_id}</option>
                  ))}
                </select>
                <Button type="submit" size="sm" className="h-9 font-medium px-4">
                  Filtrar
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={handleResetFilters} className="h-9 px-4">
                  Limpar
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Bulk actions and selected info bar */}
          {selectedDeliveries.length > 0 && (
            <div className="flex items-center justify-between p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200">
              <span className="text-sm font-semibold flex items-center gap-2">
                <RotateCcw className="h-4 w-4 text-amber-500" />
                {selectedDeliveries.length} item(s) selecionados para Replay manual.
              </span>
              <div className="flex items-center gap-2">
                <Button 
                  size="sm" 
                  variant="default"
                  onClick={() => handleReplay(selectedDeliveries)}
                  disabled={actionLoading}
                  className="bg-amber-600 hover:bg-amber-700 text-white font-semibold"
                >
                  Confirmar Replay em Lote
                </Button>
                <Button 
                  size="sm" 
                  variant="ghost" 
                  onClick={() => setSelectedDeliveries([])}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          )}

          {/* Deliveries Queue Table */}
          <Card className="border border-border/60">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10 text-center">
                        <input 
                          type="checkbox"
                          checked={data ? (selectedDeliveries.length === data.deliveries.filter(d => ['quarantined', 'dead_letter', 'retry', 'pending'].includes(d.status)).length && data.deliveries.length > 0) : false}
                          onChange={() => data && toggleSelectAll(data.deliveries)}
                          className="rounded border-gray-300 dark:border-gray-700 h-4 w-4"
                        />
                      </TableHead>
                      <TableHead>Event Key / ID</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Associação (WABA / Número)</TableHead>
                      <TableHead>Destino (Cluster)</TableHead>
                      <TableHead>Tentativas</TableHead>
                      <TableHead>Criado Em</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                          <Activity className="h-6 w-6 animate-spin mx-auto mb-2" />
                          Buscando fila de entrega...
                        </TableCell>
                      </TableRow>
                    ) : !data || data.deliveries.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                          Nenhum webhook encontrado na fila de entregas para os filtros selecionados.
                        </TableCell>
                      </TableRow>
                    ) : (
                      data.deliveries.map((delivery) => {
                        const clusterName = data.clusters.find(c => c.id === delivery.cluster_id)?.name || delivery.cluster_id || 'n/a';
                        const isReplayable = ['quarantined', 'dead_letter', 'retry', 'pending'].includes(delivery.status);
                        
                        return (
                          <React.Fragment key={delivery.id}>
                            <TableRow className={delivery.error_message ? 'border-b-0' : ''}>
                              <TableCell className="text-center">
                                <input 
                                  type="checkbox"
                                  disabled={!isReplayable}
                                  checked={selectedDeliveries.includes(delivery.id)}
                                  onChange={() => toggleSelectDelivery(delivery.id)}
                                  className="rounded border-gray-300 dark:border-gray-700 h-4 w-4 disabled:opacity-30"
                                />
                              </TableCell>
                              <TableCell>
                                <div className="font-semibold text-sm flex items-center gap-1.5">
                                  {delivery.event_key}
                                </div>
                                <span className="text-[10px] text-muted-foreground font-mono truncate block max-w-[120px]">{delivery.id}</span>
                              </TableCell>
                              <TableCell>{getStatusBadge(delivery.status)}</TableCell>
                              <TableCell>
                                <div className="text-xs font-medium">{delivery.waba_id || <span className="text-red-400">Sem WABA</span>}</div>
                                <div className="text-[10px] text-muted-foreground">{delivery.phone_number_id || 'Sem Telefone'}</div>
                              </TableCell>
                              <TableCell className="text-xs">
                                <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground truncate max-w-[120px] inline-block" title={clusterName}>
                                  {clusterName}
                                </span>
                              </TableCell>
                              <TableCell className="font-mono text-xs">
                                {delivery.attempts} / 20
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {formatDate(delivery.created_at)}
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  {isReplayable && (
                                    <Button 
                                      variant="outline" 
                                      size="icon"
                                      title="Forçar Replay Manual"
                                      onClick={() => handleReplay([delivery.id])}
                                      className="h-8 w-8 hover:bg-amber-500/10 hover:text-amber-500"
                                    >
                                      <RotateCcw className="h-4 w-4" />
                                    </Button>
                                  )}
                                  <Button 
                                    variant="outline" 
                                    size="icon"
                                    title="Descriptografar (Break-Glass)"
                                    onClick={() => {
                                      setSelectedDelivery(delivery);
                                      setDecryptReason('');
                                      setDecryptedPayload(null);
                                      setIsDecryptDialogOpen(true);
                                    }}
                                    className="h-8 w-8 text-primary hover:bg-primary/10"
                                  >
                                    <Unlock className="h-4 w-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                            {/* Error Row expander */}
                            {delivery.error_message && (
                              <TableRow className="bg-red-500/5 hover:bg-red-500/5 border-t-0">
                                <TableCell></TableCell>
                                <TableCell colSpan={7} className="pb-3 pt-0">
                                  <div className="text-xs bg-destructive/10 text-red-500 p-2.5 rounded border border-red-500/20 max-w-full overflow-x-auto whitespace-pre-wrap font-mono">
                                    <strong className="text-[10px] uppercase font-sans tracking-wide mr-1.5 block md:inline">Erro de Entrega:</strong>
                                    {delivery.error_message}
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </React.Fragment>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 3: Access Auditor (Break-glass) */}
        <TabsContent value="audit" className="space-y-4">
          <Card className="border border-border/60">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-red-500" /> Histórico de Acesso Break-Glass e Replay Manual
              </CardTitle>
              <CardDescription>
                Auditoria de segurança estrita. Exibe justificativas e logs de todas as tentativas de descriptografia e reprocessamento.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data/Hora</TableHead>
                      <TableHead>Operador (Superadmin)</TableHead>
                      <TableHead>Ação</TableHead>
                      <TableHead>Webhook / Detalhes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {auditLogsLoading ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                          Carregando logs de auditoria...
                        </TableCell>
                      </TableRow>
                    ) : auditLogs.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                          Nenhum acesso break-glass ou replay registrado no histórico de auditoria.
                        </TableCell>
                      </TableRow>
                    ) : (
                      auditLogs.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell className="text-xs whitespace-nowrap font-mono">{formatDate(log.created_at)}</TableCell>
                          <TableCell>
                            <div className="text-sm font-semibold">{log.user_name}</div>
                            <div className="text-xs text-muted-foreground font-mono">{log.user_email}</div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={log.action.includes('Decrypt') ? 'destructive' : 'outline'}>
                              {log.action}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="text-xs max-w-lg whitespace-pre-wrap">
                              {log.details.delivery_id && (
                                <div className="mb-1 text-muted-foreground font-mono">
                                  <strong>Delivery ID:</strong> {log.details.delivery_id}
                                </div>
                              )}
                              {log.details.delivery_ids && (
                                <div className="mb-1 text-muted-foreground font-mono">
                                  <strong>IDs Replayed:</strong> {log.details.delivery_ids.join(', ')}
                                </div>
                              )}
                              {log.details.reason && (
                                <div className="bg-card p-2 rounded border text-muted-foreground italic mt-1 font-serif text-sm">
                                  "{log.details.reason}"
                                </div>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialog 1: Add WABA Route */}
      <Dialog open={isWabaDialogOpen} onOpenChange={setIsWabaDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <form onSubmit={handleCreateWabaRoute}>
            <DialogHeader>
              <DialogTitle>Cadastrar Rota de WABA</DialogTitle>
              <DialogDescription>
                Mapeie uma conta WABA da Meta diretamente para um servidor proprietário.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="space-y-1.5">
                <label className="text-sm font-semibold">WABA ID (Meta WABA)</label>
                <Input 
                  placeholder="Ex: waba-prod-corp-9" 
                  value={wabaIdInput}
                  onChange={(e) => setWabaIdInput(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-semibold">Cluster Proprietário (Destino)</label>
                <select
                  value={wabaClusterInput}
                  onChange={(e) => setWabaClusterInput(e.target.value)}
                  required
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">Selecione o Cluster</option>
                  {data?.clusters.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-semibold">Estado de Transição da Rota</label>
                <select
                  value={wabaStateInput}
                  onChange={(e) => setWabaStateInput(e.target.value)}
                  required
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="active">active (Ativa / Drenando tráfego)</option>
                  <option value="migrating">migrating (Migração / Eventos Retidos)</option>
                  <option value="paused">paused (Pausada)</option>
                </select>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setIsWabaDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={actionLoading}>
                {actionLoading ? 'Gravando...' : 'Salvar Rota'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog 2: Add Phone Route */}
      <Dialog open={isPhoneDialogOpen} onOpenChange={setIsPhoneDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <form onSubmit={handleCreatePhoneRoute}>
            <DialogHeader>
              <DialogTitle>Cadastrar Rota de Telefone</DialogTitle>
              <DialogDescription>
                Adicione o Phone Number ID e associe-o a uma WABA, Instância de WhatsApp e Workspace.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 py-4 max-h-[70vh] overflow-y-auto px-1">
              <div className="space-y-1">
                <label className="text-sm font-semibold">Phone Number ID (Meta Phone ID)</label>
                <Input 
                  placeholder="Ex: 15550199999" 
                  value={phoneIdInput}
                  onChange={(e) => setPhoneIdInput(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-semibold">WABA ID Correspondente</label>
                <Input 
                  placeholder="Ex: waba-prod-corp-1" 
                  value={phoneWabaInput}
                  onChange={(e) => setPhoneWabaInput(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-semibold">Instância Destino (Cluster / Server)</label>
                <select
                  value={phoneInstanceInput}
                  onChange={(e) => setPhoneInstanceInput(e.target.value)}
                  required
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">Selecione a Instância</option>
                  {data?.clusters.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-semibold">Workspace ID (Dialogy Workspace UUID)</label>
                <Input 
                  placeholder="Ex: 00000000-0000-0000-0000-000000000001" 
                  value={phoneWorkspaceInput}
                  onChange={(e) => setPhoneWorkspaceInput(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-semibold">Estado</label>
                <select
                  value={phoneStateInput}
                  onChange={(e) => setPhoneStateInput(e.target.value)}
                  required
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="active">active</option>
                  <option value="pending">pending</option>
                  <option value="paused">paused</option>
                </select>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setIsPhoneDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={actionLoading}>
                {actionLoading ? 'Gravando...' : 'Salvar Rota'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog 3: Break-Glass Decryption Modal */}
      <Dialog open={isDecryptDialogOpen} onOpenChange={setIsDecryptDialogOpen}>
        <DialogContent className="sm:max-w-[650px] border-red-500/20">
          <DialogHeader>
            <DialogTitle className="text-red-500 flex items-center gap-2">
              <ShieldAlert className="h-6 w-6" /> Acesso de Segurança Break-Glass
            </DialogTitle>
            <DialogDescription>
              Descriptografia em tempo de execução de payloads brutos. Esta operação é restrita e monitorada.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-3">
            {/* Warning block */}
            <Alert variant="destructive" className="bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400">
              <AlertTriangle className="h-5 w-5" />
              <AlertTitle className="font-bold text-sm">AVISO DE SEGURANÇA E AUDITORIA</AlertTitle>
              <AlertDescription className="text-xs mt-1">
                Os payloads das webhooks contêm mensagens e dados privados. A descriptografia gera um log de auditoria permanente contendo sua assinatura, e-mail e justificativa. O uso indevido é passível de sanções administrativas e legais.
              </AlertDescription>
            </Alert>

            {selectedDelivery && (
              <div className="text-xs bg-muted p-3 rounded-lg space-y-1 font-mono">
                <div><strong>EVENT KEY:</strong> {selectedDelivery.event_key}</div>
                <div><strong>DELIVERY ID:</strong> {selectedDelivery.id}</div>
                <div><strong>ORIGEM WABA:</strong> {selectedDelivery.waba_id || 'n/a'}</div>
              </div>
            )}

            {!decryptedPayload ? (
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground flex items-center gap-1">
                  Justificativa de Acesso <span className="text-red-500">*</span>
                </label>
                <Textarea
                  placeholder="Descreva o incidente ou motivo técnico do troubleshoot (Ex: Investigar timeout na Evolution API para o cluster LuraHosting ID 570a...)"
                  value={decryptReason}
                  onChange={(e) => setDecryptReason(e.target.value)}
                  className="h-24 resize-none border-border"
                />
                <span className="text-[10px] text-muted-foreground block text-right">
                  Mínimo de 10 caracteres. Digite uma justificativa real para habilitar a descriptografia.
                </span>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold text-emerald-500 flex items-center gap-1">
                    <FileCode className="h-4 w-4" /> Payload Bruto Descriptografado
                  </label>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => {
                      navigator.clipboard.writeText(decryptedPayload);
                      toast({ title: 'Copiado!', description: 'Payload copiado para a área de transferência.' });
                    }}
                    className="h-7 text-[11px] font-medium"
                  >
                    Copiar Código
                  </Button>
                </div>
                <pre className="bg-slate-950 text-emerald-400 p-4 rounded-lg text-xs overflow-auto max-h-80 font-mono border border-emerald-500/20 whitespace-pre-wrap">
                  {decryptedPayload}
                </pre>
              </div>
            )}
          </div>

          <DialogFooter>
            {!decryptedPayload ? (
              <>
                <Button type="button" variant="ghost" onClick={() => setIsDecryptDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button 
                  type="button" 
                  variant="destructive"
                  onClick={handleDecryptSubmit}
                  disabled={actionLoading || decryptReason.trim().length < 10}
                  className="bg-red-600 hover:bg-red-700 text-white font-bold"
                >
                  {actionLoading ? 'Auditando & Descriptografando...' : 'Descriptografar Payload'}
                </Button>
              </>
            ) : (
              <Button type="button" onClick={() => setIsDecryptDialogOpen(false)} className="w-full">
                Fechar Visualização
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
