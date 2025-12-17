'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { updateWorkspaceAction } from '@/actions/workspace'; // Reuse the workspace action which handles nexus_settings
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Save, Mail, Unplug } from 'lucide-react';
import { useCurrentUser } from '@/hooks/use-online-status';
import { useToast } from '@/hooks/use-toast';
import { getNexusConfig } from '@/actions/nexus';

function SubmitButton() {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" disabled={pending} className="min-w-[140px]">
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            {pending ? 'Salvando...' : 'Salvar Configuração'}
        </Button>
    )
}

export default function NexusFlowIntegrationPage() {
    const user = useCurrentUser();
    const [config, setConfig] = useState<{ email?: string } | null>(null);
    const [isFetching, setIsFetching] = useState(true);

    // We reuse updateWorkspaceAction, but check if we need a specific wrapper or if it accepts just part of the form.
    // updateWorkspaceAction handles nexusEmail if present in FormData.
    const [state, formAction] = useActionState(updateWorkspaceAction, { success: false, error: null });
    const { toast } = useToast();

    useEffect(() => {
        if (!user || !user.activeWorkspaceId) return;

        getNexusConfig(user.activeWorkspaceId).then(cfg => {
            setConfig(cfg);
            setIsFetching(false);
        });
    }, [user]);

    useEffect(() => {
        if (state.success) {
            toast({ title: "Integração Atualizada", description: "Configurações do NexusFlow salvas com sucesso." });
        } else if (state.error) {
            toast({ title: "Erro", description: state.error, variant: "destructive" });
        }
    }, [state, toast]);


    // Checking if fetching config is done. 
    // If user is null (loading or not logged in), we just show loader.
    if (!user || isFetching) {
        return <div className="flex h-64 w-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
    }

    if (!user?.activeWorkspaceId) {
        return <div className="p-8 text-center text-muted-foreground">Selecione um workspace para configurar a integração.</div>
    }

    return (
        <div className="max-w-4xl mx-auto space-y-8 py-8">
            <header>
                <h1 className="text-3xl font-bold tracking-tight">Integração NexusFlow</h1>
                <p className="text-muted-foreground mt-2 text-lg">
                    Conecte seu fluxo de automação avançada com o Dialogy.
                </p>
            </header>

            <form action={formAction}>
                <input type="hidden" name="workspaceId" value={user.activeWorkspaceId} />

                <Card className="border-none shadow-sm bg-card/50 ring-1 ring-purple-500/10">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-purple-600 dark:text-purple-400">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6"><path d="M12 2a10 10 0 1 0 10 10 10.01 10.01 0 0 0-10-10zm0 14a4 4 0 1 1 4-4 4 4 0 0 1-4 4zm0-6a2 2 0 1 0 2 2 2 2 0 0 0-2-2z" /></svg>
                            Conta Mestre Unificada
                        </CardTitle>
                        <CardDescription>
                            Defina uma conta única do NexusFlow para ser usada por todos os membros deste workspace.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="space-y-2">
                            <Label htmlFor="nexusEmail">E-mail da Conta Mestre</Label>
                            <div className="relative max-w-md">
                                <Input
                                    id="nexusEmail"
                                    name="nexusEmail"
                                    type="email"
                                    placeholder="ex: admin@empresa.com"
                                    defaultValue={config?.email || ''}
                                    className="pl-10 h-11"
                                />
                                <Mail className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                            </div>
                            <p className="text-sm text-muted-foreground mt-2 max-w-2xl text-balance">
                                <strong>Como funciona:</strong> Quando configurado, qualquer membro da sia equipe que abrir o NexusFlow será autenticado automaticamente com este e-mail, compartilhando os mesmos fluxos e configurações.
                            </p>
                        </div>

                        <div className="pt-4 border-t">
                            <SubmitButton />
                        </div>
                    </CardContent>
                </Card>
            </form>
        </div>
    );
}
