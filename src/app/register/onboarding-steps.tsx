
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
import { useFormStatus } from 'react-dom';
import { useActionState } from 'react';
import { useI18n } from '@/i18n/i18n-provider';

function CreateWorkspaceForm({ onWorkspaceCreated }: { onWorkspaceCreated: () => void }) {
  const { t } = useI18n();
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
        <Label htmlFor="workspaceName">{t("Nome do workspace")}</Label>
        <Input id="workspaceName" name="workspaceName" placeholder={t("Ex: Acme Inc.")} required disabled={pending} />
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
        {t("Continuar")}
      </Button>
    </form>
  );
}


export default function OnboardingSteps({ user, currentStep, onWorkspaceCreated }: { user: User, currentStep: number, onWorkspaceCreated: () => void }) {
  const { t } = useI18n();
  const router = useRouter();

  const finishOnboarding = () => {
    router.push('/inbox');
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 2:
        return (
          <>
            <div className='text-center'>
              <CardTitle className="text-2xl font-bold text-gray-800">{t("Crie seu primeiro workspace")}</CardTitle>
              <CardDescription className='mt-1'>{t("Um workspace e o espaco onde sua equipe colabora. Voce pode ter varios.")}</CardDescription>
            </div>
            <div className='mt-8'>
              <CreateWorkspaceForm onWorkspaceCreated={onWorkspaceCreated} />
            </div>
          </>
        );
      default:
        // Etapas removidas. Se chegar aqui, redireciona.
        finishOnboarding();
        return (
          <div>
            <p>{t("Redirecionando...")}</p>
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
