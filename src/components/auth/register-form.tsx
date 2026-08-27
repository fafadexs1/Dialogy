'use client';

import React, { useState } from 'react';
import { ArrowRight, Eye, EyeOff, Gift, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '../ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useI18n } from '@/i18n/i18n-provider';
import { cn } from '@/lib/utils';

interface RegisterFormProps {
  onRegister: (data: FormData) => void;
  pending: boolean;
  referralCode?: string | null;
  redirectTo?: string | null;
}

const FIELD_CLASS =
  'h-12 rounded-2xl border-slate-200 bg-white px-4 text-sm text-slate-950 placeholder:text-slate-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] focus:border-[#20E401]/35 focus:ring-[#20E401]/10';

const PasswordStrengthIndicator = ({ strength }: { strength: number }) => {
  const { t } = useI18n();
  const strengthLevels = [
    { label: t('Muito fraca'), color: 'bg-red-500', width: '20%' },
    { label: t('Fraca'), color: 'bg-orange-500', width: '40%' },
    { label: t('Media'), color: 'bg-yellow-500', width: '60%' },
    { label: t('Forte'), color: 'bg-green-500', width: '80%' },
    { label: t('Muito forte'), color: 'bg-emerald-600', width: '100%' },
  ];

  const currentLevel = strengthLevels[strength];
  const strengthLabel = currentLevel?.label || t('Invalida');

  return (
    <div className="space-y-1.5">
      <div className="h-1.5 w-full rounded-full bg-slate-200">
        <div
          className={cn('h-1.5 rounded-full transition-all', currentLevel?.color)}
          style={{ width: currentLevel?.width || '0%' }}
        />
      </div>
      <p className="text-xs font-medium text-slate-500">
        {t('Forca da senha: {label}', { label: strengthLabel })}
      </p>
    </div>
  );
};

export function RegisterForm({ onRegister, pending, referralCode, redirectTo }: RegisterFormProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordStrength, setPasswordStrength] = useState(0);
  const [formData, setLocalFormData] = useState({
    name: '',
    lastname: '',
    email: '',
    phone: '',
  });

  const checkPasswordStrength = (pass: string) => {
    let score = 0;
    if (pass.length >= 8) score++;
    if (pass.match(/[a-z]/)) score++;
    if (pass.match(/[A-Z]/)) score++;
    if (pass.match(/[0-9]/)) score++;
    if (pass.match(/[^a-zA-Z0-9]/)) score++;
    setPasswordStrength(Math.max(0, score - 1));
  };

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newPassword = e.target.value;
    setPassword(newPassword);
    checkPasswordStrength(newPassword);
  };

  const handleNext = () => {
    if (!formData.name || !formData.lastname || !formData.email || !formData.phone) {
      toast({
        title: t('Campos obrigatórios'),
        description: t('Por favor, preencha todos os campos para continuar.'),
        variant: 'destructive',
      });
      return;
    }
    setStep(2);
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fullFormData = new FormData(event.currentTarget);
    const pass = fullFormData.get('password') as string;
    const confirmPass = fullFormData.get('confirmPassword') as string;

    if (pass !== confirmPass) {
      toast({
        title: t('As senhas nao coincidem'),
        description: t('Por favor, verifique se as senhas digitadas sao iguais.'),
        variant: 'destructive',
      });
      return;
    }

    onRegister(fullFormData);
  };

  return (
    <div className="space-y-6">
      <div className="mb-2 flex items-center justify-between px-2">
        {[1, 2].map((i) => (
          <div key={i} className="flex items-center gap-2">
            <div
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full border text-[10px] font-bold transition-all',
                step === i
                  ? 'border-[#20E401] bg-[#20E401] text-black shadow-[0_0_15px_rgba(32,228,1,0.3)]'
                  : step > i
                    ? 'border-[#20E401]/30 bg-[#20E401]/15 text-[#20E401]'
                    : 'border-slate-200 bg-white text-slate-400'
              )}
            >
              {step > i ? '✓' : i}
            </div>
            <span
              className={cn(
                'text-[10px] font-bold uppercase tracking-widest',
                step === i ? 'text-slate-950' : 'text-slate-400'
              )}
            >
              {i === 1 ? t('Dados') : t('Segurança')}
            </span>
            {i === 1 && <div className="mx-2 h-px w-12 bg-slate-200" />}
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {referralCode ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4 text-sm text-emerald-900">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-emerald-100 p-2 text-emerald-600">
                <Gift className="h-4 w-4" />
              </div>
              <div className="space-y-1">
                <p className="font-semibold">Indicacao ativa</p>
                <p className="leading-6 text-emerald-800/90">
                  Este cadastro entrou por um link de indicacao. Continue normalmente para criar sua conta e finalizar a configuracao inicial.
                </p>
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-emerald-700">
                  Codigo: {referralCode}
                </p>
              </div>
            </div>
          </div>
        ) : null}

        <input type="hidden" name="referralCode" value={referralCode || ''} />
        <input type="hidden" name="redirectTo" value={redirectTo || ''} />

        {step === 1 && (
          <div className="animate-in space-y-4 fade-in slide-in-from-right-4 duration-300">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name" className="ml-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{t('Nome')}</Label>
                <Input
                  id="name"
                  name="name"
                  type="text"
                  placeholder={t('Nome')}
                  required
                  value={formData.name}
                  onChange={(e) => setLocalFormData({ ...formData, name: e.target.value })}
                  className={FIELD_CLASS}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastname" className="ml-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{t('Sobrenome')}</Label>
                <Input
                  id="lastname"
                  name="lastname"
                  type="text"
                  placeholder={t('Sobrenome')}
                  required
                  value={formData.lastname}
                  onChange={(e) => setLocalFormData({ ...formData, lastname: e.target.value })}
                  className={FIELD_CLASS}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email" className="ml-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{t('E-mail')}</Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder={t('Ex: seu@email.com')}
                required
                value={formData.email}
                onChange={(e) => setLocalFormData({ ...formData, email: e.target.value })}
                className={FIELD_CLASS}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone" className="ml-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{t('WhatsApp')}</Label>
              <Input
                id="phone"
                name="phone"
                type="tel"
                placeholder={t('(00) 00000-0000')}
                required
                value={formData.phone}
                onChange={(e) => setLocalFormData({ ...formData, phone: e.target.value })}
                className={FIELD_CLASS}
              />
            </div>

            <Button
              type="button"
              onClick={handleNext}
              className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 text-sm font-semibold text-white shadow-[0_20px_40px_-24px_rgba(15,23,42,0.48)] transition-colors hover:bg-slate-800"
            >
              {t('Continuar')}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="animate-in space-y-4 fade-in slide-in-from-right-4 duration-300">
            <input type="hidden" name="name" value={formData.name} />
            <input type="hidden" name="lastname" value={formData.lastname} />
            <input type="hidden" name="email" value={formData.email} />
            <input type="hidden" name="phone" value={formData.phone} />

            <div className="space-y-2">
              <Label htmlFor="password" className="ml-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{t('Senha')}</Label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="************"
                  required
                  className={`${FIELD_CLASS} pr-12`}
                  value={password}
                  onChange={handlePasswordChange}
                />
                <button
                  type="button"
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-slate-600"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <PasswordStrengthIndicator strength={passwordStrength} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword" className="ml-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{t('Confirmar Senha')}</Label>
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type={showPassword ? 'text' : 'password'}
                placeholder="************"
                required
                className={FIELD_CLASS}
              />
            </div>

            <div className="flex items-start space-x-3 pt-2">
              <Checkbox id="terms" required className="mt-0.5 border-slate-300 data-[state=checked]:border-[#20E401] data-[state=checked]:bg-[#20E401]" />
              <label htmlFor="terms" className="cursor-pointer text-[11px] font-medium leading-relaxed text-slate-500">
                {t('Li e aceito os termos de uso e política de privacidade.')}
              </label>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep(1)}
                className="h-12 rounded-2xl border-slate-200 bg-white font-semibold text-slate-700 hover:bg-slate-50 hover:text-slate-950"
              >
                {t('Voltar')}
              </Button>
              <Button
                type="submit"
                disabled={pending}
                className="h-12 rounded-2xl bg-slate-950 font-semibold text-white shadow-[0_20px_40px_-24px_rgba(15,23,42,0.48)] transition-colors hover:bg-slate-800"
              >
                {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {pending ? t('Finalizando...') : t('Finalizar')}
              </Button>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
