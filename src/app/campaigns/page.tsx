'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { MainLayout } from '@/components/layout/main-layout';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Loader2, Plus, CheckCircle, Circle, Edit, Trash2 } from 'lucide-react';
import { getCampaigns } from '@/actions/campaigns';
import type { Campaign } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { format, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import Link from 'next/link';
import { FaWhatsapp } from 'react-icons/fa6';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MoreHorizontal } from 'lucide-react';


const statusConfig: { [key in Campaign['status']]: { label: string; icon: React.ReactNode; className: string } } = {
    draft: { label: 'Rascunho', icon: <Circle className="h-2 w-2 text-gray-500 fill-current" />, className: 'text-gray-500' },
    sending: { label: 'Enviando', icon: <Loader2 className="h-3 w-3 animate-spin text-blue-500" />, className: 'text-blue-500' },
    completed: { label: 'Envio concluído', icon: <CheckCircle className="h-3 w-3 text-green-500" />, className: 'text-green-500' },
    paused: { label: 'Pausada', icon: <Circle className="h-2 w-2 text-yellow-500 fill-current" />, className: 'text-yellow-500' },
    failed: { label: 'Falhou', icon: <Circle className="h-2 w-2 text-red-500 fill-current" />, className: 'text-red-500' },
};

function CampaignActions() {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-8 w-8 p-0">
                    <span className="sr-only">Abrir menu</span>
                    <MoreHorizontal className="h-4 w-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuItem disabled>
                    <Edit className="mr-2 h-4 w-4" />
                    Editar
                </DropdownMenuItem>
                <DropdownMenuItem className="text-destructive" disabled>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Excluir
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

export default function CampaignsPage() {
  const user = useAuth();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchCampaigns = useCallback(async () => {
    if (!user?.activeWorkspaceId) return;
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
    }, 5000); 

    return () => clearInterval(interval);
  }, [fetchCampaigns]);


  if (!user) {
    return <MainLayout><div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin text-primary"/></div></MainLayout>;
  }

  return (
    <MainLayout>
      <div className="flex flex-col flex-1 h-full bg-background">
        <div className="flex flex-1 min-h-0">
            {/* Sidebar de Campanhas */}
            <aside className="w-64 flex-shrink-0 border-r bg-[#2c3e50] text-white">
                <div className="p-4">
                    <h2 className="text-xs uppercase font-bold tracking-wider text-gray-400">Campanhas por Canal</h2>
                </div>
                <nav className="p-2">
                    <ul>
                        <li>
                            <Link href="/campaigns" className="block p-2 rounded-md bg-blue-500/30 text-white font-semibold">
                                Campanhas
                            </Link>
                        </li>
                         <li>
                            <Link href="#" className="block p-2 rounded-md hover:bg-white/10 text-gray-300">
                                WhatsApp
                            </Link>
                        </li>
                        <li>
                            <Link href="#" className="block p-2 rounded-md hover:bg-white/10 text-gray-300">
                                WhatsApp Paralelo
                            </Link>
                        </li>
                        <li>
                            <Link href="#" className="block p-2 rounded-md hover:bg-white/10 text-gray-300">
                                WhatsApp API Oficial
                            </Link>
                        </li>
                    </ul>
                </nav>
            </aside>
            
            {/* Conteúdo Principal */}
            <main className="flex-1 flex flex-col">
                 <header className="p-4 border-b flex-shrink-0 flex justify-between items-center">
                    <h1 className="text-xl font-bold">Campanhas</h1>
                    <Button asChild>
                        <Link href="/campaigns/new">
                            <Plus className="mr-2 h-4 w-4" /> Nova campanha
                        </Link>
                    </Button>
                </header>
                
                <div className="flex-1 overflow-y-auto">
                    {/* Header da Tabela */}
                    <div className="grid grid-cols-[auto,1fr,auto,auto,auto,auto,auto] gap-4 px-6 py-3 border-b bg-muted/50 text-xs font-semibold text-muted-foreground uppercase sticky top-0">
                        <Checkbox disabled/>
                        <div>Nome da Campanha</div>
                        <div className="text-left">Estado</div>
                        <div className="text-left">Destinatários</div>
                        <div className="text-left">Entrega</div>
                        <div className="text-left">Última Atualização</div>
                        <div className="text-center">Ações</div>
                    </div>

                    {/* Corpo da Tabela */}
                     <div className="divide-y">
                         <div className="px-6 py-2 text-sm font-medium text-gray-600 flex items-center gap-2">
                            <FaWhatsapp className="text-green-500"/>
                            WhatsApp Paralelo
                         </div>
                        {loading ? (
                            <div className="flex items-center justify-center p-10"><Loader2 className="h-8 w-8 animate-spin text-primary"/></div>
                        ) : campaigns.length === 0 ? (
                            <div className="text-center p-10">
                                <h3 className="text-lg font-medium">Nenhuma campanha criada ainda</h3>
                                <p className="mt-2 text-sm text-muted-foreground">
                                    Clique em "Nova Campanha" para iniciar seu primeiro envio em massa.
                                </p>
                            </div>
                        ) : (
                            campaigns.map(campaign => {
                                const config = statusConfig[campaign.status];
                                return (
                                <div key={campaign.id} className="grid grid-cols-[auto,1fr,auto,auto,auto,auto,auto] items-center gap-4 px-6 py-3 hover:bg-accent transition-colors">
                                    <Checkbox />
                                    <div className="font-medium">{campaign.name}</div>
                                    <div className={`flex items-center gap-1.5 text-sm font-medium ${config.className}`}>
                                        {config.icon}
                                        {config.label}
                                    </div>
                                    <div className="text-center">
                                        <div className="px-3 py-1 bg-gray-200 text-gray-700 rounded-full text-xs font-semibold">
                                            {campaign.total_recipients || 0} contatos
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 w-32">
                                        <span className="text-sm font-semibold w-12 text-right">{campaign.progress?.toFixed(0) ?? 0}%</span>
                                        <Progress value={campaign.progress || 0} className="h-2"/>
                                    </div>
                                    <div className="text-sm">
                                        <p className="font-medium">{format(new Date(campaign.created_at), "MMM yyyy", { locale: ptBR })}</p>
                                        <p className="text-xs text-muted-foreground">
                                            Criado: {format(new Date(campaign.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                                        </p>
                                    </div>
                                    <div className="flex justify-center">
                                        {campaign.status === 'draft' ? (
                                            <Button variant="ghost" size="icon" className='text-green-500'><CheckCircle className="h-5 w-5"/></Button>
                                        ) : <CampaignActions />}
                                    </div>
                                </div>
                                )
                            })
                        )}
                     </div>
                </div>
            </main>
        </div>
      </div>
    </MainLayout>
  );
}
