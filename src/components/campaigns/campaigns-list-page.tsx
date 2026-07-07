
'use client';

import React, { useMemo, useState, useEffect, useCallback } from "react";
import { useRouter } from 'next/navigation';
import {
  Plus,
  CheckCircle2,
  Clock,
  MoreVertical,
  Filter,
  Search,
  Copy,
  Trash2,
  ChevronDown,
  Send,
  RefreshCw,
  Loader2,
  XCircle,
  PauseCircle,
  Eye,
  MailCheck,
  AlertTriangle,
  Users,
  PlayCircle,
  Ban,
  CalendarClock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import Link from 'next/link';
import { cancelCampaign, getCampaignDetails, getCampaigns, deleteCampaign, deleteCampaigns, pauseCampaign, resumeCampaign } from "@/actions/campaigns";
import type { Campaign, CampaignDetails } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useCurrentUser } from "@/hooks/use-online-status";

// ------- UI helpers ---------
function Progress({ value }: { value: number }) {
  return (
    <div className="w-full h-2 rounded-full bg-muted">
      <div
        className="h-2 rounded-full bg-primary transition-all"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
      />
    </div>
  );
}

function StateBadge({ status }: { status: Campaign['status'] }) {
  const stateMap = {
    completed: { icon: <CheckCircle2 className="h-3.5 w-3.5" />, text: "Envio concluído", className: "bg-emerald-600 hover:bg-emerald-600" },
    scheduled: { icon: <CalendarClock className="h-3.5 w-3.5" />, text: "Agendada", className: "bg-violet-600 hover:bg-violet-600" },
    sending: { icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />, text: "Enviando", className: "bg-blue-500 hover:bg-blue-500" },
    draft: { icon: <Clock className="h-3.5 w-3.5" />, text: "Rascunho", className: "bg-gray-500 hover:bg-gray-500" },
    paused: { icon: <PauseCircle className="h-3.5 w-3.5" />, text: "Pausada", className: "bg-yellow-500 hover:bg-yellow-500" },
    failed: { icon: <XCircle className="h-3.5 w-3.5" />, text: "Falhou", className: "bg-red-600 hover:bg-red-600" },
    cancelled: { icon: <Ban className="h-3.5 w-3.5" />, text: "Cancelada", className: "bg-slate-600 hover:bg-slate-600" },
  };

  const current = stateMap[status] || stateMap.draft;

  return (
    <Badge className={cn("gap-1", current.className)}>
      {current.icon} {current.text}
    </Badge>
  );
}

function ChannelPill({ channel }: { channel: Campaign['channel'] }) {
  const channelInfo = {
    whatsapp_baileys: { name: "WhatsApp conectado", className: "bg-emerald-500" },
    whatsapp_cloud: { name: "WhatsApp Cloud", className: "bg-green-600" },
    telegram: { name: "Telegram", className: "bg-sky-500" },
    messenger: { name: "Messenger (Facebook)", className: "bg-blue-600" },
    instagram: { name: "Instagram Direct", className: "bg-pink-500" },
  }
  const current = channelInfo[channel || 'whatsapp_baileys'];

  return (
    <div className="inline-flex items-center gap-2 text-xs rounded-full border px-2.5 py-1 bg-background">
      <div className={cn("size-2 rounded-full", current.className)} />
      <span className="font-medium">{current.name}</span>
    </div>
  );
}

const RECIPIENT_STATUS_LABELS = {
  waiting: 'Aguardando',
  scheduled: 'Agendada',
  processing: 'Enviando',
  sent: 'Enviada',
  failed: 'Falhou',
  paused: 'Pausada',
  cancelled: 'Cancelada',
} as const;

