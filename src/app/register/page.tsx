
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { register } from '@/actions/auth';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, Loader2 } from 'lucide-react';
import { RegisterForm } from '@/components/auth/register-form';
import { useActionState } from 'react';

export default function RegisterPage() {
  const [registerState, registerAction, isRegisterPending] = useActionState(register, { success: false, message: null, user: null });
  const router = useRouter();

  useEffect(() => {
    if (registerState.success) {
      router.push('/');
    }
  }, [registerState.success, router]);

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-gray-50 p-6">
        <div className="w-full max-w-2xl">
            <div className="bg-white p-8 sm:p-10 rounded-xl shadow-sm border">
                {registerState.message && (
                    <Alert variant="destructive" className="mb-6">
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>Erro no Cadastro</AlertTitle>
                        <AlertDescription>{registerState.message}</AlertDescription>
                    </Alert>
                )}
                
                <div>
                    <div>
                        <h2 className="text-2xl font-bold text-gray-800">Crie sua conta</h2>
                        <p className="text-sm text-gray-500 mt-1">Para começar, preencha os campos abaixo.</p>
                    </div>
                    <div className="mt-8">
                       <RegisterForm onRegister={registerAction} pending={isRegisterPending}/>
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
            </div>
        </div>
    </div>
  );
}
