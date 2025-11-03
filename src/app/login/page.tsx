import { LoginForm } from '@/components/auth/login-form';
import { CheckCircle2, LifeBuoy } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: { registered?: string };
}) {
  const isRegistered = searchParams?.registered === 'true';

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center">
      <div className="w-full grid grid-cols-1 md:grid-cols-2 h-screen">
        
        {/* Left Side - Informational */}
        <div className="bg-[#007BFF] text-white p-8 sm:p-12 flex flex-col justify-between relative overflow-hidden">
          <div className="z-10">
            <div className="flex items-center gap-3 mb-8">
                <LifeBuoy className="h-8 w-8"/>
                <h1 className="text-2xl font-bold">Dialogy</h1>
            </div>
            <h2 className="text-4xl font-bold leading-tight">Sign in to</h2>
            <p className="text-lg text-white/80 mt-1">Lorem Ipsum is simply</p>
          </div>
          <p className="text-sm text-white/80 max-w-sm z-10">
            Lorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industry's standard dummy text ever since the 1500s.
          </p>
          <div className="absolute -right-10 top-20 w-64 h-64 opacity-20">
             <Image 
                src="https://picsum.photos/seed/rocket/500/500"
                alt="3D Rocket"
                width={280}
                height={280}
                className="w-full h-full float-animation"
                data-ai-hint="3d illustration rocket"
             />
          </div>
        </div>
        
        {/* Right Side - Form */}
        <div className="bg-card p-8 sm:p-12 flex flex-col justify-center">
            <div className="mb-6">
                <p className="text-sm text-gray-500">
                    Welcome to <span className="font-bold text-[#007BFF]">LOREM</span>
                </p>
                <h2 className="text-3xl font-bold mt-1">Sign in</h2>
            </div>
            
             {isRegistered && (
                <div className="mb-4 flex items-center gap-2 rounded-lg bg-green-500/10 p-3 text-sm font-medium text-green-600">
                    <CheckCircle2 className="h-5 w-5" />
                    <p>Registro realizado com sucesso! Faça o login para continuar.</p>
                </div>
            )}
            
            <LoginForm />

             <div className="mt-6 text-center text-sm">
              <p className="text-muted-foreground">
                No Account?{' '}
                <Link href="/register" className="font-medium text-[#007BFF] hover:underline">
                  Sign up
                </Link>
              </p>
            </div>
        </div>
      </div>
    </div>
  );
}
