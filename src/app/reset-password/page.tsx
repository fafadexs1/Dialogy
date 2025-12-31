'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, CheckCircle2, Loader2, Lock } from 'lucide-react';
import { useI18n } from '@/i18n/i18n-provider';

export default function ResetPasswordPage() {
  const { t } = useI18n();
  const router = useRouter();
  const supabase = createClient();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        setError(t("Link invalido ou expirado. Solicite um novo e-mail de redefinicao."));
      }
    });
  }, [supabase]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError(t("As senhas precisam ser iguais."));
      return;
    }
    setStatus('submitting');
    setError(null);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setStatus('error');
      setError(error.message);
    } else {
      setStatus('success');
      setTimeout(() => router.push('/login'), 1500);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-xl shadow-lg p-6 space-y-6">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
            <Lock className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("Definir nova senha")}</p>
            <h1 className="text-xl font-semibold">{t("Crie uma senha forte")}</h1>
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          {t("Escolha uma nova senha para continuar usando sua conta.")}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">{t("Nova senha")}</Label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder={t("Minimo 8 caracteres")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">{t("Confirmar nova senha")}</Label>
            <Input
              id="confirm-password"
              name="confirm-password"
              type="password"
              required
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{t("Erro ao redefinir")}</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {status === 'success' && (
            <Alert>
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <AlertTitle>{t("Senha atualizada")}</AlertTitle>
              <AlertDescription>{t("Redirecionando para o login...")}</AlertDescription>
            </Alert>
          )}

          <Button type="submit" className="w-full" disabled={status === 'submitting'}>
            {status === 'submitting' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {status === 'submitting' ? t("Salvando...") : t("Salvar nova senha")}
          </Button>
        </form>
      </div>
    </div>
  );
}
