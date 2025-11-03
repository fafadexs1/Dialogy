import { RegisterForm } from '@/components/auth/register-form';
import Link from 'next/link';
import Image from 'next/image';
import { LifeBuoy } from 'lucide-react';

export default function RegisterPage() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 h-screen">
      {/* Left Side - Form */}
      <div className="bg-card p-8 sm:p-12 flex items-center justify-center order-last md:order-first">
        <div className="w-full max-w-md">
          <div className="mb-6">
            <p className="text-sm text-gray-500">Get started for free</p>
            <h2 className="text-3xl font-bold mt-1">Sign up</h2>
          </div>
          <RegisterForm />
          <div className="mt-6 text-center text-sm">
            <p className="text-muted-foreground">
              Have an account?{' '}
              <Link href="/login" className="font-medium text-[#007BFF] hover:underline">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>

      {/* Right Side - Informational */}
      <div className="bg-[#007BFF] text-white p-8 sm:p-12 flex flex-col justify-between relative overflow-hidden">
        <div className="z-10">
          <div className="flex items-center gap-3 mb-8">
            <LifeBuoy className="h-8 w-8" />
            <h1 className="text-2xl font-bold">Dialogy</h1>
          </div>
          <h2 className="text-4xl font-bold leading-tight">Create your</h2>
          <p className="text-lg text-white/80 mt-1">Account now</p>
        </div>
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
        <p className="text-sm text-white/80 max-w-sm z-10">
          Lorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industry's standard dummy text ever since the 1500s.
        </p>
      </div>
    </div>
  );
}
