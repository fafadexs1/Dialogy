'use client';

import React from 'react';
import { MainLayout } from '@/components/layout/main-layout';
import type { User, Integration } from '@/lib/types';
import { agents, integrations as mockIntegrations } from '@/lib/mock-data';
import { createClient } from '@/lib/supabase/client';
import { redirect } from 'next/navigation';
import { IntegrationCard } from '@/components/integrations/integration-card';
import Link from 'next/link';


export default function IntegrationsPage() {
    const [user, setUser] = React.useState<User | null>(null);
    const [integrations] = React.useState<Integration[]>(mockIntegrations);
    const supabase = createClient();

    React.useEffect(() => {
        const fetchUser = async () => {
            const { data: { user: authUser } } = await supabase.auth.getUser();
            if (authUser) {
                 const appUser = agents.find(a => a.email === authUser.email) || {
                    ...agents[0],
                    name: authUser.user_metadata.full_name || authUser.email,
                    email: authUser.email,
                    id: authUser.id
                };
                setUser(appUser);
            } else {
                redirect('/login');
            }
        };
        fetchUser();
    }, [supabase.auth]);

    if (!user) {
        return null; // Or a loading spinner
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
