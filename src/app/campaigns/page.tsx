
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { MainLayout } from '@/components/layout/main-layout';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Loader2, PlusCircle, Send, FileText, Users, MessageSquare, CheckCircle, AlertTriangle, XCircle, Clock, Search } from 'lucide-react';
import { getCampaigns, createCampaign } from '@/actions/campaigns';
import { getContacts } from '@/actions/crm';
import { getEvolutionApiInstances } from '@/actions/evolution-api';
import type { Campaign, Contact, EvolutionInstance } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';

const statusConfig = {
    draft: { label: 'Rascunho', icon: <FileText className="h-4 w-4" />, color: 'bg-gray-400' },
    sending: { label: 'Enviando', icon: <Loader2 className="h-4 w-4 animate-spin" />, color: 'bg-blue-500' },
    completed: { label: 'Concluída', icon: <CheckCircle className="h-4 w-4" />, color: 'bg-green-500' },
    paused: { label: 'Pausada', icon: <Clock className="h-4 w-4" />, color: 'bg-yellow-500' },
    failed: { label: 'Falhou', icon: <XCircle className="h-4 w-4" />, color: 'bg-red-500' },
};


function CreateCampaignDialog() {
  const user = useAuth();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);

  // Step 1 state
  const [message, setMessage] = useState('');
  const [instanceName, setInstanceName] = useState('');
  const [instances, setInstances] = useState<Omit<EvolutionInstance, 'status' | 'qrCode'>[]>([]);

  // Step 2 state
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (isOpen && user?.activeWorkspaceId) {
      getEvolutionApiInstances(user.activeWorkspaceId).then(setInstances);
      getContacts(user.activeWorkspaceId).then(res => setContacts(res.contacts || []));
    }
  }, [isOpen, user?.activeWorkspaceId]);

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const allIds = new Set(filteredContacts.map(c => c.id));
      setSelectedContactIds(allIds);
    } else {
      setSelectedContactIds(new Set());
    }
  };

  const handleSelectContact = (contactId: string, checked: boolean) => {
    setSelectedContactIds(prev => {
      const newSet = new Set(prev);
      if (checked) {
        newSet.add(contactId);
      } else {
        newSet.delete(contactId);
      }
      return newSet;
    });
  };
  
  const handleCreateCampaign = async () => {
    if (!user?.activeWorkspaceId) return;
    setIsLoading(true);
    const result = await createCampaign(user.activeWorkspaceId, instanceName, message, Array.from(selectedContactIds));

    if (result.error) {
        toast({ title: 'Erro ao criar campanha', description: result.error, variant: 'destructive' });
    } else {
        toast({ title: 'Campanha criada e em andamento!', description: 'O envio foi iniciado em segundo plano.' });
        setIsOpen(false);
        // Reset state
        setStep(1);
        setMessage('');
        setInstanceName('');
        setSelectedContactIds(new Set());
    }
    setIsLoading(false);
  }

  const filteredContacts = contacts.filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button>
          <PlusCircle className="mr-2 h-4 w-4" /> Criar Campanha
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nova Campanha de Mensagens em Massa</DialogTitle>
          <DialogDescription>
            Envie uma mensagem para múltiplos contatos do seu CRM. Passo {step} de 2.
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
            <div className="py-4 space-y-4">
                <div className="space-y-2">
                    <Label htmlFor="message">Mensagem</Label>
                    <Textarea id="message" value={message} onChange={e => setMessage(e.target.value)} rows={5} placeholder="Digite sua mensagem aqui... Use {{nome}} para personalizar com o nome do contato."/>
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="instance">Instância de Envio</Label>
                    <Select value={instanceName} onValueChange={setInstanceName}>
                        <SelectTrigger id="instance">
                            <SelectValue placeholder="Selecione a instância do WhatsApp" />
                        </SelectTrigger>
                        <SelectContent>
                           {instances.map(inst => <SelectItem key={inst.id} value={inst.name}>{inst.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
            </div>
        )}
        
        {step === 2 && (
             <div className="py-4 space-y-4">
                <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Buscar contato..." className="pl-8" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                </div>
                <div className="flex items-center space-x-2 p-2 border-b">
                    <Checkbox
                        id="select-all"
                        checked={selectedContactIds.size === filteredContacts.length && filteredContacts.length > 0}
                        onCheckedChange={handleSelectAll}
                    />
                    <Label htmlFor="select-all" className="font-medium">Selecionar todos</Label>
                </div>
                <ScrollArea className="h-64">
                    <div className="space-y-1 p-1">
                        {filteredContacts.map(contact => (
                            <div key={contact.id} className="flex items-center space-x-3 p-2 rounded-md hover:bg-accent">
                                <Checkbox
                                    id={`contact-${contact.id}`}
                                    checked={selectedContactIds.has(contact.id)}
                                    onCheckedChange={(checked) => handleSelectContact(contact.id, !!checked)}
                                />
                                <Label htmlFor={`contact-${contact.id}`} className="flex items-center gap-2 font-normal cursor-pointer">
                                    <span className="font-medium">{contact.name}</span>
                                    <span className="text-muted-foreground">{contact.phone_number_jid}</span>
                                </Label>
                            </div>
                        ))}
                    </div>
                </ScrollArea>
                 <p className="text-sm text-muted-foreground">{selectedContactIds.size} contato(s) selecionado(s).</p>
             </div>
        )}


        <DialogFooter>
            {step === 1 ? (
                <>
                  <Button variant="outline" onClick={() => setIsOpen(false)}>Cancelar</Button>
                  <Button onClick={() => setStep(2)} disabled={!message || !instanceName}>Avançar</Button>
                </>
            ) : (
                 <>
                  <Button variant="outline" onClick={() => setStep(1)}>Voltar</Button>
                  <Button onClick={handleCreateCampaign} disabled={selectedContactIds.size === 0 || isLoading}>
                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Enviar Campanha
                  </Button>
                </>
            )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
          <CreateCampaignDialog />
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
