
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PlusCircle, Cpu, MemoryStick, HardDrive, Network, Server } from "lucide-react";
import { Badge } from "@/components/ui/badge";

async function getClusters() {
    // Mock data for now. In the future, this will fetch from the whatsapp_clusters table.
    return [
        { id: '1', name: 'Servidor SP-01', api_url: 'http://123.45.67.89:8080', is_active: true, metrics: { cpu: 45, memory: 60, storage: 75, network: 20, instances_count: 150 } },
        { id: '2', name: 'Servidor RJ-01', api_url: 'http://98.76.54.32:8080', is_active: true, metrics: { cpu: 20, memory: 40, storage: 50, network: 10, instances_count: 80 } },
        { id: '3', name: 'Servidor AWS-US-EAST', api_url: 'http://aws.cluster.com', is_active: false, metrics: { cpu: 0, memory: 0, storage: 0, network: 0, instances_count: 0 } },
    ];
}

function MetricBar({ value, label, icon: Icon }: { value: number, label: string, icon: React.ElementType }) {
    const getColor = (val: number) => {
        if (val > 85) return 'bg-destructive';
        if (val > 65) return 'bg-yellow-500';
        return 'bg-primary';
    }

    return (
        <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5"><Icon className="h-3 w-3" /> {label}</span>
                <span className="font-mono">{value}%</span>
            </div>
            <div className="w-full bg-muted rounded-full h-2">
                <div className={`h-2 rounded-full ${getColor(value)}`} style={{ width: `${value}%`}}></div>
            </div>
        </div>
    )
}

export default async function ClustersPage() {
    const clusters = await getClusters();

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <div>
                    <CardTitle>Clusters de WhatsApp</CardTitle>
                    <CardDescription>
                        Gerencie os servidores da Evolution API disponíveis para as instâncias dos usuários.
                    </CardDescription>
                </div>
                <Button>
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Adicionar Servidor
                </Button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {clusters.map(cluster => (
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
                                <Badge variant={cluster.is_active ? 'default' : 'secondary'}>{cluster.is_active ? 'Ativo' : 'Inativo'}</Badge>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <MetricBar value={cluster.metrics.cpu} label="CPU" icon={Cpu} />
                            <MetricBar value={cluster.metrics.memory} label="Memória" icon={MemoryStick} />
                            <MetricBar value={cluster.metrics.storage} label="Armazenamento" icon={HardDrive} />
                             <MetricBar value={cluster.metrics.network} label="Rede" icon={Network} />
                             <div className="pt-2 border-t mt-4">
                                 <div className="flex items-center justify-between text-sm">
                                    <span className="text-muted-foreground flex items-center gap-2"><Server className="h-4 w-4" /> Instâncias</span>
                                    <span className="font-bold">{cluster.metrics.instances_count}</span>
                                </div>
                             </div>
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    )
}
