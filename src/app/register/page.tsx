'use client';

import { useState } from 'react';
import { RegisterForm } from '@/components/auth/register-form';
import Link from 'next/link';
import Image from 'next/image';
import { LifeBuoy } from 'lucide-react';
import OnboardingSteps from './onboarding-steps';
import type { User } from '@/lib/types';

export default function RegisterPage() {
  const [user, setUser] = useState<User | null>(null);

  if (user) {
    return <OnboardingSteps user={user} />;
  }

  return (
    <div className="h-screen w-full flex items-center justify-center bg-gray-100 p-6">
      <main className="w-full max-w-6xl grid md:grid-cols-2 shadow-2xl rounded-3xl overflow-hidden">
        <div className="bg-card p-8 sm:p-12 flex flex-col justify-center">
          <div className="w-full max-w-md mx-auto">
            <div className="mb-6">
              <h2 className="text-3xl font-bold mt-1">Crie sua conta</h2>
              <p className="text-sm text-gray-500 mt-1">
                Comece a usar o Dialogy gratuitamente.
              </p>
            </div>
            <RegisterForm onRegisterSuccess={setUser} />
            <div className="mt-6 text-center text-sm">
              <p className="text-muted-foreground">
                Já tem uma conta?{' '}
                <Link
                  href="/login"
                  className="font-medium text-[#007BFF] hover:underline"
                >
                  Faça o login
                </Link>
              </p>
            </div>
          </div>
        </div>
        <div className="bg-[#007BFF] text-white p-8 sm:p-12 flex flex-col justify-between relative order-first md:order-last">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-600 to-indigo-800 opacity-80"></div>
          <div className="z-10">
            <div className="flex items-center gap-3 mb-8">
              <LifeBuoy className="h-8 w-8" />
              <h1 className="text-2xl font-bold">Dialogy</h1>
            </div>
            <h2 className="text-4xl font-bold leading-tight drop-shadow-md">
              A plataforma completa para seu atendimento
            </h2>
            <p className="text-lg text-white/80 mt-2 max-w-sm">
              Conecte-se com seus clientes de forma inteligente e automatizada.
            </p>
          </div>
          <div className="absolute right-0 bottom-0 w-80 h-80 opacity-20">
            <Image
              src="https://picsum.photos/seed/rocket/500/500"
              alt="3D Illustration"
              width={320}
              height={320}
              className="w-full h-full float-animation"
              data-ai-hint="3d illustration rocket"
            />
          </div>
          <p className="text-sm text-white/80 max-w-sm z-10">
            Gerencie conversas, automatize respostas com IA e organize seu CRM
            em um só lugar.
          </p>
        </div>
      </main>
    </div>
  );
}
