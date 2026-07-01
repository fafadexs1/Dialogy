import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { LoginForm } from '@/components/auth/login-form';
import { LoginShowcase } from '@/components/auth/login-showcase';
import { BrandMark } from '@/components/landing/BrandMark';
import { createClient } from '@/lib/supabase/server';
import { getServerI18n } from '@/i18n/server';
import { SignInPage } from '@/components/ui/sign-in-flow-1';

interface LoginPageProps {
  searchParams: Promise<{
    registered?: string;
    error?: string;
    activation_error?: string;
    next?: string;
  }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const supabase = await createClient();
  const { t } = await getServerI18n();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const resolvedSearchParams = await searchParams;

  if (user && !resolvedSearchParams?.error) {
    redirect('/inbox');
  }

  const isRegistered = resolvedSearchParams?.registered === 'true';
  const activationError = resolvedSearchParams?.activation_error === 'invalid_or_expired';

  return (
    <SignInPage className="dark">
      <div className="relative z-10 grid min-h-screen w-full grid-cols-1 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="relative flex min-h-screen flex-col items-center justify-center bg-transparent p-6 backdrop-blur-sm md:p-12 lg:min-h-0 lg:border-r lg:border-white/10">
          <div className="w-full max-w-sm">
            <div className="mb-8 flex items-center justify-between">
              <Link href="/" className="transition-transform hover:scale-[1.02]">
                <BrandMark labelClassName="text-white" />
              </Link>
              <Link
                href="/"
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3.5 py-2 text-sm font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white"
              >
                <ArrowLeft className="h-4 w-4" />
                Voltar
              </Link>
            </div>

            <div className="mb-8 text-left">
              <h1 className="mb-3 text-3xl font-semibold leading-tight tracking-tight text-white md:text-[2rem]">
                {t("Fa\u00e7a login na sua conta!")}
              </h1>
              <p className="max-w-[28rem] text-sm leading-7 text-white/50">
                {t("Insira seu e-mail e senha cadastrados para entrar!")}
              </p>
            </div>

            {isRegistered && (
              <div className="mb-6 animate-in slide-in-from-top-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm font-medium text-emerald-400 fade-in">
                {t("Conta criada com sucesso! Fa\u00e7a login para continuar.")}
              </div>
            )}
            {activationError && (
              <div className="mb-6 animate-in slide-in-from-top-2 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm font-medium text-red-400 fade-in">
                {t("Link de ativação inválido ou expirado. Solicite um novo cadastro ou tente entrar novamente.")}
              </div>
            )}

            <div className="[&_input]:bg-white/5 [&_input]:border-white/10 [&_input]:text-white [&_label]:text-white/70 [&_button[type=submit]]:bg-white [&_button[type=submit]]:text-black [&_button[type=submit]]:hover:bg-white/90 [&_.text-slate-500]:text-white/50 [&_.text-slate-600]:text-white/70 [&_a]:text-white/70 [&_a:hover]:text-white [&_input[type=checkbox]]:border-white/20">
              <LoginForm redirectTo={resolvedSearchParams?.next} />
            </div>

            <p className="mt-8 text-sm text-white/50">
              {t("N\u00e3o tem uma conta?")} {' '}
              <Link href="/register" className="font-semibold text-white transition-colors hover:text-[#20E401] hover:underline hover:underline-offset-4">
                {t("Cadastre-se gratuitamente")}
              </Link>
            </p>
          </div>
        </div>

        <LoginShowcase />
      </div>
    </SignInPage>
  );
}
