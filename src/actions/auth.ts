'use server';

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import type { User } from '@/lib/types';

export async function login(prevState: any, formData: FormData) {
  const supabase = createClient();

  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    console.error('[LOGIN_ACTION] Erro:', error);
    return { success: false, message: 'Credenciais inválidas. Verifique seu e-mail e senha.' };
  }

  // Em vez de redirecionar, retorna um estado de sucesso.
  // O redirecionamento será tratado no lado do cliente.
  return { success: true, message: null };
}

export async function register(prevState: any, formData: FormData): Promise<{ success: boolean; message: string | null, user: User | null }> {
  const supabase = createClient();

  const name = formData.get('name') as string;
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  
  if (!name || !email || !password) {
    return { success: false, message: "Todos os campos são obrigatórios.", user: null };
  }

  // Desabilita a confirmação por e-mail, conforme solicitado.
  // A opção 'data' permite passar metadados que serão usados pelo trigger do DB.
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${process.env.NEXTAUTH_URL}/`, // Mantido para referência futura, mas o e-mail não será enviado.
      data: {
        full_name: name,
        avatar_url: `https://api.dicebear.com/8.x/initials/svg?seed=${encodeURIComponent(name)}`,
      },
    },
  });

  if (error || !data.user) {
    console.error('[REGISTER_ACTION] Erro no Supabase:', error);
    return { success: false, message: error?.message || "Ocorreu um erro durante o registro. Tente novamente.", user: null };
  }

  // The database trigger (`on_auth_user_created`) will automatically copy the new user
  // to the `public.users` table. We can now return the user object.
  const user: User = {
    id: data.user.id,
    name: data.user.user_metadata.full_name,
    email: data.user.email,
    avatar: data.user.user_metadata.avatar_url,
    firstName: data.user.user_metadata.full_name.split(' ')[0] || '',
    lastName: data.user.user_metadata.full_name.split(' ').slice(1).join(' ') || '',
  };

  return { success: true, message: null, user };
}

export async function signOut() {
  const supabase = createClient();
  await supabase.auth.signOut();
  return redirect('/login');
}
