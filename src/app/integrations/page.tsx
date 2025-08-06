
'use client';

import React, { useState } from 'react';
import { MainLayout } from '@/components/layout/main-layout';
import type { User, Integration } from '@/lib/types';
import { agents } from '@/lib/mock-data';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Bot, Link, User as UserIcon } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { createClient } from '@/lib/supabase/client';
import { redirect } from 'next/navigation';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const initialIntegrations: Integration[] = [
    {
        id: 'nexusflow-1',
        name: 'NexusFlow',
        description: 'Conecte o Dialogy ao seu sistema para automação de agentes via Webhooks.',
        icon: Bot,
        enabled: true,
        settings: {
            webhookUrl: '',
            agentName: 'Agente NexusFlow',
        }
    }
];

function IntegrationCard({ integration, onUpdate }: { integration: Integration, onUpdate: (id: string, settings: any) => void }) {
    const Icon = integration.icon;

    const handleSettingChange = (key: string, value: any) => {
        onUpdate(integration.id, { ...integration.settings, [key]: value });
    };

    const handleEnabledChange = (enabled: boolean) => {
        onUpdate(integration.id, { ...integration.settings, enabled });
    };
    
    return (
        <Card>
            <CardHeader>
                <div className="flex justify-between items-start">
                    <div className="flex items-center gap-4">
                        <Icon className="w-10 h-10 text-primary" />
                        <div>
                            <CardTitle>{integration.name}</CardTitle>
                            <CardDescription>{integration.description}</CardDescription>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                         <span className='text-sm font-medium'>{integration.enabled ? 'Ativo' : 'Inativo'}</span>
                        <Switch
                            checked={integration.enabled}
                            onCheckedChange={handleEnabledChange}
                        />
                    </div>
                </div>
            </CardHeader>
            <CardContent className={`space-y-4 pt-4 border-t transition-all ${integration.enabled ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
                 <div className="space-y-2">
                    <Label htmlFor={`agent-name-${integration.id}`} className="flex items-center gap-2 text-muted-foreground"><UserIcon className="w-4 h-4"/> Nome do Agente</Label>
                    <Input
                        id={`agent-name-${integration.id}`}
                        placeholder="Ex: Robô de Vendas"
                        value={integration.settings.agentName || ''}
                        onChange={(e) => handleSettingChange('agentName', e.target.value)}
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor={`webhook-url-${integration.id}`} className="flex items-center gap-2 text-muted-foreground"><Link className="w-4 h-4"/> URL do Webhook</Label>
                    <Input
                        id={`webhook-url-${integration.id}`}
                        placeholder="https://sua-api.com/webhook"
                        value={integration.settings.webhookUrl || ''}
                        onChange={(e) => handleSettingChange('webhookUrl', e.target.value)}
                    />
                </div>
                 <div className="flex justify-end">
                    <Button>Salvar</Button>
                </div>
            </CardContent>
        </Card>
    );
}

export default function IntegrationsPage() {
    const [user, setUser] = useState<User | null>(null);
    const [integrations, setIntegrations] = useState(initialIntegrations);
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

    const handleUpdateIntegration = (id: string, settings: any) => {
        setIntegrations(integrations.map(int => 
            int.id === id ? { ...int, settings: { ...int.settings, ...settings }, enabled: settings.enabled ?? int.enabled } : int
        ));
    };

    if (!user) {
        return null; // Or a loading spinner
    }

    return (
        <MainLayout user={user}>
            <div className="flex flex-col flex-1 h-full">
                <header className="p-4 border-b flex-shrink-0 bg-card">
                    <h1 className="text-2xl font-bold">Integrações</h1>
                    <p className="text-muted-foreground">Conecte o Dialogy a outras ferramentas para automatizar e aprimorar seus fluxos de trabalho.</p>
                </header>
                <main className="flex-1 overflow-y-auto bg-muted/40 p-6">
                    <div className="max-w-4xl mx-auto space-y-6">
                       {integrations.map(integration => (
                            <IntegrationCard 
                                key={integration.id} 
                                integration={integration}
                                onUpdate={handleUpdateIntegration} 
                            />
                       ))}
                    </div>
                </main>
            </div>
        </MainLayout>
    );
}
