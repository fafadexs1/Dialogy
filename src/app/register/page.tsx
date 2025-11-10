
'use client';

import { useActionState, useEffect, useState } from 'react';
import { RegisterForm } from '@/components/auth/register-form';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { User } from '@/lib/types';
import OnboardingSteps from './onboarding-steps';
import { register } from '@/actions/auth';

export default function RegisterPage() {
  const [state, formAction] = useActionState(register, { success: false, message: null, user: null });
  const [step, setStep] = useState(1);

  useEffect(() => {
    if (state.success && state.user) {
      setStep(2);
    }
  }, [state]);

  const handleWorkspaceCreated = () => {
    setStep(3);
  }

  const STEPS = [
      { id: 1, title: "Dados de acesso" },
      { id: 2, title: "Crie seu Workspace" },
      { id: 3, title: "Convide sua Equipe" },
  ]

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-gray-50 p-6">
        <div className="w-full max-w-2xl">

            {/* Step Indicator */}
            <div className="flex items-center justify-center mb-8 gap-2">
                {STEPS.map((s, index) => (
                    <div key={s.id} className="flex items-center gap-2">
                         <div
                            className={cn(
                                'h-8 w-8 rounded-lg flex items-center justify-center font-bold text-sm transition-colors',
                                step === s.id ? 'bg-primary text-primary-foreground' : 'bg-gray-200 text-gray-500'
                            )}
                        >
                            {s.id}
                        </div>
                        {index < STEPS.length - 1 && <div className="h-px w-12 bg-gray-200" />}
                    </div>
                ))}
            </div>

            {/* Step Content */}
            <div className="bg-white p-8 sm:p-10 rounded-xl shadow-sm border">
                {step === 1 && (
                    <>
                        <div>
                            <h2 className="text-2xl font-bold text-gray-800">Dados de acesso</h2>
                            <p className="text-sm text-gray-500 mt-1">Para continuar, por favor, preencha os campos abaixo</p>
                        </div>
                        <div className="mt-8">
                           <RegisterForm action={formAction as (formData: FormData) => void} state={state} />
                        </div>
                         <div className="mt-6 text-center text-sm">
                            <p className="text-gray-600">
                                Já tem uma conta?{' '}
                                <Link href="/login" className="font-medium text-[#007BFF] hover:underline">
                                Entre
                                </Link>
                            </p>
                        </div>
                    </>
                )}
                 {step > 1 && state.user && (
                    <OnboardingSteps
                        user={state.user}
                        currentStep={step}
                        onWorkspaceCreated={handleWorkspaceCreated}
                    />
                )}
            </div>
        </div>
    </div>
  );
}
