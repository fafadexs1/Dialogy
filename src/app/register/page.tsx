'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { register } from '@/actions/auth';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, Code2 } from 'lucide-react';
import { RegisterForm } from '@/components/auth/register-form';
import { useActionState } from 'react';

export default function RegisterPage() {
    const [registerState, registerAction, isRegisterPending] = useActionState(register, { success: false, message: null, user: null });
    const router = useRouter();

    useEffect(() => {
        if (registerState.success) {
            router.push('/inbox');
        }
    }, [registerState.success, router]);

    return (
        <div className="min-h-screen bg-[#020617] text-white selection:bg-blue-500/30 flex flex-col items-center justify-center relative overflow-hidden">
            {/* Background Elements */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute inset-0 bg-[url('/grid.svg')] bg-center opacity-20" />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-blue-600/10 blur-[120px] rounded-full" />
            </div>

            <div className="w-full max-w-2xl relative z-10 px-6 py-12">
                <div className="text-center mb-8">
                    <Link href="/" className="inline-flex items-center gap-2 mb-6 group">
                        <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                            <Code2 className="w-6 h-6 text-white" />
                        </div>
                        <span className="text-2xl font-bold tracking-tight">Dialogy</span>
                    </Link>

                    <h1 className="text-3xl font-bold mb-2 tracking-tight">Crie sua conta</h1>
                    <p className="text-white/60">
                        Comece a automatizar suas conversas hoje mesmo.
                    </p>
                </div>

                <div className="bg-white/5 border border-white/10 rounded-2xl p-8 sm:p-10 backdrop-blur-xl shadow-2xl">
                    {registerState.message && (
                        <Alert variant="destructive" className="mb-6 bg-red-500/10 border-red-500/20 text-red-400">
                            <AlertCircle className="h-4 w-4" />
                            <AlertTitle>Erro no Cadastro</AlertTitle>
                            <AlertDescription>{registerState.message}</AlertDescription>
                        </Alert>
                    )}

                    <RegisterForm onRegister={registerAction} pending={isRegisterPending} />
                </div>

                <p className="text-center mt-8 text-sm text-white/40">
                    Já tem uma conta?{' '}
                    <Link href="/login" className="text-blue-400 hover:text-blue-300 font-medium transition-colors">
                        Entre agora
                    </Link>
                </p>
            </div>
        </div>
    );
}
