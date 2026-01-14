'use client';

import { useEffect, useState, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, Loader2, Mail, Lock } from 'lucide-react';
import { login } from '@/actions/auth';
import { useI18n } from '@/i18n/i18n-provider';
import Link from 'next/link';
import Image from 'next/image';

function LoginButton() {
  const { t } = useI18n();
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      className="w-full h-12 text-sm font-bold bg-white text-black hover:bg-gray-100 rounded-xl shadow-[0_0_20px_rgba(255,255,255,0.1)] transition-all transform hover:-translate-y-0.5 active:scale-95"
      disabled={pending}
    >
      {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {pending ? t("Entrando...") : t("Entrar")}
    </Button>
  )
}

function SocialButton({ provider, icon, label, isIconOnly, children }: { provider: string, icon?: string, label: string, isIconOnly?: boolean, children?: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <Button
      variant="outline"
      className="flex-1 h-16 bg-white/5 border-white/10 rounded-2xl hover:bg-white/10 hover:border-white/20 transition-all group flex flex-col items-center justify-center p-2 gap-1"
    >
      {icon ? (
        <Image
          src={icon}
          alt={provider}
          width={20}
          height={20}
          className="opacity-70 group-hover:opacity-100 transition-opacity"
        />
      ) : (
        <div className="opacity-70 group-hover:opacity-100 transition-opacity">
          {children}
        </div>
      )}
      {/* Label is usually omitted in the card style unless it's the primary one, but I'll follow the mockup's smaller grid */}
    </Button>
  )
}

export function LoginForm({ redirectTo }: { redirectTo?: string }) {
  const { t } = useI18n();
  const [state, formAction] = useActionState(login as any, { success: false, message: '' });
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);

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
    } else {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('rememberMe');
        localStorage.removeItem('rememberEmail');
      }
    }
  };

  return (
    <form action={formAction} onSubmit={handleRemember} className="space-y-4">
      <input type="hidden" name="redirectTo" value={redirectTo || ''} />

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email" className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">{t("Email")}</Label>
          <div className="relative group">
            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-600 group-focus-within:text-[#20E401] transition-colors" />
            <Input
              id="email"
              name="email"
              type="email"
              placeholder={t("ex: seu-email@exemplo.com")}
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12 bg-white/5 border-white/10 rounded-xl pl-12 pr-4 text-sm text-white placeholder:text-gray-700 focus:border-[#20E401]/50 focus:ring-[#20E401]/10 transition-all"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="password" className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">{t("Senha")}</Label>
          <div className="relative group">
            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-600 group-focus-within:text-[#20E401] transition-colors" />
            <Input
              id="password"
              name="password"
              type="password"
              placeholder="************"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-12 bg-white/5 border-white/10 rounded-xl pl-12 pr-12 text-sm text-white placeholder:text-gray-700 focus:border-[#20E401]/50 focus:ring-[#20E401]/10 transition-all"
            />
            <button type="button" className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400 transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between px-1">
        <label className="flex items-center gap-2 cursor-pointer group">
          <input
            id="remember-me"
            name="remember-me"
            type="checkbox"
            className="h-4 w-4 rounded border-white/10 bg-white/5 text-[#20E401] focus:ring-2 focus:ring-[#20E401]/20 cursor-pointer"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
          />
          <span className="text-xs text-gray-500 group-hover:text-gray-400 transition-colors leading-none">{t("Lembrar de mim")}</span>
        </label>
        <Link href="/forgot-password" className="text-xs font-bold text-brand-blue hover:text-[#20E401] transition-colors">
          {t("Esqueceu a senha?")}
        </Link>
      </div>

      {state?.message && (
        <Alert variant="destructive" className="bg-red-500/10 border-red-500/20 text-red-400 py-3">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-xs font-medium">{state.message}</AlertDescription>
        </Alert>
      )}

      <div className='pt-2'>
        <LoginButton />
      </div>



    </form>
  );
}
