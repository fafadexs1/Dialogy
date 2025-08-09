
'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createWorkspaceAction } from '@/actions/workspace';
import type { User } from '@/lib/types';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { joinWorkspaceAction } from '@/actions/invites';


function CreateWorkspaceForm() {
    const [errorMessage, formAction] = useActionState(createWorkspaceAction, null);
    const { pending } = useFormStatus();

    return (
         <form action={formAction}>
            <CardHeader>
                <CardTitle>Criar um novo Workspace</CardTitle>
                <CardDescription>
                    Dê um nome ao seu novo workspace. Você poderá convidar outros membros depois.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="space-y-2">
                    <Label htmlFor="workspace-name">Nome do Workspace</Label>
                    <Input
                        id="workspace-name"
                        name="workspaceName"
                        placeholder="Ex: Acme Inc, Equipe de Vendas"
                        required
                        autoFocus
                        disabled={pending}
                    />
                </div>
                    {errorMessage && (
                    <Alert variant="destructive" className="mt-4">
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>Erro ao criar workspace</AlertTitle>
                        <AlertDescription>{errorMessage}</AlertDescription>
                    </Alert>
                )}
            </CardContent>
            <CardFooter>
                 <Button type="submit" className="w-full" disabled={pending}>
                    {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {pending ? 'Criando...' : 'Criar Workspace'}
                </Button>
            </CardFooter>
        </form>
    )
}

function JoinWorkspaceForm() {
    const [state, formAction] = useActionState(joinWorkspaceAction, { success: false, error: null });
    const { pending } = useFormStatus();
    
    return (
        <form action={formAction}>
            <CardHeader>
                <CardTitle>Entrar em um Workspace</CardTitle>
                <CardDescription>
                    Insira o código de convite que você recebeu para se juntar a uma equipe existente.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="space-y-2">
                    <Label htmlFor="invite-code">Código de Convite</Label>
                    <Input
                        id="invite-code"
                        name="inviteCode"
                        placeholder="Ex: ABC-123"
                        required
                        autoFocus
                        disabled={pending}
                    />
                </div>
                 {state.error && (
                    <Alert variant="destructive" className="mt-4">
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>Erro ao entrar no workspace</AlertTitle>
                        <AlertDescription>{state.error}</AlertDescription>
                    </Alert>
                )}
            </CardContent>
            <CardFooter>
                 <Button type="submit" className="w-full" disabled={pending}>
                    {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {pending ? 'Verificando...' : 'Entrar no Workspace'}
                </Button>
            </CardFooter>
        </form>
    )
}


export function WorkspaceOnboarding({ user }: { user: User }) {
  const [activeTab, setActiveTab] = useState('create');
 
  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-muted/40 p-6">
        <div className='text-center mb-6'>
            <h1 className="text-3xl font-bold">Bem-vindo(a) ao Dialogy, {user.name.split(' ')[0]}!</h1>
            <p className='text-muted-foreground mt-2'>Para começar, crie um novo workspace ou junte-se a um existente usando um código de convite.</p>
        </div>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full max-w-lg">
            <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="create">Criar Workspace</TabsTrigger>
                <TabsTrigger value="join">Entrar com Código</TabsTrigger>
            </TabsList>
            <TabsContent value="create">
                <Card>
                    <CreateWorkspaceForm />
                </Card>
            </TabsContent>
            <TabsContent value="join">
                <Card>
                    <JoinWorkspaceForm />
                </Card>
            </TabsContent>
        </Tabs>
    </div>
  );
}

    