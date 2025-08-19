'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { MainLayout } from '@/components/layout/main-layout';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Loader2, PlusCircle, Send, FileText, CheckCircle, XCircle, Clock } from 'lucide-react';
import { getCampaigns } from '@/actions/campaigns';
import type { Campaign } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';

const statusConfig = {
    draft: { label: 'Rascunho', icon: <FileText className="h-4 w-4" />, color: 'bg-gray-400' },
    sending: { label: 'Enviando', icon: <Loader2 className="h-4 w-4 animate-spin" />, color: 'bg-blue-500' },
    completed: { label: 'Concluída', icon: <CheckCircle className="h-4 w-4" />, color: 'bg-green-500' },
    paused: { label: 'Pausada', icon: <Clock className="h-4 w-4" />, color: 'bg-yellow-500' },
    failed: { label: 'Falhou', icon: <XCircle className="h-4 w-4" />, color: 'bg-red-500' },
};


export default function CampaignsPage() {
  const user = useAuth();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchCampaigns = useCallback(async () => {
    if (!user?.activeWorkspaceId) return;
    // Do not set loading to true here to allow for background refresh
    const result = await getCampaigns(user.activeWorkspaceId);
    if (result.error) {
      toast({ title: "Erro ao buscar campanhas", description: result.error, variant: 'destructive' });
    } else {
      setCampaigns(result.campaigns || []);
    }
  }, [user?.activeWorkspaceId, toast]);

  useEffect(() => {
    if(user?.activeWorkspaceId) {
      setLoading(true);
      fetchCampaigns().finally(() => setLoading(false));
    }
  }, [user?.activeWorkspaceId, fetchCampaigns]);

  // Set up polling
  useEffect(() => {
    const interval = setInterval(() => {
      fetchCampaigns();
    }, 5000); // Poll every 5 seconds

    return () => clearInterval(interval);
  }, [fetchCampaigns]);


  if (!user) {
    return <MainLayout><div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin text-primary"/></div></MainLayout>;
  }

  return (
    <MainLayout>
      <div className="flex flex-col flex-1 h-full">
        <header className="p-4 sm:p-6 border-b flex-shrink-0 bg-background flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Send /> Campanhas</h1>
            <p className="text-muted-foreground">Envie mensagens em massa e acompanhe o progresso.</p>
          </div>
          <Button asChild>
            <Link href="/campaigns/new/message">
                <PlusCircle className="mr-2 h-4 w-4" /> Criar Campanha
            </Link>
          </Button>
        </header>
        <main className="flex-1 overflow-y-auto bg-muted/40 p-4 sm:p-6">
          {loading ? (
             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <Card><CardHeader><div className="h-6 bg-muted rounded w-3/4"></div></CardHeader><CardContent><div className="h-20 bg-muted rounded"></div></CardContent><CardFooter><div className="h-10 bg-muted rounded w-full"></div></CardFooter></Card>
                <Card><CardHeader><div className="h-6 bg-muted rounded w-3/4"></div></CardHeader><CardContent><div className="h-20 bg-muted rounded"></div></CardContent><CardFooter><div className="h-10 bg-muted rounded w-full"></div></CardFooter></Card>
             </div>
          ) : campaigns.length === 0 ? (
            <div className="text-center p-10 border-dashed border-2 rounded-lg mt-8">
                <Send className="mx-auto h-12 w-12 text-muted-foreground" />
                <h3 className="mt-4 text-lg font-medium">Nenhuma campanha criada ainda</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                    Clique em "Criar Campanha" para iniciar seu primeiro envio em massa.
                </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {campaigns.map(campaign => {
                const config = statusConfig[campaign.status];
                return (
                  <Card key={campaign.id} className="flex flex-col">
                    <CardHeader>
                      <CardTitle className="truncate">{campaign.name}</CardTitle>
                      <CardDescription>
                        Criada em {format(new Date(campaign.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="flex-grow space-y-4">
                      <div className="space-y-2">
                        <div className="flex justify-between items-center text-sm">
                          <Badge style={{ backgroundColor: config.color }} className="text-white font-semibold flex items-center gap-1.5">
                            {config.icon}
                            {config.label}
                          </Badge>
                          <span className="font-semibold">{campaign.sent_recipients || 0} / {campaign.total_recipients || 0}</span>
                        </div>
                        <Progress value={campaign.progress || 0} />
                      </div>
                      <div className="p-3 bg-secondary/50 rounded-md border text-sm text-muted-foreground h-20 overflow-hidden relative">
                         <p className='line-clamp-3'>{campaign.message}</p>
                         <div className="absolute bottom-0 left-0 w-full h-8 bg-gradient-to-t from-secondary/50 to-transparent"></div>
                      </div>
                    </CardContent>
                    <CardFooter>
                       <Button variant="outline" className="w-full" disabled>Ver Detalhes</Button>
                    </CardFooter>
                  </Card>
                )
              })}
            </div>
          )}
        </main>
      </div>
    </MainLayout>
  );
}
