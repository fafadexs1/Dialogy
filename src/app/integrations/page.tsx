
'use client';

import React, { useEffect, useState } from 'react';
import type { User, Integration } from '@/lib/types';
import { IntegrationCard } from '@/components/integrations/integration-card';
import { Loader2 } from 'lucide-react';
import { getIntegrations } from '@/actions/plans';
import { toast } from '@/hooks/use-toast';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function IntegrationsPage() {
    const [integrations, setIntegrations] = useState<Integration[]>([]);
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchUserAndIntegrations = async () => {
            setLoading(true);
            try {
                const userRes = await fetch('/api/user');
                if (userRes.ok) {
                    setUser(await userRes.json());
                }
                const integrationsRes = await getIntegrations();
                if (integrationsRes.error) {
                    toast({ title: 'Erro ao carregar integrações', description: integrationsRes.error, variant: 'destructive'});
                } else {
                    setIntegrations(integrationsRes.integrations || []);
                }
            } catch (error: any) {
                 toast({ title: 'Erro de Rede', description: 'Não foi possível se conectar ao servidor.', variant: 'destructive'});
            } finally {
                setLoading(false);
            }
        };
        fetchUserAndIntegrations();
    }, []);

    if (loading || !user) {
         return (
              <div className="flex items-center justify-center h-full">
                  <Loader2 className="h-8 w-8 animate-spin text-primary"/>
              </div>
        )
    }

    return (
        <div className="flex flex-col flex-1 h-full">
            <header className="p-4 sm:p-6 border-b flex-shrink-0 bg-background">
                <h1 className="text-2xl font-bold">Extensões</h1>
                <p className="text-muted-foreground">Conecte o Dialogy a outras ferramentas para automatizar e aprimorar seus fluxos de trabalho.</p>
            </header>
            <main className="flex-1 overflow-y-auto bg-muted/40 p-4 sm:p-6">
                {integrations.length === 0 && !loading ? (
                    <Card>
                        <CardHeader>
                            <CardTitle>Nenhuma Integração Encontrada</CardTitle>
                            <CardDescription>
                                O administrador ainda não configurou nenhuma integração.
                            </CardDescription>
                        </CardHeader>
                    </Card>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                        {integrations.map(integration => <IntegrationCard key={integration.id} integration={integration} />)}
                    </div>
                )}
            </main>
        </div>
    );
}
