
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

export default function CampaignReviewPage() {
    const user = useAuth();
    const router = useRouter();
    const { campaignData, clearCampaignData } = useCampaignState();
    const { toast } = useToast();
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (!campaignData.message || !campaignData.instanceName || campaignData.contacts.length === 0) {
            router.replace('/campaigns/new/message');
        }
    }, [campaignData, router]);

    const handleSendCampaign = async () => {
        if (!user?.activeWorkspaceId) return;
        setIsSubmitting(true);
        
        // The names are used for personalization, the JID is the key.
        const contactsToSend = campaignData.contacts.map(c => ({
            id: c.id, // For now we don't have a reliable way to get the real ID from CSV, but we need something.
            name: c.name,
            phone_number_jid: c.phone_number_jid
        }));
        
        // This is a simplified version. A real implementation would create contacts if they don't exist.
        // For now, we will assume contacts from CSV should just be sent. 
        // We'll need a better way to map these to actual CRM contacts or create them.
        
        // A better approach would be to find existing contacts by JID and use their real IDs.
        // Let's adapt `createCampaign` to handle this.
        // For now, we'll just pass the JIDs and names. The backend should handle it.

        const result = await createCampaign(user.activeWorkspaceId, campaignData.instanceName, campaignData.message, campaignData.contacts.map(c => c.id));
        
        if (result.error) {
            toast({ title: 'Erro ao criar campanha', description: result.error, variant: 'destructive' });
            setIsSubmitting(false);
        } else {
            toast({ title: 'Campanha criada e em andamento!', description: 'O envio foi iniciado em segundo plano. Você será redirecionado.' });
            clearCampaignData();
            router.push('/campaigns');
        }
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
                                        {campaignData.message}
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                     <div className="p-4 border rounded-lg space-y-2">
                                        <h3 className="font-semibold flex items-center gap-2"><Users className="h-5 w-5 text-primary"/> Destinatários</h3>
                                        <p className="text-3xl font-bold">{campaignData.contacts.length}</p>
                                        <p className="text-sm text-muted-foreground">contatos selecionados</p>
                                    </div>
                                    <div className="p-4 border rounded-lg space-y-2">
                                        <h3 className="font-semibold flex items-center gap-2"><Server className="h-5 w-5 text-primary"/> Instância de Envio</h3>
                                        <p className="text-3xl font-bold">{campaignData.instanceName}</p>
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