// --------- Main component ----------
export default function CampaignsPageClient({ user: initialUser }: { user: { id: string; activeWorkspaceId: string | null } }) {
  const router = useRouter();
  const { toast } = useToast();
  const user = useCurrentUser();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [channel, setChannel] = useState<Campaign['channel'] | "all">("all");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [campaignDetails, setCampaignDetails] = useState<CampaignDetails | null>(null);
  const [campaignActionId, setCampaignActionId] = useState<string | null>(null);

  const fetchCampaigns = useCallback(async (silent = false) => {
    if (!user?.activeWorkspaceId) return;
    if (!silent) setLoading(true);
    const result = await getCampaigns(user.activeWorkspaceId);
    if (result.error) {
      toast({ title: 'Erro ao buscar campanhas', description: result.error, variant: 'destructive' });
    } else {
      setCampaigns(result.campaigns || []);
    }
    if (!silent) setLoading(false);
  }, [user?.activeWorkspaceId, toast]);

  useEffect(() => {
    if (user) {
      fetchCampaigns();
    }
  }, [user, fetchCampaigns]);

  useEffect(() => {
    if (!campaigns.some(campaign => campaign.status === 'sending' || campaign.status === 'scheduled')) return;

    const intervalId = window.setInterval(() => {
      fetchCampaigns(true);
    }, 2000);

    return () => window.clearInterval(intervalId);
  }, [campaigns, fetchCampaigns]);

  useEffect(() => {
    if (!detailsOpen || !campaignDetails?.id || !user?.activeWorkspaceId) return;

    const intervalId = window.setInterval(async () => {
      const result = await getCampaignDetails(user.activeWorkspaceId!, campaignDetails.id);
      if (result.campaign) {
        setCampaignDetails(result.campaign);
      }
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, [detailsOpen, campaignDetails?.id, user?.activeWorkspaceId]);

  const filtered = useMemo(() => {
    return campaigns.filter((c) =>
      (channel === "all" || c.channel === channel) &&
      c.name.toLowerCase().includes(query.toLowerCase())
    );
  }, [query, channel, campaigns]);

  const toggleAll = (checked: boolean) => {
    setSelected(checked ? filtered.map((c) => c.id) : []);
  };

  const toggleRow = (id: string, checked: boolean) => {
    setSelected((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)));
  };

  const handleDeleteCampaign = async (campaignId: string) => {
    const result = await deleteCampaign(campaignId);
    if (result.error) {
      toast({ title: "Erro ao excluir campanha", description: result.error, variant: "destructive" });
    } else {
      toast({ title: "Campanha excluída com sucesso!" });
      fetchCampaigns(); // Re-fetch the list
      setSelected([]);
    }
  }

  const handleDeleteMultipleCampaigns = async () => {
    const result = await deleteCampaigns(selected);
    if (result.error) {
      toast({ title: "Erro ao excluir campanhas", description: result.error, variant: "destructive" });
    } else {
      toast({ title: `${selected.length} campanhas excluídas com sucesso!` });
      fetchCampaigns(); // Re-fetch the list
      setSelected([]);
    }
  };

  const handleExecutionAction = async (
    campaignId: string,
    action: 'pause' | 'resume' | 'cancel',
  ) => {
    setCampaignActionId(campaignId);
    const result = action === 'pause'
      ? await pauseCampaign(campaignId)
      : action === 'resume'
        ? await resumeCampaign(campaignId)
        : await cancelCampaign(campaignId);
    setCampaignActionId(null);

    if (result.error) {
      toast({ title: 'Não foi possível atualizar a campanha', description: result.error, variant: 'destructive' });
      return;
    }

    const title = action === 'pause'
      ? 'Campanha pausada'
      : action === 'resume'
        ? 'Campanha retomada'
        : 'Campanha cancelada';
    toast({ title });
    await fetchCampaigns(true);
    if (detailsOpen && user?.activeWorkspaceId) {
      const details = await getCampaignDetails(user.activeWorkspaceId, campaignId);
      if (details.campaign) setCampaignDetails(details.campaign);
    }
  };

  const openCampaignDetails = async (campaign: Campaign) => {
    if (!user?.activeWorkspaceId) return;
    setDetailsOpen(true);
    setDetailsLoading(true);
    setCampaignDetails(null);

    const result = await getCampaignDetails(user.activeWorkspaceId, campaign.id);
    if (result.error || !result.campaign) {
      toast({ title: "Erro ao buscar detalhes", description: result.error || "Campanha nao encontrada.", variant: "destructive" });
      setDetailsOpen(false);
    } else {
      setCampaignDetails(result.campaign);
    }
    setDetailsLoading(false);
  };


  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/40">
      {/* Topbar */}
      <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground font-bold shadow-sm">
              <Send className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold leading-tight">Campanhas</h1>
              <p className="text-xs text-muted-foreground">Gerencie e acompanhe seus envios em massa por canal</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" className="gap-2" onClick={() => fetchCampaigns()} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Atualizar
            </Button>
            <Button asChild className="gap-2">
              <Link href="/campaigns/new">
                <Plus className="h-4 w-4" /> Nova campanha
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="px-6 py-6">
        <div className="grid grid-cols-12 gap-6">
          {/* Sidebar */}
          <aside className="col-span-12 md:col-span-3">
            <Card className="sticky top-28">
              <CardHeader>
                <CardTitle className="text-base">Canais</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Tabs value={channel} onValueChange={(v) => setChannel(v as any)} className="w-full">
                  <TabsList className="grid h-auto w-full grid-cols-2 gap-1">
                    <TabsTrigger value="all">Todos</TabsTrigger>
                    <TabsTrigger value="whatsapp_baileys">WhatsApp</TabsTrigger>
                    <TabsTrigger value="whatsapp_cloud">Cloud</TabsTrigger>
                    <TabsTrigger value="telegram">Telegram</TabsTrigger>
                    <TabsTrigger value="messenger">Messenger</TabsTrigger>
                    <TabsTrigger value="instagram">Instagram</TabsTrigger>
                  </TabsList>
                </Tabs>

                <Separator />

                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">Busca</label>
                  <div className="flex items-center gap-2">
                    <div className="relative w-full">
                      <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Procurar campanha…"
                        className="pl-8"
                      />
                    </div>
                    <Button variant="outline" size="icon" aria-label="Filtros">
                      <Filter className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <Separator />

                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Ações em lote:</p>
                  {selected.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" className="gap-2" disabled><Copy className="h-4 w-4" />Duplicar</Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="destructive" className="gap-2"><Trash2 className="h-4 w-4" />Excluir</Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Excluir {selected.length} campanhas?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Esta ação não pode ser desfeita. As campanhas selecionadas e seus históricos serão removidos permanentemente.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={handleDeleteMultipleCampaigns}>Excluir</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  ) : <p className="text-xs text-muted-foreground">Selecione uma ou mais campanhas para habilitar.</p>}
                </div>
              </CardContent>
            </Card>
          </aside>

          {/* Content */}
          <section className="col-span-12 md:col-span-9 space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Campanhas por canal</CardTitle>
                  <div className="text-xs text-muted-foreground">{filtered.length} resultados</div>
                </div>
              </CardHeader>
              <CardContent>
                {/* Table header */}
                <div className="grid grid-cols-12 items-center gap-4 border-y py-2 text-xs font-medium text-muted-foreground">
                  <div className="col-span-1 flex items-center">
                    <Checkbox
                      checked={selected.length === filtered.length && filtered.length > 0}
                      onCheckedChange={(v) => toggleAll(Boolean(v))}
                      aria-label="Selecionar todos"
                    />
                  </div>
                  <div className="col-span-3">Nome</div>
                  <div className="col-span-2">Estado</div>
                  <div className="col-span-2">Destinatários</div>
                  <div className="col-span-2">Progresso</div>
                  <div className="col-span-2 text-right">Ações</div>
                </div>

                {/* Rows */}
                {loading ? (
                  <div className="flex items-center justify-center p-10"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
                ) : filtered.length === 0 ? (
                  <div className="text-center p-10">
                    <h3 className="text-lg font-medium">Nenhuma campanha encontrada</h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Tente ajustar seus filtros ou crie uma nova campanha.
                    </p>
                  </div>
                ) : (
                  <ul className="divide-y">
                    {filtered.map((c) => (
                      <li
                        key={c.id}
                        className="grid cursor-pointer grid-cols-12 items-center gap-4 rounded-lg -mx-2 px-2 py-3 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => openCampaignDetails(c)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            openCampaignDetails(c);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        <div className="col-span-1 flex items-center" onClick={(event) => event.stopPropagation()}>
                          <Checkbox
                            checked={selected.includes(c.id)}
                            onCheckedChange={(v) => toggleRow(c.id, Boolean(v))}
                            aria-label={`Selecionar ${c.name}`}
                          />
                        </div>

                        <div className="col-span-3 flex flex-col items-start gap-1">
                          <div className="font-medium leading-tight">{c.name}</div>
                          <div className="flex items-center gap-3">
                            <ChannelPill channel={c.channel} />
                            <div className="text-xs text-muted-foreground">ID: {c.id.split('-')[0]}</div>
                          </div>
                        </div>

                        <div className="col-span-2">
                          <StateBadge status={c.status} />
                        </div>

                        <div className="col-span-2">
                          <Badge variant="secondary" className="font-mono">{c.recipients} contato(s)</Badge>
                        </div>

                        <div className="col-span-2">
                          <div className="flex items-center gap-3">
                            <span className="w-10 text-right text-sm tabular-nums">{c.progress?.toFixed(0) ?? 0}%</span>
                            <Progress value={c.progress ?? 0} />
                          </div>
                        </div>

                        <div
                          className="col-span-2"
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => event.stopPropagation()}
                        >
                          <div className="flex items-center justify-end gap-2">
                            <AlertDialog>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8">
                                    <MoreVertical className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-44">
                                  {(c.status === 'sending' || c.status === 'scheduled') && (
                                    <DropdownMenuItem
                                      className="gap-2"
                                      disabled={campaignActionId === c.id}
                                      onSelect={() => void handleExecutionAction(c.id, 'pause')}
                                    >
                                      <PauseCircle className="h-4 w-4" />Pausar
                                    </DropdownMenuItem>
                                  )}
                                  {c.status === 'paused' && (
                                    <DropdownMenuItem
                                      className="gap-2"
                                      disabled={campaignActionId === c.id}
                                      onSelect={() => void handleExecutionAction(c.id, 'resume')}
                                    >
                                      <PlayCircle className="h-4 w-4" />Retomar
                                    </DropdownMenuItem>
                                  )}
                                  {['draft', 'scheduled', 'sending', 'paused'].includes(c.status) && (
                                    <DropdownMenuItem
                                      className="gap-2 text-amber-700 focus:text-amber-700"
                                      disabled={campaignActionId === c.id}
                                      onSelect={() => void handleExecutionAction(c.id, 'cancel')}
                                    >
                                      <Ban className="h-4 w-4" />Cancelar envio
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuItem className="gap-2" ><Send className="h-4 w-4" />Reenviar</DropdownMenuItem>
                                  <DropdownMenuItem className="gap-2" ><Copy className="h-4 w-4" />Duplicar</DropdownMenuItem>
                                  <AlertDialogTrigger asChild>
                                    <DropdownMenuItem className="gap-2 text-red-600 focus:text-red-600" onSelect={(e) => e.preventDefault()}>
                                      <Trash2 className="h-4 w-4" />Excluir
                                    </DropdownMenuItem>
                                  </AlertDialogTrigger>
                                </DropdownMenuContent>
                              </DropdownMenu>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Tem certeza que deseja excluir esta campanha?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Esta ação não pode ser desfeita. A campanha "{c.name}" e seu histórico serão removidos permanentemente.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => handleDeleteCampaign(c.id)}>Excluir</AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {/* Footer */}
                <div className="mt-4 flex items-center justify-between text-sm">
                  <div className="text-muted-foreground">
                    <span className="font-medium">{selected.length}</span> de {filtered.length} selecionada(s)
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>
        </div>
      </main>

      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="flex max-h-[90vh] max-w-5xl flex-col gap-0 overflow-hidden p-0">
          {detailsLoading || !campaignDetails ? (
            <div className="flex min-h-72 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <>
              <DialogHeader className="border-b p-6 pb-5">
                <div className="flex flex-wrap items-center gap-3 pr-8">
                  <DialogTitle className="text-xl">{campaignDetails.name}</DialogTitle>
                  <StateBadge status={campaignDetails.status} />
                  <ChannelPill channel={campaignDetails.channel} />
                </div>
                <DialogDescription>
                  ID {campaignDetails.id.split('-')[0]} | Criada em {format(new Date(campaignDetails.created_at), "dd/MM/yyyy 'as' HH:mm", { locale: ptBR })}
                </DialogDescription>
                <div className="flex flex-wrap gap-2 pt-2">
                  {(campaignDetails.status === 'sending' || campaignDetails.status === 'scheduled') && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={campaignActionId === campaignDetails.id}
                      onClick={() => void handleExecutionAction(campaignDetails.id, 'pause')}
                    >
                      <PauseCircle className="mr-2 h-4 w-4" />Pausar
                    </Button>
                  )}
                  {campaignDetails.status === 'paused' && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={campaignActionId === campaignDetails.id}
                      onClick={() => void handleExecutionAction(campaignDetails.id, 'resume')}
                    >
                      <PlayCircle className="mr-2 h-4 w-4" />Retomar
                    </Button>
                  )}
                  {['draft', 'scheduled', 'sending', 'paused'].includes(campaignDetails.status) && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-amber-700 hover:text-amber-700"
                      disabled={campaignActionId === campaignDetails.id}
                      onClick={() => void handleExecutionAction(campaignDetails.id, 'cancel')}
                    >
                      <Ban className="mr-2 h-4 w-4" />Cancelar envio
                    </Button>
                  )}
                </div>
              </DialogHeader>

              <ScrollArea className="max-h-[calc(90vh-112px)]">
                <div className="space-y-6 p-6">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    {[
                      { label: "Destinatarios", value: campaignDetails.metrics.total, icon: Users },
                      { label: "Enviadas", value: campaignDetails.metrics.sent, icon: Send },
                      { label: "Entregues confirmadas", value: campaignDetails.metrics.delivered, icon: MailCheck },
                      { label: "Lidas", value: campaignDetails.metrics.read, icon: Eye },
                      { label: "Falhas", value: campaignDetails.metrics.failed, icon: AlertTriangle },
                    ].map((metric) => (
                      <div key={metric.label} className="rounded-lg border bg-muted/20 p-4">
                        <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                          <metric.icon className="h-4 w-4" />
                          {metric.label}
                        </div>
                        <div className="text-2xl font-semibold tabular-nums">{metric.value}</div>
                      </div>
                    ))}
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-lg border p-4">
                      <div className="mb-2 flex items-center justify-between text-sm">
                        <span>Taxa de entrega confirmada</span>
                        <span className="font-semibold tabular-nums">{campaignDetails.metrics.deliveryRate.toFixed(0)}%</span>
                      </div>
                      <Progress value={campaignDetails.metrics.deliveryRate} />
                    </div>
                    <div className="rounded-lg border p-4">
                      <div className="mb-2 flex items-center justify-between text-sm">
                        <span>Taxa de leitura</span>
                        <span className="font-semibold tabular-nums">{campaignDetails.metrics.readRate.toFixed(0)}%</span>
                      </div>
                      <Progress value={campaignDetails.metrics.readRate} />
                    </div>
                  </div>

                  {campaignDetails.metrics.linkedMessages < campaignDetails.metrics.sent && (
                    <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-muted-foreground">
                      Parte deste envio foi criada antes do rastreamento detalhado. Entregas e leituras aparecem somente quando o provedor possui uma mensagem vinculada a campanha.
                    </div>
                  )}

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-lg border p-4">
                      <h3 className="mb-3 text-sm font-semibold">Informacoes do envio</h3>
                      <div className="space-y-2 text-sm text-muted-foreground">
                        <p>Conta: <span className="text-foreground">{campaignDetails.destination_id || campaignDetails.instance_name}</span></p>
                        <p>Modo: <span className="text-foreground">{campaignDetails.schedule_config?.mode === 'custom' ? 'Customizado' : 'Imediato'}</span></p>
                        {campaignDetails.schedule_config?.mode === 'custom' && (
                          <>
                            <p>Janela: <span className="text-foreground">{campaignDetails.schedule_config.windowStart}–{campaignDetails.schedule_config.windowEnd}</span></p>
                            <p>Data limite: <span className="text-foreground">{campaignDetails.scheduled_end_at ? format(new Date(campaignDetails.scheduled_end_at), "dd/MM/yyyy HH:mm", { locale: ptBR }) : "-"}</span></p>
                          </>
                        )}
                        <p>Inicio: <span className="text-foreground">{campaignDetails.started_at ? format(new Date(campaignDetails.started_at), "dd/MM/yyyy HH:mm", { locale: ptBR }) : "-"}</span></p>
                        <p>Conclusao: <span className="text-foreground">{campaignDetails.completed_at ? format(new Date(campaignDetails.completed_at), "dd/MM/yyyy HH:mm", { locale: ptBR }) : "-"}</span></p>
                        {campaignDetails.pause_reason && <p>Motivo da pausa: <span className="text-foreground">{campaignDetails.pause_reason}</span></p>}
                        {Boolean(campaignDetails.opted_out_count) && <p>Opt-outs removidos: <span className="text-foreground">{campaignDetails.opted_out_count}</span></p>}
                      </div>
                    </div>
                    <div className="rounded-lg border p-4">
                      <h3 className="mb-3 text-sm font-semibold">Conteudo enviado</h3>
                      <p className="max-h-24 overflow-y-auto whitespace-pre-wrap text-sm text-muted-foreground">
                        {campaignDetails.message || "-"}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-lg border">
                    <div className="border-b px-4 py-3">
                      <h3 className="text-sm font-semibold">Destinatarios</h3>
                    </div>
                    <div className="max-h-72 divide-y overflow-y-auto">
                      {campaignDetails.recipientDetails.map((recipient) => {
                        const messageStatus = String(recipient.api_message_status || '').toUpperCase();
                        const read = messageStatus === 'READ' || messageStatus === 'PLAYED';
                        const receiptLabel = read
                          ? "Lida"
                          : ['DELIVERED', 'DELIVERY', 'DELIVERY_ACK'].includes(messageStatus)
                            ? "Entregue"
                            : messageStatus === 'SENT'
                              ? "Enviada"
                              : messageStatus || "Sem recibo";
                        return (
                          <div key={recipient.id} className="grid gap-2 px-4 py-3 text-sm sm:grid-cols-[1fr_auto_auto] sm:items-center">
                            <div>
                              <p className="font-medium">{recipient.contact_name || "Contato sem nome"}</p>
                              <p className="text-xs text-muted-foreground">{recipient.phone_number_jid || "-"}</p>
                            </div>
                            <Badge variant="secondary">
                              {RECIPIENT_STATUS_LABELS[recipient.status]}
                            </Badge>
                            <span className="min-w-24 text-right text-xs text-muted-foreground">
                              {receiptLabel}
                            </span>
                            {recipient.error_message && (
                              <p className="text-xs text-red-500 sm:col-span-3">{recipient.error_message}</p>
                            )}
                            {recipient.scheduled_at && recipient.status !== 'sent' && (
                              <p className="text-xs text-muted-foreground sm:col-span-3">
                                Prevista para {format(new Date(recipient.scheduled_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                                {recipient.attempt_count ? ` · ${recipient.attempt_count}/${recipient.max_attempts || 3} tentativa(s)` : ''}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </ScrollArea>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
