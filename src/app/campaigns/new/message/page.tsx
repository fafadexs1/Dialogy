
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useCampaignState } from '../use-campaign-state';
import { MainLayout } from '@/components/layout/main-layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getEvolutionApiInstances } from '@/actions/evolution-api';
import type { EvolutionInstance } from '@/lib/types';
import { useAuth } from '@/hooks/use-auth';
import { ArrowRight, Loader2 } from 'lucide-react';
import { CampaignSteps } from '../campaign-steps';
import { Skeleton } from '@/components/ui/skeleton';

export default function CampaignMessagePage() {
    const user = useAuth();
    const router = useRouter();
    const { campaignData, setCampaignData, clearCampaignData } = useCampaignState();
    const [instances, setInstances] = useState<Omit<EvolutionInstance, 'status' | 'qrCode'>[]>([]);
    const [loadingInstances, setLoadingInstances] = useState(true);
    const [isHydrated, setIsHydrated] = useState(false);

    useEffect(() => {
        // Zustand's persist middleware rehydrates asynchronously.
        // We use this effect to know when the state is ready to be used.
        setIsHydrated(true);
    }, []);

    useEffect(() => {
        if (user?.activeWorkspaceId) {
            getEvolutionApiInstances(user.activeWorkspaceId)
                .then(setInstances)
                .finally(() => setLoadingInstances(false));
        }
    }, [user?.activeWorkspaceId]);

    const handleNext = () => {
        router.push('/campaigns/new/audience');
    };

    if (!isHydrated) {
        return (
             <MainLayout>
                <div className="flex flex-col flex-1 h-full bg-muted/40">
                    <header className="p-4 sm:p-6 border-b flex-shrink-0 bg-background">
                        <Skeleton className="h-8 w-48" />
                        <Skeleton className="h-4 w-72 mt-2" />
                    </header>
                    <div className="flex-1 p-4 sm:p-6 flex flex-col items-center">
                        <Skeleton className="h-64 w-full max-w-4xl" />
                    </div>
                </div>
            </MainLayout>
        )
    }

    return (
        <MainLayout>
            <div className="flex flex-col flex-1 h-full bg-muted/40">
                <header className="p-4 sm:p-6 border-b flex-shrink-0 bg-background">
                    <h1 className="text-2xl font-bold">Nova Campanha</h1>
                    <p className="text-muted-foreground">Siga os passos para criar e enviar sua campanha.</p>
                </header>
                <div className="flex-1 p-4 sm:p-6 flex flex-col items-center">
                    <div className="w-full max-w-4xl space-y-6">
                        <CampaignSteps currentStep="message" />
                        <Card>
                            <CardHeader>
                                <CardTitle>Passo 1: Defina a Mensagem</CardTitle>
                                <CardDescription>
                                    Escreva a mensagem que será enviada e selecione a instância do WhatsApp que fará o envio.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                <div className="space-y-2">
                                    <Label htmlFor="message">Mensagem da Campanha</Label>
                                    <Textarea
                                        id="message"
                                        value={campaignData.message}
                                        onChange={(e) => setCampaignData({ ...campaignData, message: e.target.value })}
                                        rows={6}
                                        placeholder="Digite sua mensagem aqui... Use {{nome}} para personalizar com o nome do contato."
                                    />
                                    <p className="text-xs text-muted-foreground">A variável `{{nome}}` será substituída pelo nome do contato, se disponível.</p>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="instance">Instância de Envio</Label>
                                    {loadingInstances ? (
                                        <div className="flex items-center gap-2 text-muted-foreground">
                                            <Loader2 className="h-4 w-4 animate-spin" /> Carregando instâncias...
                                        </div>
                                    ) : (
                                        <Select
                                            value={campaignData.instanceName}
                                            onValueChange={(value) => setCampaignData({ ...campaignData, instanceName: value })}
                                        >
                                            <SelectTrigger id="instance">
                                                <SelectValue placeholder="Selecione a instância do WhatsApp" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {instances.map(inst => <SelectItem key={inst.id} value={inst.name}>{inst.name}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                        <div className="flex justify-between">
                            <Button variant="outline" onClick={clearCampaignData}>Cancelar</Button>
                            <Button onClick={handleNext} disabled={!campaignData.message || !campaignData.instanceName}>
                                Próximo Passo <ArrowRight className="ml-2 h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </MainLayout>
    );
}
