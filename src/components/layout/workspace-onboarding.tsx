
'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createWorkspaceAction } from '@/actions/workspace';
import type { User } from '@/lib/types';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { AlertCircle } from 'lucide-react';

function SubmitButton() {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" className="w-full" disabled={pending}>
            {pending ? 'Criando...' : 'Criar Workspace'}
        </Button>
    )
}

export function WorkspaceOnboarding({ user }: { user: User }) {
  const [errorMessage, formAction] = useActionState(createWorkspaceAction, null);

  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-muted/40 p-6">
        <Card className="w-full max-w-lg">
            <form action={formAction}>
                <CardHeader>
                    <CardTitle className="text-2xl">Bem-vindo(a) ao Dialogy, {user.name.split(' ')[0]}!</CardTitle>
                    <CardDescription>
                        Para começar, crie um workspace para sua equipe. Você poderá convidar outros membros depois.
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
                        />
                         <input type="hidden" name="userId" value={user.id} />
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
                    <SubmitButton />
                </CardFooter>
            </form>
        </Card>
    </div>
  );
}
