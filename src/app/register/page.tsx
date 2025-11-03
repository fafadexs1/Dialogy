import { RegisterForm } from '@/components/auth/register-form';
import Link from 'next/link';
import Image from 'next/image';

export default function RegisterPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="bg-[#007BFF] text-white p-8 lg:px-24 lg:py-12">
        <div className="flex justify-between items-center">
            <h1 className="text-xl font-bold">Your Logo</h1>
        </div>
        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 items-center">
            <div>
                <h2 className="text-4xl font-bold">Create your</h2>
                <h3 className="text-4xl font-bold text-white/80">Account now</h3>
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
        <div className="w-full">
            <div className="bg-card p-8 rounded-2xl shadow-2xl">
                 <div className="flex justify-between items-center mb-6">
                    <div>
                        <p className="text-muted-foreground">Get started</p>
                        <h2 className="text-3xl font-bold">Sign up</h2>
                    </div>
                    <Link href="/login" className="text-sm text-blue-500 hover:underline">
                        Have an Account? <br/> Sign in
                    </Link>
                </div>
                <RegisterForm />
            </div>
        </div>
        <div>
            {/* Can add content here if needed */}
        </div>
       </main>
    </div>
  );
}
