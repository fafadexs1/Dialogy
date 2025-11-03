
import { RegisterForm } from '@/components/auth/register-form';
import { LifeBuoy } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';

export default function RegisterPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#1E2D4A] to-[#0E1524] p-4">
       <div className="w-full max-w-4xl overflow-hidden rounded-2xl bg-[#1C1C2E] shadow-2xl md:grid md:grid-cols-2">
        
        {/* Coluna da Esquerda: Formulário */}
        <div className="p-8 sm:p-12 text-white">
          <div className="mb-8 flex flex-col items-center text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <LifeBuoy className="h-8 w-8" />
            </div>
            <h1 className="text-3xl font-bold">Crie sua Conta</h1>
            <p className="mt-2 text-sm text-gray-400">Comece a otimizar seu atendimento hoje mesmo.</p>
          </div>

          <RegisterForm />

          <p className="mt-6 text-center text-sm text-gray-400">
            Já tem uma conta?{' '}
            <Link href="/login" className="font-medium text-primary hover:underline">
              Faça login
            </Link>
          </p>
        </div>

        {/* Coluna da Direita: Imagem */}
        <div className="relative hidden md:block">
           <Image
            src="https://picsum.photos/seed/2/800/1000"
            alt="Arte promocional do Dialogy"
            width={800}
            height={1000}
            className="h-full w-full object-cover"
            data-ai-hint="illustration tech"
          />
           <div className="absolute inset-0 bg-gradient-to-t from-[#1C1C2E] via-transparent to-transparent"></div>
        </div>
      </div>
    </main>
  );
}
