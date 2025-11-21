
'use server';

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import type { User } from '@/lib/types';
import { db } from '@/lib/db';

export async function login(prevState: any, formData: FormData) {
  const supabase = await createClient();

  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  const redirectTo = formData.get('redirectTo') as string;

  if (error) {
    console.error('[LOGIN_ACTION] Erro:', error);
    return { success: false, message: 'Credenciais inválidas. Verifique seu e-mail e senha.' };
  }

  // Redirecionamento é crucial para o middleware atualizar a sessão.
  if (redirectTo && redirectTo.startsWith('/')) {
      return redirect(redirectTo);
  }
  return redirect('/inbox');
}

export async function register(prevState: any, formData: FormData): Promise<{ success: boolean; message: string | null; user: User | null }> {
    const supabase = await createClient();
    
    const firstName = formData.get('name') as string;
    const lastName = formData.get('lastname') as string;
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;
    const phone = formData.get('phone') as string;

    if (!firstName || !lastName || !email || !password || !phone) {
        return { success: false, message: "Todos os campos são obrigatórios.", user: null };
    }

    const fullName = `${firstName} ${lastName}`;

    try {
        // This will create the user in `auth.users` and our trigger `handle_new_user` will create them in `public.users`
        const { data, error: authError } = await supabase.auth.signUp({
            email,
            password,
            options: {
                // emailRedirectTo is not needed if we are not requiring email verification
                data: {
                    full_name: fullName,
                    avatar_url: `https://api.dicebear.com/8.x/initials/svg?seed=${encodeURIComponent(fullName)}`,
                    phone: phone,
                },
            },
        });

        if (authError) {
            console.error('[REGISTER_ACTION] Erro no Supabase Auth:', authError);
            if (authError.message.includes('User already registered') || authError.message.includes('users_email_key')) {
                throw new Error("Este e-mail já está em uso. Por favor, tente fazer login ou use um e-mail diferente.");
            }
            throw authError;
        }
        
        if (!data.user) {
            throw new Error("Falha ao receber os dados do usuário da autenticação.");
        }
        
        // On success, simply return a success state. The client will handle the redirect.
        return { success: true, message: null, user: data.user as User };

    } catch (error: any) {
        console.error('[REGISTER_ACTION] Erro no registro:', error);
        return { success: false, message: error.message || "Ocorreu um erro durante o registro.", user: null };
    }
}


export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return redirect('/login');
}
