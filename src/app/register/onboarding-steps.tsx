'use client';

import { useState, useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { User } from '@/lib/types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckCircle2, Building, UserPlus, ArrowRight, Loader2 } from 'lucide-react';
import { createWorkspaceAction } from '@/actions/workspace';
import { useFormStatus } from 'react-dom';

const steps = [
  { id: 1, title: 'Conta Criada', icon: <CheckCircle2 className="h-10 w-10 text-green-500" /> },
  { id: 2, title: 'Crie seu Workspace', icon: <Building className="h-10 w-10 text-primary" /> },
  { id: 3, title: 'Convide sua Equipe', icon: <UserPlus className="h-10 w-10 text-primary" /> },
];

function StepIndicator({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex items-center justify-center gap-8 mb-8">
      {steps.map((step, index) => (
        <React.Fragment key={step.id}>
          <div className="flex flex-col items-center gap-2">
            <div
              className={`h-12 w-12 rounded-full flex items-center justify-center transition-colors ${
                currentStep >= step.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
              }`}
            >
              {step.id < currentStep ? <CheckCircle2 className="h-6 w-6" /> : React.cloneElement(step.icon, { className: "h-6 w-6" })}
            </div>
            <p className={`text-sm font-medium ${currentStep >= step.id ? 'text-primary' : 'text-muted-foreground'}`}>
              {step.title}
            </p>
          </div>
          {index < steps.length - 1 && <div className="h-px w-16 bg-border mt-[-2rem]" />}
        </React.Fragment>
      ))}
    </div>
  );
}

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


export default function OnboardingSteps({ user }: { user: User }) {
  const [currentStep, setCurrentStep] = useState(1);
  const router = useRouter();

  const goToNextStep = () => setCurrentStep(prev => prev + 1);

  const finishOnboarding = () => {
    router.push('/');
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <>
            <CardHeader className="items-center text-center">
              <CardTitle className="text-2xl">Conta Criada com Sucesso!</CardTitle>
              <CardDescription>Bem-vindo(a), {user.firstName}! Vamos configurar seu ambiente de trabalho.</CardDescription>
            </CardHeader>
            <CardFooter>
              <Button onClick={goToNextStep} className="w-full">
                Começar <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </CardFooter>
          </>
        );
      case 2:
        return (
          <>
            <CardHeader>
              <CardTitle>Crie seu primeiro Workspace</CardTitle>
              <CardDescription>Um workspace é o espaço onde sua equipe colabora. Você pode ter vários.</CardDescription>
            </CardHeader>
            <CardContent>
              <CreateWorkspaceForm onWorkspaceCreated={goToNextStep} />
            </CardContent>
          </>
        );
      case 3:
        return (
             <>
                <CardHeader className="text-center">
                    <CardTitle>Tudo pronto!</CardTitle>
                    <CardDescription>Seu workspace foi criado. Você pode convidar sua equipe agora ou fazer isso mais tarde nas configurações.</CardDescription>
                </CardHeader>
                <CardContent>
                    {/* Placeholder for invite form */}
                    <div className="p-8 text-center border-2 border-dashed rounded-lg">
                        <p className="text-muted-foreground">Funcionalidade de convite em breve.</p>
                    </div>
                </CardContent>
                <CardFooter>
                     <Button onClick={finishOnboarding} className="w-full">
                        Ir para o App <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                </CardFooter>
            </>
        )
      default:
        return null;
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-2xl">
        <StepIndicator currentStep={currentStep} />
        <Card className="w-full">
          {renderStepContent()}
        </Card>
      </div>
    </div>
  );
}
