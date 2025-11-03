
'use client';

import { useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, Loader2 } from 'lucide-react';
import { login } from '@/actions/auth';
import Link from 'next/link';
import { Checkbox } from '../ui/checkbox';

function LoginButton() {
  const { pending } = useFormStatus();
  return (
      <Button type="submit" className="w-full h-12 text-base" disabled={pending}>
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {pending ? 'Entrando...' : 'Entrar'}
      </Button>
  )
}

export function LoginForm() {
  const [state, formAction] = useActionState(login, { success: false, message: null });
  const router = useRouter();

  useEffect(() => {
    if (state.success) {
      window.location.href = '/';
    }
  }, [state, router]);
  
  return (
    <form action={formAction} className="space-y-6">
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
          autoComplete="current-password"
          className="h-12 bg-gray-800/50 border-gray-700/50 text-white placeholder:text-gray-500 focus:border-primary"
        />
      </div>

       <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <Checkbox id="remember-me" className="border-gray-600 data-[state=checked]:bg-primary data-[state=checked]:border-primary" />
          <Label htmlFor="remember-me" className="text-gray-400 font-normal">Lembrar-me</Label>
        </div>
        <Link href="#" className="font-medium text-primary hover:underline">
          Esqueceu a senha?
        </Link>
      </div>
      
      {state?.message && (
        <Alert variant="destructive" className="bg-red-500/10 border-red-500/30 text-red-300">
          <AlertCircle className="h-4 w-4 !text-red-400" />
          <AlertTitle>Erro de Login</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}

      <LoginButton />

    </form>
  );
}
