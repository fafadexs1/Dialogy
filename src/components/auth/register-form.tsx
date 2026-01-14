'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '../ui/checkbox';
import { ArrowRight, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useI18n } from '@/i18n/i18n-provider';
import { cn } from '@/lib/utils';

interface RegisterFormProps {
  onRegister: (data: FormData) => void;
  pending: boolean;
}

const PasswordStrengthIndicator = ({ strength }: { strength: number }) => {
  const { t } = useI18n();
  const strengthLevels = [
    { label: t("Muito fraca"), color: 'bg-red-500', width: '20%' },
    { label: t("Fraca"), color: 'bg-orange-500', width: '40%' },
    { label: t("Media"), color: 'bg-yellow-500', width: '60%' },
    { label: t("Forte"), color: 'bg-green-500', width: '80%' },
    { label: t("Muito forte"), color: 'bg-emerald-600', width: '100%' },
  ];

  const currentLevel = strengthLevels[strength];
  const strengthLabel = currentLevel?.label || t("Invalida");

  return (
    <div className="space-y-1">
      <div className="h-1.5 w-full rounded-full bg-white/10">
        <div
          className={cn('h-1.5 rounded-full transition-all', currentLevel?.color)}
          style={{ width: currentLevel?.width || '0%' }}
        />
      </div>
      <p className="text-xs font-medium text-white/40">
        {t("Forca da senha: {label}", { label: strengthLabel })}
      </p>
    </div>
  );
};

export function RegisterForm({ onRegister, pending }: RegisterFormProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordStrength, setPasswordStrength] = useState(0);

  // Form states to persist between steps
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
  }

  const handleNext = () => {
    // Basic validation for step 1
    if (!formData.name || !formData.lastname || !formData.email || !formData.phone) {
      toast({
        title: t("Campos obrigatórios"),
        description: t("Por favor, preencha todos os campos para continuar."),
        variant: "destructive"
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
        title: t("As senhas nao coincidem"),
        description: t("Por favor, verifique se as senhas digitadas sao iguais."),
        variant: "destructive"
      });
      return;
    }

    onRegister(fullFormData);
  };

  return (
    <div className="space-y-6">
      {/* Step Indicator */}
      <div className="flex items-center justify-between px-2 mb-2">
        {[1, 2].map((i) => (
          <div key={i} className="flex items-center gap-2">
            <div className={cn(
              "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all border",
              step === i ? "bg-[#20E401] border-[#20E401] text-black shadow-[0_0_15px_rgba(32,228,1,0.3)]" :
                step > i ? "bg-[#20E401]/20 border-[#20E401]/30 text-[#20E401]" : "bg-white/5 border-white/10 text-gray-500"
            )}>
              {step > i ? "✓" : i}
            </div>
            <span className={cn(
              "text-[10px] font-bold uppercase tracking-widest",
              step === i ? "text-[#20E401]" : "text-gray-600"
            )}>
              {i === 1 ? t("Dados") : t("Segurança")}
            </span>
            {i === 1 && <div className="w-12 h-[1px] bg-white/5 mx-2" />}
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {step === 1 && (
          <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name" className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">{t("Nome")}</Label>
                <Input
                  id="name" name="name" type="text" placeholder={t("Nome")} required
                  value={formData.name} onChange={(e) => setLocalFormData({ ...formData, name: e.target.value })}
                  className="h-12 bg-white/5 border-white/10 rounded-xl px-4 text-sm text-white focus:border-[#20E401]/50 focus:ring-[#20E401]/10 transition-all font-medium"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastname" className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">{t("Sobrenome")}</Label>
                <Input
                  id="lastname" name="lastname" type="text" placeholder={t("Sobrenome")} required
                  value={formData.lastname} onChange={(e) => setLocalFormData({ ...formData, lastname: e.target.value })}
                  className="h-12 bg-white/5 border-white/10 rounded-xl px-4 text-sm text-white focus:border-[#20E401]/50 focus:ring-[#20E401]/10 transition-all font-medium"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email" className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">{t("E-mail")}</Label>
              <Input
                id="email" name="email" type="email" placeholder={t("Ex: seu@email.com")} required
                value={formData.email} onChange={(e) => setLocalFormData({ ...formData, email: e.target.value })}
                className="h-12 bg-white/5 border-white/10 rounded-xl px-4 text-sm text-white focus:border-[#20E401]/50 focus:ring-[#20E401]/10 transition-all font-medium"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone" className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">{t("WhatsApp")}</Label>
              <Input
                id="phone" name="phone" type="tel" placeholder={t("(00) 00000-0000")} required
                value={formData.phone} onChange={(e) => setLocalFormData({ ...formData, phone: e.target.value })}
                className="h-12 bg-white/5 border-white/10 rounded-xl px-4 text-sm text-white focus:border-[#20E401]/50 focus:ring-[#20E401]/10 transition-all font-medium"
              />
            </div>
            <Button
              type="button" onClick={handleNext}
              className="w-full h-12 text-sm font-bold bg-white text-black hover:bg-gray-100 rounded-xl transition-all flex items-center justify-center gap-2 group mt-4 shadow-[0_4px_20px_rgba(255,255,255,0.1)]"
            >
              {t("Continuar")}
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
            {/* Hidden fields for Step 1 data so FormData grabs them */}
            <input type="hidden" name="name" value={formData.name} />
            <input type="hidden" name="lastname" value={formData.lastname} />
            <input type="hidden" name="email" value={formData.email} />
            <input type="hidden" name="phone" value={formData.phone} />

            <div className="space-y-2">
              <Label htmlFor="password" className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">{t("Senha")}</Label>
              <div className='relative'>
                <Input
                  id="password" name="password" type={showPassword ? 'text' : 'password'} placeholder="************" required
                  className="h-12 bg-white/5 border-white/10 rounded-xl px-4 pr-12 text-sm text-white focus:border-[#20E401]/50 focus:ring-[#20E401]/10 transition-all font-medium"
                  value={password} onChange={handlePasswordChange}
                />
                <button type="button" className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400" onClick={() => setShowPassword(!showPassword)}>
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <PasswordStrengthIndicator strength={passwordStrength} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword" className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">{t("Confirmar Senha")}</Label>
              <Input
                id="confirmPassword" name="confirmPassword" type={showPassword ? 'text' : 'password'} placeholder="************" required
                className="h-12 bg-white/5 border-white/10 rounded-xl px-4 pr-12 text-sm text-white focus:border-[#20E401]/50 focus:ring-[#20E401]/10 transition-all font-medium"
              />
            </div>

            <div className="flex items-start space-x-3 pt-2">
              <Checkbox id="terms" required className="mt-0.5 border-white/10 data-[state=checked]:bg-[#20E401] data-[state=checked]:border-[#20E401]" />
              <label htmlFor="terms" className="text-[10px] font-medium leading-relaxed text-gray-500 cursor-pointer">
                {t("Li e aceito os termos de uso e política de privacidade.")}
              </label>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-2">
              <Button
                type="button" variant="outline" onClick={() => setStep(1)}
                className="h-12 bg-white/5 border-white/10 text-white hover:bg-white/10 rounded-xl font-bold"
              >
                {t("Voltar")}
              </Button>
              <Button
                type="submit" disabled={pending}
                className="h-12 bg-white text-black hover:bg-gray-100 rounded-xl font-bold shadow-[0_4px_20px_rgba(255,255,255,0.1)] transition-all"
              >
                {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : t("Finalizar")}
              </Button>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
