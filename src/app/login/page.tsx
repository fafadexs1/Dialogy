import { LoginForm } from '@/components/auth/login-form';
import { LifeBuoy } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

interface LoginPageProps {
  searchParams: Promise<{
    registered?: string;
  }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect('/inbox');
  }

  const resolvedSearchParams = await searchParams;
  const isRegistered = resolvedSearchParams?.registered === 'true';

  return (
    <div className="h-screen w-full flex bg-gray-100">
      <main className="w-full grid md:grid-cols-2">
        {/* Left Side - Informational */}
        <div className="bg-[#007BFF] text-white p-8 sm:p-12 flex flex-col justify-between relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-600 to-indigo-800 opacity-80 z-0"></div>
          <div className="z-10">
            <div className="flex items-center gap-3 mb-8">
              <LifeBuoy className="h-8 w-8" />
              <h1 className="text-2xl font-bold">Dialogy</h1>
            </div>
            <h2 className="text-4xl font-bold leading-tight drop-shadow-md">
              Acesse sua conta para continuar
            </h2>
            <p className="text-lg text-white/80 mt-2 max-w-sm">
              Conecte-se com seus clientes de forma inteligente e automatizada.
            </p>
          </div>
          <div className="absolute right-0 bottom-0 w-80 h-80 opacity-20">
            <Image
              src="https://picsum.photos/seed/rocket/500/500"
              alt="3D Illustration"
              width={320}
              height={320}
              className="w-full h-full float-animation"
              data-ai-hint="3d illustration rocket"
            />
          </div>
          <p className="text-sm text-white/80 max-w-sm z-10">
            Gerencie conversas, automatize respostas com IA e organize seu CRM em um só lugar.
          </p>
        </div>

        {/* Right Side - Form */}
        <div className="bg-card flex flex-col justify-center p-8 sm:p-12">
          <div className="w-full max-w-md mx-auto">
            <div className="mb-8">
              <h2 className="text-3xl font-bold mt-1">
                Acesse a <span className="text-[#007BFF]">Dialogy</span>
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                Bem-vindo(a) de volta! Por favor, insira seus dados.
              </p>
              {isRegistered && (
                <p className="mt-3 rounded-md bg-green-100 px-3 py-2 text-sm text-green-800">
                  Conta criada com sucesso! Faça login para continuar.
                </p>
              )}
            </div>

            <LoginForm />

            <div className="mt-8 text-center text-sm">
              <p className="text-muted-foreground">
                Não tem uma conta?{' '}
                <Link href="/register" className="font-medium text-[#007BFF] hover:underline">
                  Cadastre-se de graça
                </Link>
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
