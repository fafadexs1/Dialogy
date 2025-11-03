'use client';

import { useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, Loader2 } from 'lucide-react';
import { login } from '@/actions/auth';
import Link from 'next/link';
import Image from 'next/image';

function LoginButton() {
  const { pending } = useFormStatus();
  return (
      <Button type="submit" className="w-full h-12 text-base bg-blue-500 hover:bg-blue-600" disabled={pending}>
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {pending ? 'Signing in...' : 'Sign in'}
      </Button>
  )
}

function SocialButton({ provider, icon, label }: { provider: string, icon: string, label: string }) {
    return (
        <Button variant="outline" className="w-full flex items-center justify-center gap-2 h-12">
            <Image src={icon} alt={`${provider} logo`} width={20} height={20} />
            {label}
        </Button>
    )
}

export function LoginForm() {
  const [state, formAction] = useActionState(login, { success: false, message: null });
  const router = useRouter();

  useEffect(() => {
    if (state.success) {
      window.location.href = '/';
    }
  }, [state, router]);
  
  return (
    <form action={formAction} className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-1">
                 <SocialButton provider="Google" icon="https://www.google.com/images/branding/googleg/1x/googleg_standard_color_28dp.png" label="Google" />
            </div>
            <div className="flex items-center gap-2 sm:col-span-2">
                 <Button variant="outline" className="w-full flex items-center justify-center gap-2 h-12">
                    <svg className="h-5 w-5 text-blue-600" fill="currentColor" viewBox="0 0 24 24"><path d="M22.08 12.52v-1.04c0-5.84-4.72-10.56-10.56-10.56S.96 5.64.96 11.48c0 4.96 3.4 9.16 8 10.24V15.2h-2.4v-3.6h2.4v-2.64c0-2.36 1.4-3.68 3.56-3.68 1.04 0 1.92.08 2.2.12v3.12h-1.84c-1.16 0-1.36.56-1.36 1.32v1.76h3.48l-.44 3.6h-3.04v6.4c5.16-1.12 9-5.72 9-11.12z" /></svg>
                    Facebook
                 </Button>
                 <Button variant="outline" className="w-full flex items-center justify-center gap-2 h-12">
                     <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12.012 2.508c-4.14 0-6.84 3.28-6.84 7.06 0 2.24 1.02 4.54 2.86 5.76-1.52.48-3.32 1-4.74 1.84-.4.24-.48.72-.28 1.08.16.28.52.4.84.28 1.52-.88 3.24-1.48 4.76-1.72.6.44 1.28.8 2.04.92V22.2c0 .44.36.8.8.8s.8-.36.8-.8v-4.48c.76-.12 1.44-.48 2.04-.92 1.52.24 3.24.84 4.76 1.72.32.12.68 0 .84-.28.2-.36.12-.84-.28-1.08-1.42-.84-3.22-1.36-4.74-1.84 1.84-1.22 2.86-3.52 2.86-5.76 0-3.78-2.7-7.06-6.84-7.06zm-4.48 5.7c-.56 0-1.02-.46-1.02-1.02s.46-1.02 1.02-1.02 1.02.46 1.02 1.02-.46 1.02-1.02 1.02zm8.98 0c-.56 0-1.02-.46-1.02-1.02s.46-1.02 1.02-1.02 1.02.46 1.02 1.02-.46 1.02-1.02 1.02z"/></svg>
                    Apple
                 </Button>
            </div>
        </div>

      <div className="space-y-2">
        <Label htmlFor="email">Enter your username or email address</Label>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="Username or email address"
          required
          autoComplete="email"
          className="h-12 bg-gray-100 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700/50 focus:border-blue-500 focus:bg-white"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Enter your Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          placeholder="Password"
          required
          autoComplete="current-password"
          className="h-12 bg-gray-100 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700/50 focus:border-blue-500 focus:bg-white"
        />
      </div>

       <div className="text-right text-sm">
        <Link href="#" className="font-medium text-blue-500 hover:underline">
          Forgot Password
        </Link>
      </div>
      
      {state?.message && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Login Error</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}

      <LoginButton />

    </form>
  );
}
