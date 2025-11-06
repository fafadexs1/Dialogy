
'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PlusCircle, Cpu, MemoryStick, HardDrive, Network, Server, Loader2, ArrowDown, ArrowUp } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState, useEffect, useCallback } from 'react';
import { getClusters, createCluster } from "@/actions/clusters";
import type { WhatsappCluster } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { createClient } from "@/lib/supabase/client";


function MetricBar({ value, label, icon: Icon, unit = '%' }: { value: number, label: string, icon: React.ElementType, unit?: string }) {
    const getColor = (val: number) => {
        if (val > 85) return 'bg-destructive';
        if (val > 65) return 'bg-yellow-500';
        return 'bg-primary';
    }

    return (
        <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5"><Icon className="h-3 w-3" /> {label}</span>
                <span className="font-mono">{value}{unit}</span>
            </div>
            <div className="w-full bg-muted rounded-full h-2">
                <div className={`h-2 rounded-full ${getColor(value)}`} style={{ width: `${value}%`}}></div>
            </div>
        </div>
    )
}

function AddClusterDialog({ onClusterAdded }: { onClusterAdded: () => void }) {
    const [isOpen, setIsOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [name, setName] = useState('');
    const [apiUrl, setApiUrl] = useState('');
    const [apiKey, setApiKey] = useState('');
    const { toast } = useToast();

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setIsSubmitting(true);
        
        const result = await createCluster({ name, apiUrl, apiKey });

        if (result.success) {
            toast({ title: "Cluster Adicionado!", description: "O novo servidor já está disponível." });
            setName('');
            setApiUrl('');
            setApiKey('');
            setIsOpen(false);
            onClusterAdded();
        } else {
            toast({ title: "Erro ao adicionar", description: result.error, variant: 'destructive' });
        }
        setIsSubmitting(false);
    }

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button>
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Adicionar Servidor
                </Button>
            </DialogTrigger>
            <DialogContent>
                 <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>Adicionar Novo Cluster</DialogTitle>
                        <DialogDescription>
                            Configure um novo servidor da Evolution API para ser usado no balanceamento de carga.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4 space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="name">Nome do Servidor</Label>
                            <Input id="name" name="name" placeholder="Ex: Servidor SP-02" required value={name} onChange={(e) => setName(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="apiUrl">URL da API</Label>
                            <Input id="apiUrl" name="apiUrl" placeholder="http://seu-dominio:8080" required value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="apiKey">Chave da API (API Key)</Label>
                            <Input id="apiKey" name="apiKey" type="password" required value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="ghost" onClick={() => setIsOpen(false)}>Cancelar</Button>
                        <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Adicionar
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

export default function EvolutionClustersPage() {
    const [clusters, setClusters] = useState<WhatsappCluster[]>([]);
    const [loading, setLoading] = useState(true);
    const { toast } = useToast();

    const fetchClusters = useCallback(async () => {
        // Only set loading on initial fetch
        if (clusters.length === 0) setLoading(true);
        
        const result = await getClusters();
        if (result.error) {
            toast({ title: "Erro ao carregar clusters", description: result.error, variant: "destructive" });
            setClusters([]);
        } else {
            setClusters(result.clusters || []);
        }
        setLoading(false);
    }, [toast, clusters.length]);
    
    useEffect(() => {
        fetchClusters();
        
        const supabase = createClient();
        const channel = supabase
            .channel('whatsapp-clusters-db-changes')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'whatsapp_clusters' },
                (payload) => {
                    console.log('Change received!', payload);
                    // Re-fetch data on any change
                    fetchClusters();
                }
            )
            .subscribe();

        // Cleanup subscription on component unmount
        return () => {
            supabase.removeChannel(channel);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);


    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <div>
                    <CardTitle>Clusters de WhatsApp (Evolution API)</CardTitle>
                    <CardDescription>
                        Gerencie os servidores da Evolution API disponíveis para as instâncias dos usuários.
                    </CardDescription>
                </div>
                <AddClusterDialog onClusterAdded={fetchClusters} />
            </div>
            
            {loading ? (
                 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    <Card className="h-80 animate-pulse bg-muted"></Card>
                    <Card className="h-80 animate-pulse bg-muted"></Card>
                 </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {clusters.map(cluster => {
                        const storageMetrics = cluster.metrics?.storage;
                        const networkMetrics = cluster.metrics?.network;
                        const storageUsage = storageMetrics && storageMetrics.total > 0
                            ? (storageMetrics.used / storageMetrics.total) * 100
                            : 0;

                        return (
                            <Card key={cluster.id}>
                                <CardHeader>
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <CardTitle className="flex items-center gap-2">
                                                <div className={`w-3 h-3 rounded-full ${cluster.is_active ? 'bg-green-500' : 'bg-gray-400'}`}></div>
                                                {cluster.name}
                                            </CardTitle>
                                            <CardDescription className="mt-1">{cluster.api_url}</CardDescription>
                                        </div>
                                        <Switch checked={cluster.is_active} id={`active-${cluster.id}`} />
                                    </div>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <MetricBar value={cluster.metrics?.cpu || 0} label="CPU" icon={Cpu} />
                                    <MetricBar value={cluster.metrics?.memory || 0} label="Memória" icon={MemoryStick} />
                                    
                                    <div className="space-y-1">
                                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                                            <span className="flex items-center gap-1.5"><HardDrive className="h-3 w-3" /> Armazenamento</span>
                                            <span className="font-mono">{storageMetrics ? `${storageMetrics.used.toFixed(1)}GB / ${storageMetrics.total.toFixed(1)}GB` : 'N/A'}</span>
                                        </div>
                                        <div className="w-full bg-muted rounded-full h-2">
                                            <div className="h-2 rounded-full bg-cyan-500" style={{ width: `${storageUsage}%`}}></div>
                                        </div>
                                    </div>
                                    
                                     <div className="space-y-1">
                                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                                            <span className="flex items-center gap-1.5"><Network className="h-3 w-3" /> Rede</span>
                                            <div className="flex items-center gap-2 font-mono">
                                                <span className='flex items-center gap-1'><ArrowDown className="h-3 w-3 text-emerald-500"/>{networkMetrics?.down || 0} Mbps</span>
                                                <span className='flex items-center gap-1'><ArrowUp className="h-3 w-3 text-sky-500"/>{networkMetrics?.up || 0} Mbps</span>
                                            </div>
                                        </div>
                                     </div>

                                    <div className="pt-2 border-t mt-4">
                                        <div className="flex items-center justify-between text-sm">
                                            <span className="text-muted-foreground flex items-center gap-2"><Server className="h-4 w-4" /> Instâncias</span>
                                            <span className="font-bold">{cluster.metrics?.instances_count || 0}</span>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
