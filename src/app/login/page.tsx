
'use client';

import { useEffect, useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { LoginForm } from '@/components/auth/login-form';
import { LifeBuoy, CheckCircle2, Loader2 } from 'lucide-react';
import Link from 'next/link';

export default function LoginPage() {
  const { data: session, status } = useSession();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const isRegistered = searchParams.get('registered') === 'true';

  useEffect(() => {
    // Se o usuário estiver autenticado, force o logout para que ele possa logar novamente.
    if (status === 'authenticated') {
      setIsLoggingOut(true);
      signOut({ redirect: false }).then(() => {
        setIsLoggingOut(false);
        // Opcional: recarregar para garantir que o estado seja limpo
        // window.location.reload();
      });
    }
  }, [status]);
  
  if (status === 'loading' || isLoggingOut) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-secondary p-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="mt-4 text-muted-foreground">{isLoggingOut ? 'Finalizando sessão anterior...' : 'Carregando...'}</p>
      </main>
    );
  }

  // Só renderiza o formulário se não estiver autenticado
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-secondary p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <LifeBuoy className="h-8 w-8" />
          </div>
          <h1 className="text-3xl font-bold">Dialogy</h1>
          <p className="text-muted-foreground">Bem-vindo de volta</p>
        </div>
        {isRegistered && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-green-300 bg-green-50 p-3 text-sm font-medium text-green-800">
            <CheckCircle2 className="h-5 w-5" />
            <p>Registro realizado com sucesso! Faça o login para continuar.</p>
          </div>
        )}
        <LoginForm />
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Não tem uma conta?{' '}
          <Link href="/register" className="font-medium text-primary hover:underline">
            Registre-se
          </Link>
        </p>
      </div>
    </main>
  );
}
