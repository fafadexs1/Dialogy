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
  const [errorMessage, formAction, isPending] = useActionState(createWorkspaceAction, null);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const { toast } = useToast();
  
  useEffect(() => {
    // This effect is triggered after the form action completes.
    // If there is no error message and the action is no longer pending,
    // it means the submission was successful.
    const formSubmitted = formRef.current?.dataset.submitted === 'true';

    if (formSubmitted && !isPending) {
        if (!errorMessage) {
            toast({
                title: 'Sucesso!',
                description: 'Workspace criado. Redirecionando...',
            });
            // Redirect after successful creation
            router.push('/');
        } else {
             // Reset the 'submitted' state to allow for a new attempt.
            if(formRef.current) {
                formRef.current.dataset.submitted = 'false';
            }
        }
    }
  }, [isPending, errorMessage, router, toast]);


  const handleFormSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if(formRef.current) {
        formRef.current.dataset.submitted = 'true';
    }
    const formData = new FormData(event.currentTarget);
    formAction(formData);
  };

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
            <form ref={formRef} onSubmit={handleFormSubmit} data-submitted="false">
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
