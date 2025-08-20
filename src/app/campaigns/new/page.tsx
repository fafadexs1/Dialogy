'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Papa from 'papaparse';
import { MainLayout } from '@/components/layout/main-layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/use-auth';
import { ArrowLeft, Download, FileUp, Loader2, Search, Users, X, Send } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getContacts } from '@/actions/crm';
import { getEvolutionApiInstances } from '@/actions/evolution-api';
import type { Contact, EvolutionInstance } from '@/lib/types';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { createCampaign } from '@/actions/campaigns';

interface CampaignContact extends Pick<Contact, 'id' | 'name' | 'phone_number_jid'> {}

export default function NewCampaignPage() {
  const user = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  // State for all steps
  const [message, setMessage] = useState('');
  const [instanceName, setInstanceName] = useState('');
  const [instances, setInstances] = useState<Omit<EvolutionInstance, 'status' | 'qrCode'>[]>([]);
  const [loadingInstances, setLoadingInstances] = useState(true);

  // CRM Contacts
  const [crmContacts, setCrmContacts] = useState<Contact[]>([]);
  const [loadingCrm, setLoadingCrm] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCrmContactIds, setSelectedCrmContactIds] = useState<Set<string>>(new Set());

  // CSV Contacts
  const [csvContacts, setCsvContacts] = useState<CampaignContact[]>([]);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  
  // Submission state
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Load instances
  useEffect(() => {
    async function load() {
      if (!user?.activeWorkspaceId) return;
      setLoadingInstances(true);
      const list = await getEvolutionApiInstances(user.activeWorkspaceId);
      setInstances(list);
      setLoadingInstances(false);
    }
    load();
  }, [user?.activeWorkspaceId]);
  
  // Load CRM contacts
  useEffect(() => {
    async function load() {
      if (!user?.activeWorkspaceId) return;
      setLoadingCrm(true);
      const res = await getContacts(user.activeWorkspaceId);
      setCrmContacts(res.contacts || []);
      setLoadingCrm(false);
    }
    load();
  }, [user?.activeWorkspaceId]);
  
  const filteredCrmContacts = useMemo(
    () => crmContacts.filter((c) => c.name.toLowerCase().includes(searchTerm.toLowerCase())),
    [crmContacts, searchTerm]
  );
  
  const handleSelectAllCrm = (checked: boolean | 'indeterminate') => {
    setSelectedCrmContactIds(new Set(checked ? filteredCrmContacts.map((c) => c.id) : []));
  };

  const handleSelectCrmContact = (contactId: string, checked: boolean) => {
    setSelectedCrmContactIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(contactId);
      else next.delete(contactId);
      return next;
    });
  };
  
  const isAllSelected = useMemo(() => {
    if (filteredCrmContacts.length === 0) return false;
    return selectedCrmContactIds.size === filteredCrmContacts.length;
  }, [selectedCrmContactIds, filteredCrmContacts]);
  
  const isSomeSelected = useMemo(() => selectedCrmContactIds.size > 0 && !isAllSelected, [selectedCrmContactIds, isAllSelected]);
  
  const downloadCsvTemplate = () => {
    const csvContent = 'phone_number_jid,name\n5511999998888@s.whatsapp.net,João da Silva\n5521988887777@s.whatsapp.net,Maria Oliveira';
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'modelo_campanha_dialogy.csv';
    link.click();
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setCsvFileName(file.name);
    setCsvError(null);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.errors.length) {
          setCsvError(`Erro no arquivo CSV: ${results.errors[0].message}`);
          return;
        }
        if (!results.meta.fields?.includes('phone_number_jid') || !results.meta.fields?.includes('name')) {
          setCsvError("Arquivo CSV inválido. As colunas 'phone_number_jid' e 'name' são obrigatórias.");
          return;
        }
        const parsedContacts: CampaignContact[] = (results.data as any[]).map((row: any, index) => ({
          id: `csv-${index}`,
          name: row.name || 'Contato',
          phone_number_jid: row.phone_number_jid,
        }));
        setCsvContacts(parsedContacts);
      },
    });
  };

  const totalSelected = selectedCrmContactIds.size + csvContacts.length;
  
  const handleSendCampaign = async () => {
    if (!user?.activeWorkspaceId || !instanceName || !message || totalSelected === 0) {
        toast({ title: 'Dados Incompletos', description: 'Preencha a mensagem, selecione uma instância e pelo menos um contato.', variant: 'destructive'});
        return;
    };
    setIsSubmitting(true);
    
    const crmSelection: CampaignContact[] = crmContacts
      .filter((c) => selectedCrmContactIds.has(c.id))
      .map((c) => ({ id: `crm-${c.id}`, name: c.name, phone_number_jid: c.phone_number_jid }));

    const finalContacts = [...crmSelection, ...csvContacts];
    
    const result = await createCampaign(user.activeWorkspaceId, instanceName, message, finalContacts);
    
    if (result.error) {
        toast({ title: 'Erro ao criar campanha', description: result.error, variant: 'destructive' });
        setIsSubmitting(false);
    } else {
        toast({ title: 'Campanha criada e em andamento!', description: 'O envio foi iniciado em segundo plano. Você será redirecionado.' });
        router.push('/campaigns');
    }
  }


  return (
    <MainLayout>
      <div className="flex flex-col flex-1 h-full bg-muted/40">
        <header className="p-4 sm:p-6 border-b flex-shrink-0 bg-background">
          <h1 className="text-2xl font-bold">Nova Campanha</h1>
          <p className="text-muted-foreground">Defina a mensagem e o público em um único lugar.</p>
        </header>

        <div className="flex-1 p-4 sm:p-6 overflow-y-auto">
          <div className="max-w-4xl mx-auto space-y-6">

            <Card>
              <CardHeader>
                <CardTitle>1. Mensagem e Instância</CardTitle>
                <CardDescription>
                  Escreva a mensagem que será enviada e selecione a instância do WhatsApp.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="message">Mensagem da Campanha</Label>
                  <Textarea
                    id="message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={6}
                    placeholder="Digite sua mensagem aqui... Use {{nome}} para personalizar com o nome do contato."
                  />
                  <p className="text-xs text-muted-foreground">
                    A variável <code>{'{{nome}}'}</code> será substituída pelo nome do contato, se disponível.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="instance">Instância de Envio</Label>
                  {loadingInstances ? (
                    <Skeleton className="h-10 w-full" />
                  ) : (
                    <Select value={instanceName} onValueChange={setInstanceName}>
                      <SelectTrigger id="instance"><SelectValue placeholder="Selecione a instância do WhatsApp" /></SelectTrigger>
                      <SelectContent>
                        {instances.map((inst) => (
                          <SelectItem key={inst.id} value={inst.name}>{inst.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>2. Público</CardTitle>
                <CardDescription>
                  Selecione os contatos que receberão esta campanha.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="crm" className="w-full">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="crm"><Users className="mr-2 h-4 w-4" /> Selecionar do CRM ({selectedCrmContactIds.size})</TabsTrigger>
                    <TabsTrigger value="csv"><FileUp className="mr-2 h-4 w-4" /> Importar Arquivo ({csvContacts.length})</TabsTrigger>
                  </TabsList>
                  <TabsContent value="crm" className="mt-4">
                     <div className="relative mb-4">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input placeholder="Buscar contato..." className="pl-8" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                      </div>
                      <div className="flex items-center space-x-2 p-2 border-b">
                        <Checkbox id="select-all" checked={isAllSelected ? true : isSomeSelected ? 'indeterminate' : false} onCheckedChange={handleSelectAllCrm} />
                        <Label htmlFor="select-all" className="font-medium">Selecionar todos</Label>
                      </div>
                      <ScrollArea className="h-64">
                        {loadingCrm ? <Loader2 className="mx-auto my-10 h-6 w-6 animate-spin" /> : (
                            filteredCrmContacts.map((contact) => (
                              <div key={contact.id} className="flex items-center space-x-3 p-2 rounded-md hover:bg-accent">
                                <Checkbox id={`contact-${contact.id}`} checked={selectedCrmContactIds.has(contact.id)} onCheckedChange={(checked) => handleSelectCrmContact(contact.id, !!checked)} />
                                <Label htmlFor={`contact-${contact.id}`} className="flex items-center gap-2 font-normal cursor-pointer w-full">
                                  <span className="font-medium">{contact.name}</span>
                                  <span className="text-muted-foreground">{contact.phone_number_jid}</span>
                                </Label>
                              </div>
                            ))
                        )}
                      </ScrollArea>
                  </TabsContent>
                  <TabsContent value="csv" className="mt-4">
                     <div className="p-6 border-2 border-dashed rounded-lg text-center space-y-4">
                      <Button type="button" variant="outline" onClick={downloadCsvTemplate}><Download className="mr-2 h-4 w-4" /> Baixar Modelo</Button>
                      <Label htmlFor="csv-upload" className="block text-sm text-muted-foreground">Ou arraste e solte o arquivo aqui</Label>
                      <Input id="csv-upload" type="file" className="block w-full max-w-sm mx-auto" accept=".csv" onChange={handleFileUpload} />
                      {csvFileName && (
                        <div className="text-sm font-medium p-2 bg-secondary rounded-md inline-flex items-center gap-2">
                          {csvFileName}
                          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => { setCsvContacts([]); setCsvFileName(null); }}><X /></Button>
                        </div>
                      )}
                      {csvError && <Alert variant="destructive"><AlertTitle>Erro na Importação</AlertTitle><AlertDescription>{csvError}</AlertDescription></Alert>}
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            <div className="flex justify-between items-center sticky bottom-0 bg-background/80 backdrop-blur-sm p-4 rounded-lg border shadow-lg">
              <Button variant="outline" onClick={() => router.push('/campaigns')}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Cancelar
              </Button>
              <div className="text-center font-semibold text-primary">{totalSelected} destinatário(s)</div>
              <Button onClick={handleSendCampaign} disabled={isSubmitting || totalSelected === 0 || !message || !instanceName}>
                {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Send className="mr-2 h-4 w-4" />}
                {isSubmitting ? 'Enviando...' : 'Revisar e Enviar Campanha'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
