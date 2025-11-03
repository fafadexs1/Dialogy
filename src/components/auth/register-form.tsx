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
import type { User } from '@/lib/types';


function RegisterButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" className="w-full h-12 text-base bg-[#007BFF] hover:bg-[#006ae0] rounded-lg shadow-md hover:shadow-lg transition-all" disabled={pending}>
      {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {pending ? 'Creating Account...' : 'Criar minha conta'}
    </Button>
  );
}

export function RegisterForm({ onRegisterSuccess }: { onRegisterSuccess: (user: User) => void }) {
  const [state, formAction] = useActionState(register, { success: false, message: null, user: null });

  useEffect(() => {
    if (state.success && state.user) {
      // Instead of redirecting, call the callback to switch the view
      // to the onboarding steps.
      onRegisterSuccess(state.user as User);
    }
  }, [state, onRegisterSuccess]);


  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name" className="font-semibold text-gray-600">Nome Completo</Label>
        <Input
          id="name"
          name="name"
          type="text"
          placeholder="Seu nome completo"
          required
          autoComplete="name"
           className="h-12 bg-white border-[#dcdcdc] rounded-lg px-4 placeholder:text-[#999] focus:border-[#007BFF]"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email" className="font-semibold text-gray-600">Seu melhor e-mail</Label>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="email@dominio.com"
          required
          autoComplete="email"
           className="h-12 bg-white border-[#dcdcdc] rounded-lg px-4 placeholder:text-[#999] focus:border-[#007BFF]"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password" className="font-semibold text-gray-600">Crie uma senha</Label>
        <Input 
            id="password" 
            name="password" 
            type="password" 
            placeholder="Pelo menos 6 caracteres"
            required 
            autoComplete="new-password"
            className="h-12 bg-white border-[#dcdcdc] rounded-lg px-4 placeholder:text-[#999] focus:border-[#007BFF]"
        />
      </div>
      {state?.message && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Erro no Registro</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}

      <RegisterButton />
    </form>
  );
}
