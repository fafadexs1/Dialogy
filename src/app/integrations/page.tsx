

'use client';

import React from 'react';
import { MainLayout } from '@/components/layout/main-layout';
import type { User, Integration } from '@/lib/types';
import { integrations as mockIntegrations } from '@/lib/mock-data';
import { IntegrationCard } from '@/components/integrations/integration-card';
import { useAuth } from '@/hooks/use-auth';
import { Loader2 } from 'lucide-react';

export default function IntegrationsPage() {
    const user = useAuth();
    const [integrations] = React.useState<Integration[]>(mockIntegrations);

    if (!user) {
         return (
            <div className="flex items-center justify-center h-full">
                <Loader2 className="h-8 w-8 animate-spin text-primary"/>
            </div>
        )
    }

    return (
        <MainLayout user={user}>
            <div className="flex flex-col flex-1 h-full">
                <header className="p-4 sm:p-6 border-b flex-shrink-0 bg-background">
                    <h1 className="text-2xl font-bold">Extensões</h1>
                    <p className="text-muted-foreground">Conecte o Dialogy a outras ferramentas para automatizar e aprimorar seus fluxos de trabalho.</p>
                </header>
                <main className="flex-1 overflow-y-auto bg-muted/40 p-4 sm:p-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                       {integrations.map(integration => <IntegrationCard key={integration.id} integration={integration} />)}
                    </div>
                </main>
            </div>
        </MainLayout>
    );
}
