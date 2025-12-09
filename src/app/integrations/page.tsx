
'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import type { Integration } from '@/lib/types';
import { IntegrationCard } from '@/components/integrations/integration-card';
import { Loader2, Search, SlidersHorizontal } from 'lucide-react';
import { getIntegrations } from '@/actions/integrations';
import { toast } from '@/hooks/use-toast';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useCurrentUser } from '@/hooks/use-online-status';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

const CATEGORIES = [
    { id: 'all', label: 'Todos' },
    { id: 'messaging', label: 'Mensageria' },
    { id: 'crm', label: 'CRM' },
    { id: 'utilities', label: 'Utilitários' },
];

export default function IntegrationsPage() {
    const user = useCurrentUser();
    const [integrations, setIntegrations] = useState<Integration[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('all');

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const integrationsRes = await getIntegrations();
            if (integrationsRes.integrations) {
                // Mock categories for now as they might not be in the DB yet
                const enriched = integrationsRes.integrations.map(i => ({
                    ...i,
                    category: i.name.toLowerCase().includes('messenger') || i.name.toLowerCase().includes('instagram') || i.name.toLowerCase().includes('whatsapp') ? 'messaging' :
                        i.name.toLowerCase().includes('crm') ? 'crm' : 'utilities'
                }));
                setIntegrations(enriched);
            } else {
                toast({ title: 'Erro de Rede', description: 'Não foi possível carregar as configurações.', variant: 'destructive' });
            }
        } catch (error: any) {
            toast({ title: 'Erro de Rede', description: 'Não foi possível se conectar ao servidor.', variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const filteredIntegrations = useMemo(() => {
        return integrations.filter(integration => {
            const matchesSearch = integration.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                integration.description.toLowerCase().includes(searchQuery.toLowerCase());
            const matchesCategory = selectedCategory === 'all' || (integration as any).category === selectedCategory;
            return matchesSearch && matchesCategory;
        });
    }, [integrations, searchQuery, selectedCategory]);

    if (loading || !user) {
        return (
            <div className="flex items-center justify-center h-full bg-muted/40">
                <div className="flex flex-col items-center gap-2">
                    <Loader2 className="h-10 w-10 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground animate-pulse">Carregando ecossistema...</p>
                </div>
            </div>
        )
    }

    return (
        <div className="flex flex-col flex-1 h-full bg-muted/10">
            <header className="px-8 py-8 border-b bg-background/80 backdrop-blur-sm sticky top-0 z-10">
                <div className="max-w-7xl mx-auto space-y-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">Extensões & Integrações</h1>
                            <p className="text-muted-foreground mt-1 text-lg">
                                Conecte o Dialogy às suas ferramentas favoritas e potencialize seu atendimento.
                            </p>
                        </div>
                        <div className="hidden md:flex items-center gap-2">
                            <Badge variant="outline" className="px-3 py-1 h-7">
                                {integrations.length} Disponíveis
                            </Badge>
                        </div>
                    </div>

                    <div className="flex flex-col md:flex-row items-center gap-4">
                        <div className="relative flex-1 w-full">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Buscar integração (ex: Instagram, Messenger)..."
                                className="pl-9 h-10 bg-background/50 border-muted-foreground/20 focus-visible:ring-primary/20"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                        <Tabs value={selectedCategory} onValueChange={setSelectedCategory} className="w-full md:w-auto">
                            <TabsList className="grid grid-cols-4 w-full md:w-auto h-10 bg-muted/50 p-1">
                                {CATEGORIES.map(cat => (
                                    <TabsTrigger key={cat.id} value={cat.id} className="text-xs px-4 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                                        {cat.label}
                                    </TabsTrigger>
                                ))}
                            </TabsList>
                        </Tabs>
                    </div>
                </div>
            </header>

            <main className="flex-1 overflow-y-auto p-4 sm:p-8">
                <div className="max-w-7xl mx-auto">
                    {filteredIntegrations.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 text-center animate-in fade-in zoom-in-95 duration-500">
                            <div className="h-16 w-16 bg-muted rounded-full flex items-center justify-center mb-4">
                                <Search className="h-8 w-8 text-muted-foreground" />
                            </div>
                            <h3 className="text-xl font-semibold">Nenhuma integração encontrada</h3>
                            <p className="text-muted-foreground mt-2 max-w-sm">
                                Não encontramos resultados para sua busca ou filtro. Tente buscar por outros termos.
                            </p>
                            <Button variant="outline" className="mt-6" onClick={() => { setSearchQuery(''); setSelectedCategory('all'); }}>
                                Limpar Filtros
                            </Button>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 pb-20">
                            {filteredIntegrations.map((integration, idx) => (
                                <div key={integration.id} className="animate-in fade-in slide-in-from-bottom-4 duration-500" style={{ animationDelay: `${idx * 50}ms` }}>
                                    <IntegrationCard
                                        integration={integration}
                                        isSuperAdmin={user.is_superadmin}
                                        onEditSuccess={fetchData}
                                    />
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
