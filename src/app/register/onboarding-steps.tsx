'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { User } from '@/lib/types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckCircle2, Building, UserPlus, ArrowRight, Loader2 } from 'lucide-react';
import { createWorkspaceAction } from '@/actions/workspace';
import { useFormStatus, useActionState } from 'react-dom';

function CreateWorkspaceForm({ onWorkspaceCreated }: { onWorkspaceCreated: () => void }) {
  const [state, formAction] = useActionState(createWorkspaceAction, { success: false, error: null });
  const { pending } = useFormStatus();

  useEffect(() => {
    if (state.success) {
      onWorkspaceCreated();
    }
  }, [state, onWorkspaceCreated]);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="workspaceName">Nome do Workspace</Label>
        <Input id="workspaceName" name="workspaceName" placeholder="Ex: Acme Inc." required disabled={pending}/>
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
        Continuar
      </Button>
    </form>
  );
}


export default function OnboardingSteps({ user, currentStep, onWorkspaceCreated }: { user: User, currentStep: number, onWorkspaceCreated: () => void }) {
  const router = useRouter();

  const finishOnboarding = () => {
    router.push('/');
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 2:
        return (
          <>
            <div className='text-center'>
              <CardTitle className="text-2xl font-bold text-gray-800">Crie seu primeiro Workspace</CardTitle>
              <CardDescription className='mt-1'>Um workspace é o espaço onde sua equipe colabora. Você pode ter vários.</CardDescription>
            </div>
            <div className='mt-8'>
              <CreateWorkspaceForm onWorkspaceCreated={onWorkspaceCreated} />
            </div>
          </>
        );
      case 3:
        return (
             <div className='text-center'>
                <CardTitle className="text-2xl font-bold text-gray-800">Tudo pronto!</CardTitle>
                <CardDescription className='mt-1'>Seu workspace foi criado. Você pode convidar sua equipe agora ou fazer isso mais tarde nas configurações.</CardDescription>
                <div className="p-8 text-center border-2 border-dashed rounded-lg mt-8">
                    <p className="text-muted-foreground">Funcionalidade de convite em breve.</p>
                </div>
                <Button onClick={finishOnboarding} className="w-full mt-8">
                    Ir para o App <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
            </div>
        )
      default:
        // Should not happen, but as a fallback:
        return (
             <div>
                <p>Etapa desconhecida.</p>
                <Button onClick={() => router.push('/')}>Ir para o App</Button>
            </div>
        )
    }
  };

  return (
      <>
        {renderStepContent()}
      </>
  );
}
