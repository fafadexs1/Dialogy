import { LoginForm } from '@/components/auth/login-form';
import { CheckCircle2, X } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

const recentUsers = [
  { name: 'John Peter', avatar: 'https://picsum.photos/seed/10/40/40', active: '1 days ago' },
  { name: 'Alina Shmen', avatar: 'https://picsum.photos/seed/11/40/40', active: '4 days ago' },
];

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: { registered?: string };
}) {
  const isRegistered = searchParams?.registered === 'true';

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="bg-[#007BFF] text-white p-8 lg:px-24 lg:py-12">
        <div className="flex justify-between items-center">
            <h1 className="text-xl font-bold">Your Logo</h1>
        </div>
        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 items-center">
            <div>
                <h2 className="text-4xl font-bold">Sign in to</h2>
                <h3 className="text-4xl font-bold text-white/80">Lorem Ipsum is simply</h3>
                <p className="mt-4 max-w-md text-white/90">
                    Lorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industry's standard dummy text ever since the 1500s.
                </p>
            </div>
             <div className="relative h-64 md:h-auto">
                <Image 
                    src="https://picsum.photos/seed/rocket/500/300"
                    alt="Illustration of a person on a rocket"
                    width={500}
                    height={300}
                    className="absolute right-0 bottom-0 md:-bottom-12"
                    data-ai-hint="3d illustration rocket"
                />
            </div>
        </div>
      </header>

      <main className="px-8 lg:px-24 -mt-20 md:-mt-28 relative z-10 grid grid-cols-1 md:grid-cols-2 gap-12">
        {/* Login como */}
        <div className="pt-12 md:pt-0">
            <h3 className="text-lg font-semibold mb-4">Login as</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-2 gap-4">
                {recentUsers.map(user => (
                    <div key={user.name} className="relative group bg-card p-4 rounded-2xl text-center shadow-lg hover:shadow-xl transition-shadow cursor-pointer">
                        <button className="absolute top-2 right-2 p-1 rounded-full bg-muted/50 group-hover:bg-muted transition-colors">
                            <X className="h-3 w-3" />
                        </button>
                        <Avatar className="h-16 w-16 mx-auto mb-3">
                            <AvatarImage src={user.avatar} alt={user.name} />
                            <AvatarFallback>{user.name.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <p className="font-semibold">{user.name}</p>
                        <p className="text-xs text-muted-foreground">Active {user.active}</p>
                    </div>
                ))}
            </div>
        </div>

        {/* Formulário de Login */}
        <div className="w-full">
            <div className="bg-card p-8 rounded-2xl shadow-2xl">
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <p className="text-muted-foreground">Welcome to LOREM</p>
                        <h2 className="text-3xl font-bold">Sign in</h2>
                    </div>
                    <Link href="/register" className="text-sm text-blue-500 hover:underline">
                        No Account? <br/> Sign up
                    </Link>
                </div>
                 {isRegistered && (
                    <div className="mb-4 flex items-center gap-2 rounded-lg bg-green-500/10 p-3 text-sm font-medium text-green-600">
                        <CheckCircle2 className="h-5 w-5" />
                        <p>Registro realizado com sucesso! Faça o login para continuar.</p>
                    </div>
                )}
                <LoginForm />
            </div>
        </div>
      </main>
    </div>
  );
}
