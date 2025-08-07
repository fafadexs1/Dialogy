'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useAuth } from "@/hooks/use-auth";
import { updateWorkspaceAction } from '@/actions/workspace';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, AlertCircle } from 'lucide-react';
import type { Workspace } from '@/lib/types';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';

function SubmitButton() {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {pending ? 'Salvando...' : 'Salvar Alterações'}
        </Button>
    )
}

export default function WorkspaceSettingsPage() {
    const user = useAuth();
    const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
    const [workspaceName, setWorkspaceName] = useState('');
    const [errorMessage, formAction] = useActionState(updateWorkspaceAction, null);
    const { toast } = useToast();

    useEffect(() => {
        if (user?.activeWorkspaceId && user.workspaces) {
            const workspace = user.workspaces.find(ws => ws.id === user.activeWorkspaceId);
            if (workspace) {
                setActiveWorkspace(workspace);
                setWorkspaceName(workspace.name);
            }
        }
    }, [user]);

    useEffect(() => {
        if (errorMessage) {
            toast({
                title: "Erro ao atualizar",
                description: errorMessage,
                variant: "destructive"
            });
        }
    }, [errorMessage, toast]);


    if (!user || !activeWorkspace) {
        return <div className="flex items-center justify-center h-full">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
    }

    return (
        <div className="max-w-3xl">
            <header className="mb-6">
                 <h1 className="text-2xl font-bold">Configurações do Workspace</h1>
                 <p className="text-muted-foreground">Gerencie o nome e outras configurações do seu workspace atual.</p>
            </header>
            
            <form action={formAction}>
                 <Card>
                    <CardHeader>
                        <CardTitle>Detalhes do Workspace</CardTitle>
                        <CardDescription>Altere o nome do seu workspace.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <input type="hidden" name="workspaceId" value={activeWorkspace.id} />
                        <div className="space-y-2">
                            <Label htmlFor="workspaceName">Nome do Workspace</Label>
                            <Input 
                                id="workspaceName"
                                name="workspaceName"
                                value={workspaceName}
                                onChange={(e) => setWorkspaceName(e.target.value)}
                            />
                        </div>
                    </CardContent>
                    <CardFooter className="border-t pt-6 flex justify-between items-center">
                        <p className="text-sm text-muted-foreground">As alterações serão refletidas em toda a plataforma.</p>
                        <SubmitButton />
                    </CardFooter>
                </Card>
            </form>
        </div>
    )
}