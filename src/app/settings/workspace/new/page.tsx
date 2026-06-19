'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { createWorkspaceAction } from '@/actions/workspace';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, Loader2, PlusCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { useI18n } from '@/i18n/i18n-provider';

const workspaceVerticalOptions = [
    { value: '__none__', label: 'Nao definido' },
    { value: 'isp', label: 'Provedor / ISP' },
    { value: 'clinica', label: 'Clinica' },
    { value: 'ecommerce', label: 'E-commerce' },
    { value: 'delivery', label: 'Delivery' },
    { value: 'saas', label: 'SaaS' },
    { value: 'servicos', label: 'Servicos locais' },
    { value: 'educacao', label: 'Educacao' },
    { value: 'imobiliaria', label: 'Imobiliaria' },
    { value: 'financeiro', label: 'Financeiro' },
    { value: 'geral', label: 'Geral' },
];

function SubmitButton() {
    const { t } = useI18n();
    const { pending } = useFormStatus();
    return (
        <Button type="submit" className="w-full" disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {pending ? t("Criando...") : t("Criar workspace")}
        </Button>
    )
}

export default function NewWorkspacePage() {
  const { t } = useI18n();
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
                {t("Criar novo workspace")}
            </h1>
            <p className="text-muted-foreground">
                {t("Crie um novo espaco de trabalho para organizar suas equipes e conversas.")}
            </p>
        </header>

        <Card className="w-full max-w-lg">
            <form action={formAction}>
                <CardHeader>
                    <CardTitle>{t("Detalhes do workspace")}</CardTitle>
                    <CardDescription>
                        {t("De um nome ao seu novo workspace. Voce podera convidar membros depois.")}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="workspace-name">{t("Nome do workspace")}</Label>
                        <Input
                            id="workspace-name"
                            name="workspaceName"
                            placeholder={t("Ex: Acme Inc, Equipe de Vendas")}
                            required
                            autoFocus
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="workspace-vertical">Nicho do workspace</Label>
                        <Select name="vertical" defaultValue="__none__">
                            <SelectTrigger id="workspace-vertical">
                                <SelectValue placeholder="Selecione o nicho" />
                            </SelectTrigger>
                            <SelectContent>
                                {workspaceVerticalOptions.map(option => (
                                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">Ajuda o agente a receber sugestoes de aprendizado do nicho certo.</p>
                    </div>
                     {state.error && (
                        <Alert variant="destructive" className="mt-4">
                            <AlertCircle className="h-4 w-4" />
                            <AlertTitle>{t("Erro ao criar workspace")}</AlertTitle>
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
