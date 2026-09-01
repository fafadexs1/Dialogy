'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2, Lock, Mail } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { login } from '@/actions/auth';
import { useI18n } from '@/i18n/i18n-provider';

function LoginButton() {
  const { t } = useI18n();
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className="h-12 w-full rounded-xl bg-[#087f5b] text-sm font-semibold text-white shadow-[0_3px_6px_-3px_rgba(6,95,70,0.3)] transition-colors hover:bg-[#066648] disabled:cursor-not-allowed disabled:opacity-70"
      disabled={pending}
    >
      {pending && <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />}
      {pending ? t("Entrando...") : t("Entrar na minha conta")}
      {!pending && <ArrowRight className="ml-2 inline h-4 w-4" />}
    </button>
  );
}

export function LoginForm({ redirectTo }: { redirectTo?: string }) {
  const { t } = useI18n();
  const [state, formAction] = useActionState(login as any, { success: false, message: '' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    const savedRemember = typeof window !== 'undefined' && localStorage.getItem('rememberMe') === 'true';
    const savedEmail = typeof window !== 'undefined' ? localStorage.getItem('rememberEmail') || '' : '';
    if (savedRemember) {
      setRememberMe(true);
      setEmail(savedEmail);
    }
  }, []);

  const handleRemember = () => {
    if (rememberMe) {
      if (typeof window !== 'undefined') {
        localStorage.setItem('rememberMe', 'true');
        localStorage.setItem('rememberEmail', email);
      }
    } else if (typeof window !== 'undefined') {
      localStorage.removeItem('rememberMe');
      localStorage.removeItem('rememberEmail');
    }
  };

  return (
    <form action={formAction} onSubmit={handleRemember} className="space-y-5">
      <input type="hidden" name="redirectTo" value={redirectTo || ''} />

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email" className="text-[12px] font-medium text-slate-700">
            {t("Email")}
          </Label>
          <div className="group relative">
            <Mail className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-emerald-600" />
            <Input
              id="email"
              name="email"
              type="email"
              placeholder={t("voce@empresa.com")}
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12 rounded-xl border-slate-200 bg-white pl-12 pr-4 text-base sm:text-sm text-slate-950 placeholder:text-slate-400 transition-colors hover:border-slate-300 focus-visible:border-emerald-500 focus-visible:ring-emerald-500/15 focus-visible:ring-offset-0"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="password" className="text-[12px] font-medium text-slate-700">
            {t("Senha")}
          </Label>
          <div className="group relative">
            <Lock className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-emerald-600" />
            <Input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              placeholder="************"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-12 rounded-xl border-slate-200 bg-white pl-12 pr-12 text-base sm:text-sm text-slate-950 placeholder:text-slate-400 transition-colors hover:border-slate-300 focus-visible:border-emerald-500 focus-visible:ring-emerald-500/15 focus-visible:ring-offset-0"
            />
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              aria-label={showPassword ? t("Ocultar senha") : t("Mostrar senha")}
              aria-pressed={showPassword}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-slate-600"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between px-1 pt-1">
        <label className="group flex cursor-pointer items-center gap-2">
          <input
            id="remember-me"
            name="remember-me"
            type="checkbox"
            className="h-4 w-4 cursor-pointer rounded border-black/10 bg-white accent-emerald-600 focus:ring-2 focus:ring-emerald-500/20"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
          />
          <span className="text-[13px] leading-none text-slate-500 transition-colors group-hover:text-slate-700">{t("Lembrar de mim")}</span>
        </label>
        <Link href="/forgot-password" className="text-[13px] font-medium text-slate-600 transition-colors hover:text-slate-950">
          {t("Esqueceu a senha?")}
        </Link>
      </div>

      {state?.message && (
        <Alert className="rounded-xl border-red-200 bg-red-50 py-3 text-red-700">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-sm font-medium">{state.message}</AlertDescription>
        </Alert>
      )}

      <div className="pt-2">
        <LoginButton />
      </div>
    </form>
  );
}
