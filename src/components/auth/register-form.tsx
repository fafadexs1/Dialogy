'use client';

import { useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { register } from '@/actions/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, Loader2 } from 'lucide-react';
import type { User } from '@/lib/types';
import { Checkbox } from '../ui/checkbox';


function RegisterButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" className="w-full h-12 text-base bg-gray-800 hover:bg-gray-900 rounded-lg shadow-sm transition-all" disabled={pending}>
      {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {pending ? 'Criando Conta...' : 'Continuar'}
    </Button>
  );
}

export function RegisterForm({ onRegisterSuccess }: { onRegisterSuccess: (user: User) => void }) {
  const [state, formAction] = useActionState(register, { success: false, message: null, user: null });

  useEffect(() => {
    if (state.success && state.user) {
      onRegisterSuccess(state.user as User);
    }
  }, [state, onRegisterSuccess]);


  return (
    <form action={formAction} className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
            <Label htmlFor="name" className="font-semibold text-gray-700 text-sm">Nome <span className="text-gray-400">(obrigatório)</span></Label>
            <Input
            id="name"
            name="name"
            type="text"
            placeholder="Primeiro nome"
            required
            autoComplete="given-name"
            className="h-12 bg-white border-gray-200 rounded-lg px-4 placeholder:text-gray-400 focus:border-primary"
            />
        </div>
         <div className="space-y-2">
            <Label htmlFor="lastname" className="font-semibold text-gray-700 text-sm">Sobrenome <span className="text-gray-400">(obrigatório)</span></Label>
            <Input
            id="lastname"
            name="lastname"
            type="text"
            placeholder="Sobrenome"
            required
            autoComplete="family-name"
            className="h-12 bg-white border-gray-200 rounded-lg px-4 placeholder:text-gray-400 focus:border-primary"
            />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="email" className="font-semibold text-gray-700 text-sm">E-mail <span className="text-gray-400">(obrigatório)</span></Label>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="Insira seu melhor e-mail"
          required
          autoComplete="email"
          className="h-12 bg-white border-gray-200 rounded-lg px-4 placeholder:text-gray-400 focus:border-primary"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password" className="font-semibold text-gray-700 text-sm">Senha <span className="text-gray-400">(obrigatório)</span></Label>
        <Input 
            id="password" 
            name="password" 
            type="password" 
            placeholder="Insira uma palavra-passe"
            required 
            autoComplete="new-password"
            className="h-12 bg-white border-gray-200 rounded-lg px-4 placeholder:text-gray-400 focus:border-primary"
        />
      </div>
       <div className="space-y-2">
        <Label htmlFor="phone" className="font-semibold text-gray-700 text-sm">Telefone pessoal <span className="text-gray-400">(obrigatório)</span></Label>
        <Input 
            id="phone" 
            name="phone" 
            type="tel" 
            placeholder="Insira o seu número - não é o número da empresa"
            required 
            autoComplete="tel"
            className="h-12 bg-white border-gray-200 rounded-lg px-4 placeholder:text-gray-400 focus:border-primary"
        />
      </div>
      <div className="flex items-center space-x-2">
        <Checkbox id="terms" required />
        <label
          htmlFor="terms"
          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-gray-600"
        >
          Li e aceito os termos de uso da Dialogy.{' '}
          <a href="#" className="underline text-primary">Ler termos</a>
        </label>
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
