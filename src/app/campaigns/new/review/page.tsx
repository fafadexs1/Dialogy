
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useCampaignState } from '../use-campaign-state';
import { MainLayout } from '@/components/layout/main-layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/use-auth';
import { ArrowLeft, Send, MessageSquare, Users, Server, Loader2 } from 'lucide-react';
import { CampaignSteps } from '../campaign-steps';
import { createCampaign } from '@/actions/campaigns';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';

export default function CampaignReviewPage() {
    const user = useAuth();
    const router = useRouter();
    const { campaignData, clearCampaignData } = useCampaignState();
    const { toast } = useToast();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isHydrated, setIsHydrated] = useState(false);

    useEffect(() => {
        setIsHydrated(true);
    }, []);

    // Redirect if essential data is missing after hydration.
    // This now runs only once after isHydrated becomes true.
    useEffect(() => {
        if (isHydrated && (!campaignData?.message || !campaignData.instanceName || !campaignData.contacts || campaignData.contacts.length === 0)) {
            toast({
                title: "Dados incompletos",
                description: "Por favor, preencha os passos anteriores primeiro.",
                variant: "destructive"
            });
            router.replace('/campaigns/new/message');
        }
    }, [isHydrated, campaignData, router, toast]);

    const handleSendCampaign = async () => {
        if (!user?.activeWorkspaceId || !campaignData?.contacts || !campaignData?.instanceName || !campaignData?.message) return;
        setIsSubmitting(true);
        
        const contactsToSend = campaignData.contacts.map(c => ({
            id: c.id, 
            name: c.name,
            phone_number_jid: c.phone_number_jid
        }));
        
        const result = await createCampaign(user.activeWorkspaceId, campaignData.instanceName, campaignData.message, contactsToSend);
        
        if (result.error) {
            toast({ title: 'Erro ao criar campanha', description: result.error, variant: 'destructive' });
            setIsSubmitting(false);
        } else {
            toast({ title: 'Campanha criada e em andamento!', description: 'O envio foi iniciado em segundo plano. Você será redirecionado.' });
            clearCampaignData();
            router.push('/campaigns');
        }
    }

    if (!isHydrated || !campaignData) {
        return (
             <MainLayout>
                <div className="flex flex-col flex-1 h-full bg-muted/40">
                    <header className="p-4 sm:p-6 border-b flex-shrink-0 bg-background">
                         <Skeleton className="h-8 w-48" />
                         <Skeleton className="h-4 w-72 mt-2" />
                    </header>
                    <div className="flex-1 p-4 sm:p-6 flex flex-col items-center">
                        <div className="w-full max-w-4xl space-y-6">
                            <CampaignSteps currentStep="review" />
                            <Skeleton className="h-96 w-full" />
                        </div>
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
                        <CampaignSteps currentStep="review" />
                        <Card>
                            <CardHeader>
                                <CardTitle>Passo 3: Revisão Final</CardTitle>
                                <CardDescription>
                                    Confira os detalhes da sua campanha antes de iniciar o envio.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                <div className="p-4 border rounded-lg space-y-4">
                                    <h3 className="font-semibold flex items-center gap-2"><MessageSquare className="h-5 w-5 text-primary"/> Mensagem</h3>
                                    <div className="p-3 bg-secondary/50 rounded-md text-sm text-muted-foreground whitespace-pre-wrap">
                                        {campaignData?.message}
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                     <div className="p-4 border rounded-lg space-y-2">
                                        <h3 className="font-semibold flex items-center gap-2"><Users className="h-5 w-5 text-primary"/> Destinatários</h3>
                                        <p className="text-3xl font-bold">{campaignData?.contacts?.length || 0}</p>
                                        <p className="text-sm text-muted-foreground">contatos selecionados</p>
                                    </div>
                                    <div className="p-4 border rounded-lg space-y-2">
                                        <h3 className="font-semibold flex items-center gap-2"><Server className="h-5 w-5 text-primary"/> Instância de Envio</h3>
                                        <p className="text-3xl font-bold">{campaignData?.instanceName}</p>
                                        <p className="text-sm text-muted-foreground">será usada para os envios</p>
                                    </div>
                                </div>
                                 <Alert>
                                    <AlertTitle>Atenção</AlertTitle>
                                    <AlertDescription>
                                        Após o início, a campanha não poderá ser cancelada. O envio será feito em segundo plano.
                                    </AlertDescription>
                                </Alert>
                            </CardContent>
                        </Card>
                        <div className="flex justify-between">
                             <Button variant="outline" onClick={() => router.back()}>
                                <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
                            </Button>
                            <Button onClick={handleSendCampaign} disabled={isSubmitting}>
                                {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Send className="mr-2 h-4 w-4" />}
                                {isSubmitting ? 'Iniciando...' : 'Iniciar Campanha'}
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </MainLayout>
    );
}
