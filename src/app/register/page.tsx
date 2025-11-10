
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { register } from '@/actions/auth';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, Loader2, ArrowRight } from 'lucide-react';
import { RegisterForm } from '@/components/auth/register-form';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useActionState } from 'react';

export default function RegisterPage() {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState<FormData | null>(null);
  const [registerState, registerAction, isRegisterPending] = useActionState(register, { success: false, message: null, user: null });
  const router = useRouter();

  useEffect(() => {
    if (registerState.success) {
      router.push('/');
    }
  }, [registerState.success, router]);


  const handleStep1Submit = (data: FormData) => {
    setFormData(data);
    setStep(2);
  };
  
  const handleStep2Submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!formData) return;

    const step2Data = new FormData(e.currentTarget);
    // Append workspace name to existing form data
    formData.set('workspaceName', step2Data.get('workspaceName') as string);
    
    registerAction(formData);
  }

  const STEPS = [
      { id: 1, title: "Dados de acesso" },
      { id: 2, title: "Crie seu Workspace" },
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
                {registerState.message && (
                    <Alert variant="destructive" className="mb-6">
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>Erro no Processo</AlertTitle>
                        <AlertDescription>{registerState.message}</AlertDescription>
                    </Alert>
                )}
                {isRegisterPending && (
                    <div className="flex justify-center items-center p-10">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        <p className="ml-4">Processando...</p>
                    </div>
                )}
                
                {!isRegisterPending && (
                    <>
                        {step === 1 && (
                            <div>
                                <div>
                                    <h2 className="text-2xl font-bold text-gray-800">Dados de acesso</h2>
                                    <p className="text-sm text-gray-500 mt-1">Para continuar, por favor, preencha os campos abaixo.</p>
                                </div>
                                <div className="mt-8">
                                   <RegisterForm onContinue={handleStep1Submit} pending={isRegisterPending}/>
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
                            <form onSubmit={handleStep2Submit}>
                                 <div className='text-center'>
                                  <h2 className="text-2xl font-bold text-gray-800">Crie seu primeiro Workspace</h2>
                                  <p className='mt-1 text-sm text-gray-500'>Um workspace é o espaço onde sua equipe colabora. Você pode ter vários.</p>
                                </div>
                                <div className='mt-8 space-y-4'>
                                    <div className="space-y-2">
                                        <Label htmlFor="workspaceName">Nome do Workspace</Label>
                                        <Input id="workspaceName" name="workspaceName" placeholder="Ex: Acme Inc." required />
                                    </div>
                                    <Button type="submit" className="w-full" disabled={isRegisterPending}>
                                        <ArrowRight className="mr-2 h-4 w-4" />
                                        Criar e Finalizar
                                    </Button>
                                </div>
                            </form>
                        )}
                    </>
                )}
            </div>
        </div>
    </div>
  );
}
