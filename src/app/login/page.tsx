import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { LoginForm } from '@/components/auth/login-form';
import { LoginShowcase } from '@/components/auth/login-showcase';
import { BrandMark } from '@/components/landing/BrandMark';
import { createClient } from '@/lib/supabase/server';
import { getServerI18n } from '@/i18n/server';

interface LoginPageProps {
  searchParams: Promise<{
    registered?: string;
    error?: string;
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

  return (
    <div className="relative flex h-screen items-center justify-center overflow-hidden bg-[#f4f1e8] p-4 font-body text-slate-900 selection:bg-brand-green/20 selection:text-slate-950 md:p-6">
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(25,245,178,0.12),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(58,169,255,0.08),transparent_30%),linear-gradient(180deg,#ffffff_0%,#f4f1e8_68%,#ece7db_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(15,23,42,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.035)_1px,transparent_1px)] bg-[size:36px_36px] opacity-20" />
        <div className="absolute left-[10%] top-[18%] h-56 w-56 rounded-full bg-emerald-200/35 blur-[110px]" />
        <div className="absolute bottom-[12%] right-[12%] h-64 w-64 rounded-full bg-sky-200/30 blur-[120px]" />
      </div>

      <div className="relative z-10 grid max-h-[82vh] w-full max-w-[1120px] grid-cols-1 overflow-hidden rounded-[2rem] border border-black/10 bg-white/80 shadow-[0_50px_140px_-70px_rgba(15,23,42,0.55)] backdrop-blur-2xl lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="relative flex flex-col items-center justify-center overflow-y-auto border-b border-black/5 bg-white/55 p-6 lg:border-b-0 lg:border-r lg:border-black/5 md:p-10 lg:p-12">
          <div className="w-full max-w-sm">
            <div className="mb-8 flex items-center justify-between">
              <Link href="/" className="transition-transform hover:scale-[1.02]">
                <BrandMark />
              </Link>
              <Link
                href="/"
                className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/70 px-3.5 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-white hover:text-slate-950"
              >
                <ArrowLeft className="h-4 w-4" />
                Voltar
              </Link>
            </div>

            <div className="mb-8 text-left">
              <h1 className="mb-3 text-3xl font-semibold leading-tight tracking-tight text-slate-950 md:text-[2rem]">
                {t("Fa\u00e7a login na sua conta!")}
              </h1>
              <p className="max-w-[28rem] text-sm leading-7 text-slate-500">
                {t("Insira seu e-mail e senha cadastrados para entrar!")}
              </p>
            </div>

            {isRegistered && (
              <div className="mb-6 animate-in slide-in-from-top-2 rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4 text-sm font-medium text-emerald-800 fade-in">
                {t("Conta criada com sucesso! Fa\u00e7a login para continuar.")}
              </div>
            )}

            <LoginForm redirectTo={resolvedSearchParams?.next} />

            <p className="mt-8 text-sm text-slate-500">
              {t("N\u00e3o tem uma conta?")} {' '}
              <Link href="/register" className="font-semibold text-slate-950 transition-colors hover:text-[#20E401] hover:underline hover:underline-offset-4">
                {t("Cadastre-se gratuitamente")}
              </Link>
            </p>
          </div>
        </div>

        <LoginShowcase />
      </div>
    </div>
  );
}
