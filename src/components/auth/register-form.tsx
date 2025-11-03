
'use client';

import { useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { register } from '@/actions/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, Loader2 } from 'lucide-react';


function RegisterButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" className="w-full h-12 text-base" disabled={pending}>
      {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {pending ? 'Registrando...' : 'Criar Conta'}
    </Button>
  );
}

export function RegisterForm() {
  const [state, formAction] = useActionState(register, { success: false, message: null });
  const router = useRouter();

  useEffect(() => {
    if (state.success) {
      router.push('/login?registered=true');
    }
  }, [state.success, router]);


  return (
    <form action={formAction} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="name">Nome Completo</Label>
        <Input
          id="name"
          name="name"
          type="text"
          placeholder="Seu Nome Completo"
          required
          autoComplete="name"
          className="h-12 bg-gray-800/50 border-gray-700/50 text-white placeholder:text-gray-500 focus:border-primary"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="agente@dialogy.com"
          required
          autoComplete="email"
          className="h-12 bg-gray-800/50 border-gray-700/50 text-white placeholder:text-gray-500 focus:border-primary"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Senha</Label>
        <Input 
            id="password" 
            name="password" 
            type="password" 
            required 
            autoComplete="new-password"
            className="h-12 bg-gray-800/50 border-gray-700/50 text-white placeholder:text-gray-500 focus:border-primary"
        />
      </div>
      {state?.message && (
        <Alert variant="destructive" className="bg-red-500/10 border-red-500/30 text-red-300">
          <AlertCircle className="h-4 w-4 !text-red-400" />
          <AlertTitle>Erro no Registro</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}

      <RegisterButton />
    </form>
  );
}
