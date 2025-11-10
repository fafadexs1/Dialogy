
'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '../ui/checkbox';
import { ArrowRight, Eye, EyeOff } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface RegisterFormProps {
  onContinue: (data: FormData) => void;
  pending: boolean;
}

const PasswordStrengthIndicator = ({ strength }: { strength: number }) => {
  const strengthLevels = [
    { label: 'Muito Fraca', color: 'bg-red-500', width: '20%' },
    { label: 'Fraca', color: 'bg-orange-500', width: '40%' },
    { label: 'Média', color: 'bg-yellow-500', width: '60%' },
    { label: 'Forte', color: 'bg-green-500', width: '80%' },
    { label: 'Muito Forte', color: 'bg-emerald-600', width: '100%' },
  ];

  const currentLevel = strengthLevels[strength];

  return (
    <div className="space-y-1">
      <div className="h-1.5 w-full rounded-full bg-muted">
        <div
          className={cn('h-1.5 rounded-full transition-all', currentLevel?.color)}
          style={{ width: currentLevel?.width || '0%' }}
        />
      </div>
      <p className="text-xs font-medium text-muted-foreground">
        Força da senha: {currentLevel?.label || 'Inválida'}
      </p>
    </div>
  );
};

export function RegisterForm({ onContinue, pending }: RegisterFormProps) {
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
    
    // A simple mapping to fit into 5 levels.
    // Score 0 -> 0, Score 1 -> 0, Score 2 -> 1, Score 3 -> 2, Score 4 -> 3, Score 5 -> 4
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
            title: "As senhas não coincidem",
            description: "Por favor, verifique se as senhas digitadas são iguais.",
            variant: "destructive"
        });
        return;
    }
    
    onContinue(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
            <Label htmlFor="name" className="font-semibold text-gray-700 text-sm">Nome <span className="text-gray-400">(obrigatório)</span></Label>
            <Input
            id="name"
            name="name"
            type="text"
            placeholder="Primeiro nome"
            required
            autoComplete="given-name"
            className="h-12 bg-white border-gray-200 rounded-lg px-4 placeholder:text-gray-400 focus:border-primary"
            />
        </div>
         <div className="space-y-2">
            <Label htmlFor="lastname" className="font-semibold text-gray-700 text-sm">Sobrenome <span className="text-gray-400">(obrigatório)</span></Label>
            <Input
            id="lastname"
            name="lastname"
            type="text"
            placeholder="Sobrenome"
            required
            autoComplete="family-name"
            className="h-12 bg-white border-gray-200 rounded-lg px-4 placeholder:text-gray-400 focus:border-primary"
            />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="email" className="font-semibold text-gray-700 text-sm">E-mail <span className="text-gray-400">(obrigatório)</span></Label>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="Insira seu melhor e-mail"
          required
          autoComplete="email"
          className="h-12 bg-white border-gray-200 rounded-lg px-4 placeholder:text-gray-400 focus:border-primary"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password" className="font-semibold text-gray-700 text-sm">Senha <span className="text-gray-400">(obrigatório)</span></Label>
        <div className='relative'>
             <Input 
                id="password" 
                name="password" 
                type={showPassword ? 'text' : 'password'}
                placeholder="Insira uma palavra-passe"
                required 
                autoComplete="new-password"
                className="h-12 bg-white border-gray-200 rounded-lg px-4 pr-10 placeholder:text-gray-400 focus:border-primary"
                value={password}
                onChange={handlePasswordChange}
            />
            <Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 text-muted-foreground" onClick={() => setShowPassword(!showPassword)}>
                {showPassword ? <EyeOff /> : <Eye />}
            </Button>
        </div>
        <PasswordStrengthIndicator strength={passwordStrength} />
      </div>
        <div className="space-y-2">
            <Label htmlFor="confirmPassword" className="font-semibold text-gray-700 text-sm">Confirmar Senha <span className="text-gray-400">(obrigatório)</span></Label>
            <div className='relative'>
                <Input 
                    id="confirmPassword" 
                    name="confirmPassword" 
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Repita sua senha"
                    required 
                    autoComplete="new-password"
                    className="h-12 bg-white border-gray-200 rounded-lg px-4 pr-10 placeholder:text-gray-400 focus:border-primary"
                />
                 <Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 text-muted-foreground" onClick={() => setShowPassword(!showPassword)}>
                    {showPassword ? <EyeOff /> : <Eye />}
                </Button>
            </div>
        </div>
       <div className="space-y-2">
        <Label htmlFor="phone" className="font-semibold text-gray-700 text-sm">Telefone pessoal <span className="text-gray-400">(obrigatório)</span></Label>
        <Input 
            id="phone" 
            name="phone" 
            type="tel" 
            placeholder="Insira o seu número - não é o número da empresa"
            required 
            autoComplete="tel"
            className="h-12 bg-white border-gray-200 rounded-lg px-4 placeholder:text-gray-400 focus:border-primary"
        />
      </div>
      <div className="flex items-center space-x-2">
        <Checkbox id="terms" required />
        <label
          htmlFor="terms"
          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-gray-600"
        >
          Li e aceito os termos de uso da Dialogy.{' '}
          <a href="#" className="underline text-primary">Ler termos</a>
        </label>
      </div>
      
      <Button type="submit" className="w-full h-12 text-base bg-gray-800 hover:bg-gray-900 rounded-lg shadow-sm transition-all" disabled={pending}>
         <ArrowRight className="mr-2 h-4 w-4" />
         Continuar
      </Button>
    </form>
  );
}
