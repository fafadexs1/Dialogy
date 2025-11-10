
'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { type User } from '@/lib/types';
import { register } from '@/actions/auth';
import { createWorkspaceAction } from '@/actions/workspace';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, Loader2, ArrowRight } from 'lucide-react';
import { RegisterForm } from '@/components/auth/register-form';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export default function RegisterPage() {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState<FormData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleStep1Submit = (data: FormData) => {
    setFormData(data);
    setStep(2);
  };
  
  const handleStep2Submit = (data: FormData) => {
    if (!formData) return;

    // Append workspace name to existing form data
    formData.append('workspaceName', data.get('workspaceName') as string);
    
    startTransition(async () => {
        const result = await register(null, formData);
        if (result.success && result.user) {
            // After user is created, create their workspace
            const workspaceResult = await createWorkspaceAction(null, formData);
            if (workspaceResult.success) {
                setStep(3); // Go to final step
            } else {
                setError(workspaceResult.error || "Falha ao criar o workspace.");
                setStep(2); // Stay on step 2 to show error
            }
        } else {
            setError(result.message || "Ocorreu um erro desconhecido durante o registro.");
            setStep(1); // Go back to step 1 to show error
        }
    });
  }

  const STEPS = [
      { id: 1, title: "Dados de acesso" },
      { id: 2, title: "Crie seu Workspace" },
      { id: 3, title: "Tudo Pronto" },
  ];

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-gray-50 p-6">
        <div className="w-full max-w-2xl">
            <div className="flex items-center justify-center mb-8 gap-2">
                {STEPS.map((s, index) => (
                    <div key={s.id} className="flex items-center gap-2">
                         <div
                            className={cn(
                                'h-8 w-8 rounded-lg flex items-center justify-center font-bold text-sm transition-colors',
                                step >= s.id ? 'bg-primary text-primary-foreground' : 'bg-gray-200 text-gray-500'
                            )}
                        >
                            {s.id}
                        </div>
                        {index < STEPS.length - 1 && <div className="h-px w-12 bg-gray-200" />}
                    </div>
                ))}
            </div>

            <div className="bg-white p-8 sm:p-10 rounded-xl shadow-sm border">
                {error && (
                    <Alert variant="destructive" className="mb-6">
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>Erro no Processo</AlertTitle>
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                )}
                {isPending && (
                    <div className="flex justify-center items-center p-10">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        <p className="ml-4">Processando...</p>
                    </div>
                )}
                
                {!isPending && (
                    <>
                        {step === 1 && (
                            <div>
                                <div>
                                    <h2 className="text-2xl font-bold text-gray-800">Dados de acesso</h2>
                                    <p className="text-sm text-gray-500 mt-1">Para continuar, por favor, preencha os campos abaixo.</p>
                                </div>
                                <div className="mt-8">
                                   <RegisterForm onContinue={handleStep1Submit} pending={isPending}/>
                                </div>
                                 <div className="mt-6 text-center text-sm">
                                    <p className="text-gray-600">
                                        Já tem uma conta?{' '}
                                        <Link href="/login" className="font-medium text-[#007BFF] hover:underline">
                                        Entre
                                        </Link>
                                    </p>
                                </div>
                            </div>
                        )}
                        {step === 2 && (
                            <form onSubmit={(e) => { e.preventDefault(); handleStep2Submit(new FormData(e.currentTarget)); }}>
                                 <div className='text-center'>
                                  <CardTitle className="text-2xl font-bold text-gray-800">Crie seu primeiro Workspace</CardTitle>
                                  <CardDescription className='mt-1'>Um workspace é o espaço onde sua equipe colabora. Você pode ter vários.</CardDescription>
                                </div>
                                <div className='mt-8 space-y-4'>
                                    <div className="space-y-2">
                                        <Label htmlFor="workspaceName">Nome do Workspace</Label>
                                        <Input id="workspaceName" name="workspaceName" placeholder="Ex: Acme Inc." required />
                                    </div>
                                    <Button type="submit" className="w-full" disabled={isPending}>
                                        <ArrowRight className="mr-2 h-4 w-4" />
                                        Criar e Continuar
                                    </Button>
                                </div>
                            </form>
                        )}
                        {step === 3 && (
                             <div className='text-center'>
                                <CardTitle className="text-2xl font-bold text-gray-800">Tudo pronto!</CardTitle>
                                <CardDescription className='mt-1'>Seu usuário e workspace foram criados com sucesso.</CardDescription>
                                <Button asChild className="w-full mt-8">
                                    <Link href="/">
                                        Ir para o App <ArrowRight className="ml-2 h-4 w-4" />
                                    </Link>
                                </Button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    </div>
  );
}
