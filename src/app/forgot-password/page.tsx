'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, ArrowLeft, Loader2, Mail } from 'lucide-react';
import { useI18n } from '@/i18n/i18n-provider';
import { StarsBackground } from '@/components/landing/ui/StarsBackground';
import { ShootingStars } from '@/components/landing/ui/ShootingStars';
import Particles from '@/components/landing/ui/Particles';
import { AuthInput } from '@/components/auth/auth-input';

export default function ForgotPasswordPage() {
  const { t } = useI18n();
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) router.replace('/inbox');
    });
  }, [router, supabase]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setStatus('sending');
    setError(null);
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const redirectTo = `${origin}/reset-password`;

    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) {
      setStatus('error');
      setError(error.message);
    } else {
      setStatus('sent');
    }
  };

  return (
    <div className="min-h-screen bg-[#050507] text-gray-100 font-body selection:bg-brand-green/30 selection:text-white flex flex-col items-center justify-center relative overflow-hidden">
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

      <div className="w-full max-w-md relative z-10 px-6 py-12">
        <div className="relative group">
          <div className="absolute -inset-1 bg-gradient-to-r from-[#20E401]/20 via-brand-blue/20 to-brand-purple/20 rounded-2xl blur-lg opacity-50 group-hover:opacity-75 transition duration-1000 group-hover:duration-200"></div>
          <div className="relative bg-[#0B0B10]/95 border border-white/10 rounded-2xl p-8 backdrop-blur-3xl shadow-2xl space-y-8">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.back()}
                className="h-10 w-10 flex items-center justify-center rounded-xl bg-white/5 border border-white/10 text-gray-400 hover:text-white hover:bg-white/10 transition-all group/back"
                aria-label={t("Voltar")}
              >
                <ArrowLeft className="h-5 w-5 transition-transform group-hover/back:-translate-x-0.5" />
              </button>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 mb-1">{t("Recuperar acesso")}</p>
                <h1 className="text-xl font-bold text-white">{t("Esqueci minha senha")}</h1>
              </div>
            </div>

            <p className="text-sm text-gray-400 leading-relaxed">
              {t("Informe o e-mail da sua conta. Vamos enviar um link seguro para voce redefinir a senha.")}
            </p>



            // ... existing code ...

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="reset-email" className="text-xs font-semibold text-gray-300 ml-1">{t("E-mail")}</Label>
                <AuthInput
                  id="reset-email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder={t("voce@empresa.com")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  icon={<Mail className="h-4 w-4" />}
                />
              </div>

              {error && (
                <Alert variant="destructive" className="bg-red-500/10 border-red-500/20 text-red-400 animate-in shake duration-500">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle className="font-bold">{t("Erro ao enviar e-mail")}</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              {status === 'sent' && (
                <Alert className="bg-[#20E401]/10 border-[#20E401]/20 text-[#20E401] animate-in fade-in slide-in-from-top-2">
                  <AlertTitle className="font-bold">{t("E-mail enviado")}</AlertTitle>
                  <AlertDescription>{t("Confira sua caixa de entrada (e o spam) para redefinir sua senha.")}</AlertDescription>
                </Alert>
              )}

              <Button
                type="submit"
                className={`w-full h-11 transition-all duration-300 ${status === 'sending' ? 'bg-zinc-800' : 'bg-white text-black hover:bg-[#20E401] hover:text-black hover:shadow-[0_0_20px_rgba(32,228,1,0.4)]'}`}
                disabled={status === 'sending'}
              >
                {status === 'sending' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <span className="font-bold">
                  {status === 'sending' ? t("Enviando...") : t("Enviar link de redefinicao")}
                </span>
              </Button>
            </form>

            <div className="text-center pt-2">
              <Link href="/login" className="text-sm text-gray-500 hover:text-brand-green transition-colors flex items-center justify-center gap-2 group/login">
                {t("Voltar para o login")}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
