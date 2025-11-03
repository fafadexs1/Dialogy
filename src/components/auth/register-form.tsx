'use client';

import { useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { register } from '@/actions/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, Loader2 } from 'lucide-react';


function RegisterButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" className="w-full h-12 text-base bg-blue-500 hover:bg-blue-600" disabled={pending}>
      {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {pending ? 'Creating Account...' : 'Sign up'}
    </Button>
  );
}

export function RegisterForm() {
  const [state, formAction] = useActionState(register, { success: false, message: null });
  const router = useRouter();

  useEffect(() => {
    if (state.success) {
      router.push('/login?registered=true');
    }
  }, [state.success, router]);


  return (
    <form action={formAction} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="name">Full Name</Label>
        <Input
          id="name"
          name="name"
          type="text"
          placeholder="Your Full Name"
          required
          autoComplete="name"
          className="h-12 bg-gray-100 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700/50 focus:border-blue-500 focus:bg-white"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">Email Address</Label>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="your.email@example.com"
          required
          autoComplete="email"
          className="h-12 bg-gray-100 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700/50 focus:border-blue-500 focus:bg-white"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input 
            id="password" 
            name="password" 
            type="password" 
            placeholder="Create a password"
            required 
            autoComplete="new-password"
            className="h-12 bg-gray-100 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700/50 focus:border-blue-500 focus:bg-white"
        />
      </div>
      {state?.message && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Registration Error</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}

      <RegisterButton />
    </form>
  );
}
