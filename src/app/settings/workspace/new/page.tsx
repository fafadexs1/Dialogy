'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createWorkspaceAction } from '@/actions/workspace';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, Loader2, PlusCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';

function SubmitButton() {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" className="w-full" disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {pending ? 'Criando...' : 'Criar Workspace'}
        </Button>
    )
}

export default function NewWorkspacePage() {
  const [state, formAction] = useActionState(createWorkspaceAction, { success: false, error: null });
  const router = useRouter();

  useEffect(() => {
    if(state.success) {
      router.refresh();
      router.push('/');
    }
  }, [state, router]);
  
  return (
    <div className="max-w-3xl">
         <header className="mb-6">
            <h1 className="text-2xl font-bold flex items-center gap-2">
                <PlusCircle />
                Criar Novo Workspace
            </h1>
            <p className="text-muted-foreground">
                Crie um novo espaço de trabalho para organizar suas equipes e conversas.
            </p>
        </header>

        <Card className="w-full max-w-lg">
            <form action={formAction}>
                <CardHeader>
                    <CardTitle>Detalhes do Workspace</CardTitle>
                    <CardDescription>
                        Dê um nome ao seu novo workspace. Você poderá convidar membros depois.
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
                    </div>
                     {state.error && (
                        <Alert variant="destructive" className="mt-4">
                            <AlertCircle className="h-4 w-4" />
                            <AlertTitle>Erro ao criar workspace</AlertTitle>
                            <AlertDescription>{state.error}</AlertDescription>
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
