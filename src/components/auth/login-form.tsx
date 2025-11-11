
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
      <Button type="submit" className="w-full h-12 text-base bg-[#007BFF] hover:bg-[#006ae0] rounded-lg shadow-sm hover:shadow-md transition-all" disabled={pending}>
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {pending ? 'Entrando...' : 'Entrar'}
      </Button>
  )
}

function SocialButton({ provider, icon, label, isIconOnly, children }: { provider: string, icon?: string, label: string, isIconOnly?: boolean, children?: React.ReactNode }) {
    if (isIconOnly) {
        return (
             <Button variant="outline" size="icon" className="h-12 w-12 rounded-lg bg-[#f3f8ff] border-[#ddd] hover:bg-blue-100 flex-shrink-0">
                 {icon ? <Image src={icon} alt={`${provider} logo`} width={24} height={24} /> : children}
            </Button>
        )
    }
    
    return (
         <Button variant="outline" className="w-full flex items-center justify-center gap-2 h-12 bg-[#f3f8ff] border-[#ddd] rounded-lg text-gray-700 font-medium hover:bg-blue-100">
            {icon ? <Image src={icon} alt={`${provider} logo`} width={20} height={20} /> : children}
            {label}
        </Button>
    )
}

export function LoginForm() {
  const [state, formAction] = useActionState(login, { success: false, message: null });
  const router = useRouter();

  useEffect(() => {
    if (state.success) {
      router.push('/inbox');
    }
  }, [state, router]);
  
  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email" className="font-semibold text-gray-600 text-sm">Usuário ou endereço de e-mail</Label>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="Digite seu usuário ou e-mail"
          required
          autoComplete="email"
          className="h-12 bg-white border-[#dcdcdc] rounded-lg px-4 placeholder:text-[#999] focus:border-[#007BFF]"
        />
      </div>
      <div className="space-y-2">
        <div className="flex justify-between items-center">
            <Label htmlFor="password"  className="font-semibold text-gray-600 text-sm">Senha</Label>
             <Link href="#" className="text-xs font-medium text-[#007BFF] hover:underline">
                Esqueceu a senha?
            </Link>
        </div>
        <Input
          id="password"
          name="password"
          type="password"
          placeholder="Digite sua senha"
          required
          autoComplete="current-password"
          className="h-12 bg-white border-[#dcdcdc] rounded-lg px-4 placeholder:text-[#999] focus:border-[#007BFF]"
        />
      </div>
      
      {state?.message && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Erro no Login</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}

      <div className='pt-2'>
        <LoginButton />
      </div>
      
      <div className="relative pt-4">
          <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-gray-200" />
          </div>
          <div className="relative flex justify-center text-xs">
              <span className="bg-card px-2 text-muted-foreground uppercase">Ou continue com</span>
          </div>
      </div>

       <div className="flex items-center gap-4">
            <SocialButton provider="Google" icon="https://www.google.com/images/branding/googleg/1x/googleg_standard_color_28dp.png" label="Entrar com Google" />
            <SocialButton provider="Facebook" label="Facebook" isIconOnly>
                 <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="#1877F2"><path d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.879V14.89h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.989C18.343 21.128 22 16.991 22 12z"></path></svg>
            </SocialButton>
            <SocialButton provider="Apple" label="Apple" isIconOnly>
                 <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M12.152 6.896c-.922 0-1.582.462-2.334 1.385-.922 1.144-1.642 3.013-1.642 5.252 0 3.398 1.432 5.043 2.923 5.043.43 0 1.018-.215 1.851-.645.833-.43 1.55-.71 2.242-.71.723 0 1.41.28 2.153.645.785.43 1.492.678 1.938.678 1.61 0 3.193-1.849 3.193-5.58 0-3.076-.982-4.83-2.153-6.182-1.171-1.353-2.6-2.097-4.21-2.097-.785 0-1.791.312-2.821.312-1.03 0-1.85-.344-2.923-.344zM12.212 2.18c.258 0 .517.032.775.097.194-.033.388-.033.582-.033.785 0 2.21.527 3.355 1.559 1.144 1.033 1.906 2.678 1.906 4.385 0 .28-.032.56-.064.839.032-.032.064-.065.096-.097.032-.032.894-1.032 1.02-1.162a.406.406 0 0 1 .581.033l.032.032c.16.162.16.42.032.613l-1.02 1.162c-.678.775-1.52 1.85-1.52 3.398 0 1.065.388 2.065.982 2.87.563.775 1.171 1.527 2.121 1.527.289 0 .549-.033.775-.097.225.032.483.032.741.032.822 0 2.23-.527 3.376-1.559 1.112-1.032 1.906-2.645 1.906-4.385 0-3.366-2.29-5.075-4.44-5.075-1.41 0-2.82.935-3.832.935-.95 0-2.228-.968-3.64-.968z" clipRule="evenodd"></path></svg>
            </SocialButton>
        </div>

    </form>
  );
}
