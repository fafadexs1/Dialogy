
import { LoginForm } from '@/components/auth/login-form';
import { LifeBuoy, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: { registered?: string };
}) {
  const isRegistered = searchParams?.registered === 'true';

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#1E2D4A] to-[#0E1524] p-4">
      <div className="w-full max-w-4xl overflow-hidden rounded-2xl bg-[#1C1C2E] shadow-2xl md:grid md:grid-cols-2">
        
        {/* Coluna da Esquerda: Formulário */}
        <div className="p-8 sm:p-12 text-white">
          <div className="mb-8 flex flex-col items-center text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <LifeBuoy className="h-8 w-8" />
            </div>
            <h1 className="text-3xl font-bold">Bem-vindo(a) de volta!</h1>
            <p className="mt-2 text-sm text-gray-400">Faça login para continuar na plataforma.</p>
          </div>

          {isRegistered && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-green-300/30 bg-green-500/10 p-3 text-sm font-medium text-green-300">
              <CheckCircle2 className="h-5 w-5" />
              <p>Registro realizado com sucesso! Faça o login para continuar.</p>
            </div>
          )}

          <LoginForm />

          <p className="mt-6 text-center text-sm text-gray-400">
            Não tem uma conta?{' '}
            <Link href="/register" className="font-medium text-primary hover:underline">
              Registre-se
            </Link>
          </p>
        </div>

        {/* Coluna da Direita: Imagem */}
        <div className="relative hidden md:block">
          <Image
            src="https://picsum.photos/seed/1/800/1000"
            alt="Arte promocional do Dialogy"
            width={800}
            height={1000}
            className="h-full w-full object-cover"
            data-ai-hint="illustration digital art"
          />
           <div className="absolute inset-0 bg-gradient-to-t from-[#1C1C2E] via-transparent to-transparent"></div>
        </div>
      </div>
    </main>
  );
}
