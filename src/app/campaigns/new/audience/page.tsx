
'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Papa from 'papaparse';
import { useCampaignState } from '../use-campaign-state';
import { MainLayout } from '@/components/layout/main-layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/use-auth';
import { ArrowLeft, ArrowRight, Download, FileUp, Loader2, Search, Users, X } from 'lucide-react';
import { CampaignSteps } from '../campaign-steps';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getContacts } from '@/actions/crm';
import type { Contact } from '@/lib/types';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';

interface CampaignContact extends Pick<Contact, 'id' | 'name' | 'phone_number_jid'> {}

export default function CampaignAudiencePage() {
  const user = useAuth();
  const router = useRouter();
  const { campaignData, setCampaignData } = useCampaignState();
  const { toast } = useToast();

  // CRM Contacts
  const [crmContacts, setCrmContacts] = useState<Contact[]>([]);
  const [loadingCrm, setLoadingCrm] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCrmContactIds, setSelectedCrmContactIds] = useState<Set<string>>(new Set());

  // CSV Contacts
  const [csvContacts, setCsvContacts] = useState<CampaignContact[]>([]);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);

  // Hydration state
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  // Sincroniza seleção vinda da store (somente depois de hidratar)
  useEffect(() => {
    if (!isHydrated) return;

    const contactsFromStore: CampaignContact[] = (campaignData?.contacts ?? []) as any;

    const crmIds = new Set(
      contactsFromStore
        .filter((c) => typeof c.id === 'string' && c.id.startsWith('crm-'))
        .map((c) => c.id.replace('crm-', ''))
    );

    const csvData = contactsFromStore.filter(
      (c) => typeof c.id === 'string' && c.id.startsWith('csv-')
    ) as CampaignContact[];

    setSelectedCrmContactIds(crmIds);
    setCsvContacts(csvData);
  }, [isHydrated, campaignData]);


  // Carregar contatos do CRM
  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        if (user?.activeWorkspaceId) {
          setLoadingCrm(true);
          const res = await getContacts(user.activeWorkspaceId);
          if (mounted) setCrmContacts(res.contacts || []);
        }
      } catch (e) {
        toast({
          variant: 'destructive',
          title: 'Erro ao carregar contatos do CRM',
          description: 'Tente novamente em alguns instantes.',
        });
      } finally {
        if (mounted) setLoadingCrm(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, [user?.activeWorkspaceId, toast]);

  const handleNext = () => {
    const crmSelection: CampaignContact[] = crmContacts
      .filter((c) => selectedCrmContactIds.has(c.id))
      .map((c) => ({ id: `crm-${c.id}`, name: c.name, phone_number_jid: c.phone_number_jid }));

    const finalContacts: CampaignContact[] = [...crmSelection, ...csvContacts];

    setCampaignData((prev) => ({ ...(prev ?? {}), contacts: finalContacts }));
    router.push('/campaigns/new/review');
  };

  const filteredCrmContacts = useMemo(
    () => crmContacts.filter((c) => c.name.toLowerCase().includes(searchTerm.toLowerCase())),
    [crmContacts, searchTerm]
  );

  const handleSelectAllCrm = (checked: boolean | 'indeterminate') => {
    const isChecked = checked === true;
    if (isChecked) {
      const allIds = new Set(filteredCrmContacts.map((c) => c.id));
      setSelectedCrmContactIds(allIds);
    } else {
      setSelectedCrmContactIds(new Set());
    }
  };

  const handleSelectCrmContact = (contactId: string, checked: boolean | 'indeterminate') => {
    const isChecked = checked === true;
    setSelectedCrmContactIds((prev) => {
      const newSet = new Set(prev);
      if (isChecked) newSet.add(contactId);
      else newSet.delete(contactId);
      return newSet;
    });
  };

  const downloadCsvTemplate = () => {
    const csvContent =
      'phone_number_jid,name\n5511999998888@s.whatsapp.net,João da Silva\n5521988887777@s.whatsapp.net,Maria Oliveira';
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', 'modelo_campanha_dialogy.csv');
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setCsvFileName(file.name);
    setCsvError(null);
    setCsvContacts([]);

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

  const isAllSelected = useMemo(() => {
    if (filteredCrmContacts.length === 0) return false;
    return selectedCrmContactIds.size === filteredCrmContacts.length;
  }, [selectedCrmContactIds.size, filteredCrmContacts.length]);

  const isSomeSelected = useMemo(() => {
    if (filteredCrmContacts.length === 0) return false;
    return selectedCrmContactIds.size > 0 && !isAllSelected;
  }, [selectedCrmContactIds.size, isAllSelected, filteredCrmContacts.length]);

  if (!isHydrated) {
    return (
      <MainLayout>
        <div className="flex flex-col flex-1 h-full bg-muted/40">
          <header className="p-4 sm:p-6 border-b flex-shrink-0 bg-background">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-72 mt-2" />
          </header>
          <div className="flex-1 p-4 sm:p-6 flex flex-col items-center">
            <Skeleton className="h-80 w-full max-w-4xl" />
          </div>
        </div>
      </MainLayout>
    );
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
            <CampaignSteps currentStep="audience" />

            <Card>
              <CardHeader>
                <CardTitle>Passo 2: Escolha o Público</CardTitle>
                <CardDescription>
                  Selecione os contatos que receberão esta campanha. Você pode selecionar do CRM ou importar um arquivo.
                </CardDescription>
              </CardHeader>

              <CardContent>
                <Tabs defaultValue="crm" className="w-full">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="crm">
                      <Users className="mr-2 h-4 w-4" /> Selecionar do CRM ({selectedCrmContactIds.size})
                    </TabsTrigger>
                    <TabsTrigger value="csv">
                      <FileUp className="mr-2 h-4 w-4" /> Importar Arquivo ({csvContacts.length})
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="crm" className="mt-4">
                    <div className="space-y-4">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Buscar contato..."
                          className="pl-8"
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                        />
                      </div>

                      <div className="flex items-center space-x-2 p-2 border-b">
                        <Checkbox
                          id="select-all"
                          checked={isAllSelected ? true : isSomeSelected ? 'indeterminate' : false}
                          onCheckedChange={handleSelectAllCrm}
                        />
                        <Label htmlFor="select-all" className="font-medium">
                          Selecionar todos
                        </Label>
                      </div>

                      <ScrollArea className="h-64">
                        <div className="space-y-1 p-1">
                          {loadingCrm ? (
                            <Loader2 className="mx-auto my-10 h-6 w-6 animate-spin" />
                          ) : (
                            filteredCrmContacts.map((contact) => (
                              <div
                                key={contact.id}
                                className="flex items-center space-x-3 p-2 rounded-md hover:bg-accent"
                              >
                                <Checkbox
                                  id={`contact-${contact.id}`}
                                  checked={selectedCrmContactIds.has(contact.id)}
                                  onCheckedChange={(checked) => handleSelectCrmContact(contact.id, checked)}
                                />
                                <Label
                                  htmlFor={`contact-${contact.id}`}
                                  className="flex items-center gap-2 font-normal cursor-pointer"
                                >
                                  <span className="font-medium">{contact.name}</span>
                                  <span className="text-muted-foreground">{contact.phone_number_jid}</span>
                                </Label>
                              </div>
                            ))
                          )}
                        </div>
                      </ScrollArea>
                    </div>
                  </TabsContent>

                  <TabsContent value="csv" className="mt-4">
                    <div className="p-6 border-2 border-dashed rounded-lg text-center space-y-4">
                      <Button type="button" variant="outline" onClick={downloadCsvTemplate}>
                        <Download className="mr-2 h-4 w-4" /> Baixar Modelo
                      </Button>

                      <Label htmlFor="csv-upload" className="block text-sm text-muted-foreground">
                        Ou arraste e solte o arquivo aqui
                      </Label>
                      <Input
                        id="csv-upload"
                        type="file"
                        className="block w-full max-w-sm mx-auto"
                        accept=".csv"
                        onChange={handleFileUpload}
                      />

                      {csvFileName && (
                        <div className="text-sm font-medium p-2 bg-secondary rounded-md inline-flex items-center gap-2">
                          {csvFileName}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5"
                            onClick={() => {
                              setCsvContacts([]);
                              setCsvFileName(null);
                            }}
                          >
                            <X />
                          </Button>
                        </div>
                      )}

                      {csvError && (
                        <Alert variant="destructive">
                          <AlertTitle>Erro na Importação</AlertTitle>
                          <AlertDescription>{csvError}</AlertDescription>
                        </Alert>
                      )}
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            <div className="flex justify-between items-center">
              <Button variant="outline" onClick={() => router.back()}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
              </Button>

              <div className="text-center font-semibold">{totalSelected} contato(s) selecionado(s)</div>

              <Button onClick={handleNext} disabled={totalSelected === 0}>
                Próximo Passo <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
