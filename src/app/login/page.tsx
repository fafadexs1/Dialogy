import { LoginForm } from '@/components/auth/login-form';
import { Code2 } from 'lucide-react';
import Link from 'next/link';
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
    <div className="min-h-screen bg-[#020617] text-white selection:bg-blue-500/30 flex flex-col items-center justify-center relative overflow-hidden">
      {/* Background Elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-[url('/grid.svg')] bg-center opacity-20" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-blue-600/10 blur-[120px] rounded-full" />
      </div>

      <div className="w-full max-w-md relative z-10 px-6">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 mb-6 group">
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center group-hover:scale-110 transition-transform">
              <Code2 className="w-6 h-6 text-white" />
            </div>
            <span className="text-2xl font-bold tracking-tight">Dialogy</span>
          </Link>

          <h1 className="text-3xl font-bold mb-2 tracking-tight">Bem-vindo de volta</h1>
          <p className="text-white/60">
            Acesse sua conta para gerenciar seus bots e conversas.
          </p>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-8 backdrop-blur-xl shadow-2xl">
          {isRegistered && (
            <div className="mb-6 p-4 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm text-center">
              Conta criada com sucesso! Faça login para continuar.
            </div>
          )}

          <LoginForm redirectTo={resolvedSearchParams?.next} />
        </div>

        <p className="text-center mt-8 text-sm text-white/40">
          Não tem uma conta?{' '}
          <Link href="/register" className="text-blue-400 hover:text-blue-300 font-medium transition-colors">
            Cadastre-se gratuitamente
          </Link>
        </p>
      </div>
    </div>
  );
}
