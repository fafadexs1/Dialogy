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
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordStrength, setPasswordStrength] = useState(0);

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

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const pass = formData.get('password') as string;
    const confirmPass = formData.get('confirmPassword') as string;

    if (pass !== confirmPass) {
      toast({
        title: t("As senhas nao coincidem"),
        description: t("Por favor, verifique se as senhas digitadas sao iguais."),
        variant: "destructive"
      });
      return;
    }

    onRegister(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="name" className="font-medium text-white/80 text-sm">{t("Nome")} <span className="text-white/30">{t("(obrigatorio)")}</span></Label>
          <Input id="name" name="name" type="text" placeholder={t("Primeiro nome")} required autoComplete="given-name" className="h-12 bg-white/5 border-white/10 rounded-xl px-4 text-white placeholder:text-white/30 focus:border-blue-500 focus:ring-blue-500/20" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lastname" className="font-medium text-white/80 text-sm">{t("Sobrenome")} <span className="text-white/30">{t("(obrigatorio)")}</span></Label>
          <Input id="lastname" name="lastname" type="text" placeholder={t("Sobrenome")} required autoComplete="family-name" className="h-12 bg-white/5 border-white/10 rounded-xl px-4 text-white placeholder:text-white/30 focus:border-blue-500 focus:ring-blue-500/20" />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="email" className="font-medium text-white/80 text-sm">{t("E-mail")} <span className="text-white/30">{t("(obrigatorio)")}</span></Label>
        <Input id="email" name="email" type="email" placeholder={t("Insira seu melhor e-mail")} required autoComplete="email" className="h-12 bg-white/5 border-white/10 rounded-xl px-4 text-white placeholder:text-white/30 focus:border-blue-500 focus:ring-blue-500/20" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="phone" className="font-medium text-white/80 text-sm">{t("Telefone pessoal")} <span className="text-white/30">{t("(obrigatorio)")}</span></Label>
        <Input id="phone" name="phone" type="tel" placeholder={t("Insira o seu numero")} required autoComplete="tel" className="h-12 bg-white/5 border-white/10 rounded-xl px-4 text-white placeholder:text-white/30 focus:border-blue-500 focus:ring-blue-500/20" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password" className="font-medium text-white/80 text-sm">{t("Senha")} <span className="text-white/30">{t("(obrigatorio)")}</span></Label>
        <div className='relative'>
          <Input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            placeholder={t("Crie uma senha forte")}
            required
            autoComplete="new-password"
            className="h-12 bg-white/5 border-white/10 rounded-xl px-4 pr-10 text-white placeholder:text-white/30 focus:border-blue-500 focus:ring-blue-500/20"
            value={password}
            onChange={handlePasswordChange}
          />
          <Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 text-white/40 hover:text-white hover:bg-white/10" onClick={() => setShowPassword(!showPassword)}>
            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </Button>
        </div>
        <PasswordStrengthIndicator strength={passwordStrength} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirmPassword" className="font-medium text-white/80 text-sm">{t("Confirmar senha")} <span className="text-white/30">{t("(obrigatorio)")}</span></Label>
        <div className='relative'>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type={showPassword ? 'text' : 'password'}
            placeholder={t("Repita sua senha")}
            required
            autoComplete="new-password"
            className="h-12 bg-white/5 border-white/10 rounded-xl px-4 pr-10 text-white placeholder:text-white/30 focus:border-blue-500 focus:ring-blue-500/20"
          />
          <Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 text-white/40 hover:text-white hover:bg-white/10" onClick={() => setShowPassword(!showPassword)}>
            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </Button>
        </div>
      </div>
      <div className="flex items-center space-x-2 pt-4">
        <Checkbox id="terms" required className="border-white/20 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600" />
        <label htmlFor="terms" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-white/60">
          {t("Li e aceito os termos de uso da Dialogy.")}{' '}
          <a href="#" className="underline text-blue-400 hover:text-blue-300">{t("Ler termos")}</a>
        </label>
      </div>

      <Button type="submit" className="w-full h-12 text-base bg-blue-600 hover:bg-blue-500 text-white rounded-xl shadow-lg shadow-blue-600/20 transition-all" disabled={pending}>
        {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
        {pending ? t("Criando conta...") : t("Criar conta e entrar")}
      </Button>
    </form>
  );
}
