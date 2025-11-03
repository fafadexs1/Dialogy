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
      <Button type="submit" className="w-full h-12 text-base bg-[#007BFF] hover:bg-[#006ae0] rounded-lg shadow-md hover:shadow-lg transition-all" disabled={pending}>
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {pending ? 'Signing in...' : 'Sign in'}
      </Button>
  )
}

function SocialButton({ provider, icon, label, isIconOnly }: { provider: string, icon: string, label: string, isIconOnly?: boolean }) {
    if (isIconOnly) {
        return (
             <Button variant="outline" size="icon" className="h-12 w-12 rounded-full bg-[#f3f8ff] border-[#ddd] hover:bg-blue-100 flex-shrink-0">
                 <Image src={icon} alt={`${provider} logo`} width={24} height={24} />
            </Button>
        )
    }
    
    return (
         <Button variant="outline" className="w-full flex items-center justify-center gap-2 h-12 bg-[#f3f8ff] border-[#ddd] rounded-lg text-gray-700 font-medium hover:bg-blue-100">
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
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email" className="font-semibold text-gray-600">Username or email address</Label>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="Enter your username or email"
          required
          autoComplete="email"
          className="h-12 bg-white border-[#dcdcdc] rounded-lg px-4 placeholder:text-[#999] focus:border-[#007BFF]"
        />
      </div>
      <div className="space-y-2">
        <div className="flex justify-between items-center">
            <Label htmlFor="password"  className="font-semibold text-gray-600">Password</Label>
             <Link href="#" className="text-xs font-medium text-[#007BFF] hover:underline">
                Forgot Password?
            </Link>
        </div>
        <Input
          id="password"
          name="password"
          type="password"
          placeholder="Enter your password"
          required
          autoComplete="current-password"
          className="h-12 bg-white border-[#dcdcdc] rounded-lg px-4 placeholder:text-[#999] focus:border-[#007BFF]"
        />
      </div>
      
      {state?.message && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Login Error</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}

      <LoginButton />
      
      <div className="relative my-4">
          <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-gray-300" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
          </div>
      </div>

       <div className="flex items-center gap-4">
            <SocialButton provider="Google" icon="https://www.google.com/images/branding/googleg/1x/googleg_standard_color_28dp.png" label="Sign in with Google" />
            <SocialButton provider="Facebook" icon="https://picsum.photos/seed/fb/24" label="Facebook" isIconOnly />
            <SocialButton provider="Apple" icon="https://picsum.photos/seed/apple/24" label="Apple" isIconOnly />
        </div>

    </form>
  );
}
