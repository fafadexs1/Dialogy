import { LoginForm } from '@/components/auth/login-form';
import { LifeBuoy } from 'lucide-react';

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-secondary p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <LifeBuoy className="h-8 w-8" />
          </div>
          <h1 className="text-3xl font-bold">ConnectISP</h1>
          <p className="text-muted-foreground">Bem-vindo de volta</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
