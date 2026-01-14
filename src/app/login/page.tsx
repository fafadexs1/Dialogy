import Image from 'next/image';
import { LoginForm } from '@/components/auth/login-form';
import { LoginShowcase } from '@/components/auth/login-showcase';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getServerI18n } from '@/i18n/server';
import { StarsBackground } from '@/components/landing/ui/StarsBackground';
import { ShootingStars } from '@/components/landing/ui/ShootingStars';
import Particles from '@/components/landing/ui/Particles';

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

  // Prevent redirect loop: Only redirect if there is NO error
  if (user && !resolvedSearchParams?.error) {
    redirect('/inbox');
  }
  const isRegistered = resolvedSearchParams?.registered === 'true';

  return (
    <div className="h-screen bg-[#050507] text-gray-100 font-body selection:bg-brand-green/30 selection:text-white relative overflow-hidden flex items-center justify-center p-4 md:p-6">
      {/* Background Effects */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <StarsBackground />
        <ShootingStars />
        <Particles
          className="absolute inset-0"
          quantity={80}
          ease={80}
          color="#20E401"
          refresh
        />
      </div>

      {/* Main Container - Split Screen */}
      <div className="w-full max-w-4xl max-h-[80vh] grid grid-cols-1 lg:grid-cols-2 bg-[#0B0B10]/40 backdrop-blur-2xl border border-white/10 rounded-[2rem] shadow-2xl relative z-10 overflow-hidden">

        {/* Left Side: Login Form */}
        <div className="flex flex-col items-center justify-center p-6 md:p-10 lg:p-12 relative overflow-y-auto">
          <div className="w-full max-w-sm">
            <div className="text-center mb-6">
              <Link href="/" className="inline-flex items-center gap-2 mb-4 group transition-transform hover:scale-105">
                <img src="/logo.png" alt="Dialogy" className="h-7 md:h-8 w-auto object-contain" />
              </Link>

              {/* Mockup styled icon above heading */}
              <div className="flex justify-center mb-4">
                <div className="w-12 h-12 rounded-xl bg-[#20E401]/10 border border-[#20E401]/20 flex items-center justify-center shadow-[0_0_30px_rgba(32,228,1,0.1)]">
                  <div className="w-6 h-6 text-[#20E401]">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><polyline points="10 17 15 12 10 7" /><line x1="15" y1="12" x2="3" y2="12" /></svg>
                  </div>
                </div>
              </div>

              <h1 className="text-2xl md:text-3xl font-bold mb-2 tracking-tight text-white leading-tight">
                {t("Faça login na sua conta!")}
              </h1>
              <p className="text-gray-400 text-xs md:text-sm leading-relaxed">
                {t("Insira seu e-mail e senha cadastrados para entrar!")}
              </p>
            </div>

            {isRegistered && (
              <div className="mb-6 p-4 rounded-xl bg-green-500/10 border border-green-500/20 text-green-400 text-xs text-center font-medium animate-in fade-in slide-in-from-top-2">
                {t("Conta criada com sucesso! Faça login para continuar.")}
              </div>
            )}

            <LoginForm redirectTo={resolvedSearchParams?.next} />

            <p className="text-center mt-6 text-xs text-gray-500">
              {t("Não tem uma conta?")} {' '}
              <Link href="/register" className="text-[#20E401] hover:text-white font-semibold transition-colors decoration-[#20E401]/30 underline-offset-4 hover:underline">
                {t("Cadastre-se gratuitamente")}
              </Link>
            </p>
          </div>
        </div>

        {/* Right Side: Showcase */}
        <LoginShowcase />
      </div>
    </div>
  );
}
