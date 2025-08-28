
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
import { cn } from "@/lib/utils";
import Link from 'next/link';
import { getCampaigns, deleteCampaign, deleteCampaigns } from "@/actions/campaigns";
import type { Campaign, User } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

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
        sending: { icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />, text: "Enviando", className: "bg-blue-500 hover:bg-blue-500" },
        draft: { icon: <Clock className="h-3.5 w-3.5" />, text: "Rascunho", className: "bg-gray-500 hover:bg-gray-500" },
        paused: { icon: <PauseCircle className="h-3.5 w-3.5" />, text: "Pausada", className: "bg-yellow-500 hover:bg-yellow-500" },
        failed: { icon: <XCircle className="h-3.5 w-3.5" />, text: "Falhou", className: "bg-red-600 hover:bg-red-600" },
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
    parallel: { name: "WhatsApp Paralelo", className: "bg-sky-500" },
    api: { name: "WhatsApp API Oficial", className: "bg-purple-500" },
  }
  // Fallback to parallel if channel is not defined
  const current = channelInfo[channel || 'parallel'];

  return (
    <div className="inline-flex items-center gap-2 text-xs rounded-full border px-2.5 py-1 bg-background">
      <div className={cn("size-2 rounded-full", current.className)} />
      <span className="font-medium">{current.name}</span>
    </div>
  );
}

// --------- Main component ----------
export default function CampaignsPageClient({ user: initialUser }: { user: { id: string; activeWorkspaceId: string | null } }) {
  const router = useRouter();
  const { toast } = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [channel, setChannel] = useState<Campaign['channel'] | "all">("all");

  useEffect(() => {
    const fetchUser = async () => {
        const res = await fetch('/api/user');
        if (res.ok) {
            setUser(await res.json());
        } else {
            router.push('/login');
        }
    };
    fetchUser();
  }, [router]);

  const fetchCampaigns = useCallback(async () => {
    if (!user?.activeWorkspaceId) return;
    setLoading(true);
    const result = await getCampaigns(user.activeWorkspaceId);
    if (result.error) {
        toast({ title: 'Erro ao buscar campanhas', description: result.error, variant: 'destructive'});
    } else {
        setCampaigns(result.campaigns || []);
    }
    setLoading(false);
  }, [user?.activeWorkspaceId, toast]);

  useEffect(() => {
    if (user) {
        fetchCampaigns();
    }
  }, [user, fetchCampaigns]);

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
              <Send className="h-5 w-5"/>
            </div>
            <div>
              <h1 className="text-xl font-semibold leading-tight">Campanhas</h1>
              <p className="text-xs text-muted-foreground">Gerencie e acompanhe seus envios de WhatsApp</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" className="gap-2" onClick={fetchCampaigns} disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin"/> : <RefreshCw className="h-4 w-4"/>} 
                Atualizar
            </Button>
            <Button asChild className="gap-2">
                <Link href="/campaigns/new">
                    <Plus className="h-4 w-4"/> Nova campanha
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
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="all">Todos</TabsTrigger>
                    <TabsTrigger value="parallel">Paralelo</TabsTrigger>
                    <TabsTrigger value="api" disabled>API</TabsTrigger>
                  </TabsList>
                </Tabs>

                <Separator />

                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">Busca</label>
                  <div className="flex items-center gap-2">
                    <div className="relative w-full">
                      <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground"/>
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
                      <Button size="sm" variant="secondary" className="gap-2" disabled><Copy className="h-4 w-4"/>Duplicar</Button>
                      <AlertDialog>
                          <AlertDialogTrigger asChild>
                              <Button size="sm" variant="destructive" className="gap-2"><Trash2 className="h-4 w-4"/>Excluir</Button>
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
                  <div className="col-span-2">Entrega</div>
                  <div className="col-span-2 text-right">Ações</div>
                </div>

                {/* Rows */}
                 {loading ? (
                    <div className="flex items-center justify-center p-10"><Loader2 className="h-8 w-8 animate-spin text-primary"/></div>
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
                        <li key={c.id} className="grid grid-cols-12 items-center gap-4 py-3 hover:bg-muted/40 rounded-lg -mx-2 px-2">
                            <div className="col-span-1 flex items-center">
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

                            <div className="col-span-2">
                                <div className="flex items-center justify-end gap-2">
                                 <AlertDialog>
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-8 w-8">
                                            <MoreVertical className="h-4 w-4" />
                                        </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="w-44">
                                            <DropdownMenuItem className="gap-2" ><Send className="h-4 w-4"/>Reenviar</DropdownMenuItem>
                                            <DropdownMenuItem className="gap-2" ><Copy className="h-4 w-4"/>Duplicar</DropdownMenuItem>
                                            <AlertDialogTrigger asChild>
                                                <DropdownMenuItem className="gap-2 text-red-600 focus:text-red-600" onSelect={(e) => e.preventDefault()}>
                                                    <Trash2 className="h-4 w-4"/>Excluir
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
    </div>
  );
}
