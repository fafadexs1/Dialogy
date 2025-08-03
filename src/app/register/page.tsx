import { RegisterForm } from '@/components/auth/register-form';
import { LifeBuoy } from 'lucide-react';
import Link from 'next/link';

export default function RegisterPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-secondary p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <LifeBuoy className="h-8 w-8" />
          </div>
          <h1 className="text-3xl font-bold">Dialogy</h1>
          <p className="text-muted-foreground">Crie sua conta</p>
        </div>
        <RegisterForm />
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Já tem uma conta?{' '}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Login
          </Link>
        </p>
      </div>
    </main>
  );
}
