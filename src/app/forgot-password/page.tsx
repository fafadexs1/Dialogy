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
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-xl shadow-lg p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.back()} aria-label={t("Voltar")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <p className="text-xs text-muted-foreground">{t("Recuperar acesso")}</p>
            <h1 className="text-xl font-semibold">{t("Esqueci minha senha")}</h1>
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          {t("Informe o e-mail da sua conta. Vamos enviar um link seguro para voce redefinir a senha.")}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="reset-email">{t("E-mail")}</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="reset-email"
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder={t("voce@empresa.com")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{t("Erro ao enviar e-mail")}</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {status === 'sent' && (
            <Alert>
              <AlertTitle>{t("E-mail enviado")}</AlertTitle>
              <AlertDescription>{t("Confira sua caixa de entrada (e o spam) para redefinir sua senha.")}</AlertDescription>
            </Alert>
          )}

          <Button type="submit" className="w-full" disabled={status === 'sending'}>
            {status === 'sending' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {status === 'sending' ? t("Enviando...") : t("Enviar link de redefinicao")}
          </Button>
        </form>

        <div className="text-center text-sm text-muted-foreground">
          <Link href="/login" className="text-[#007BFF] hover:underline">
            {t("Voltar para o login")}
          </Link>
        </div>
      </div>
    </div>
  );
}
