
'use server';

import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export async function login(prevState: any, formData: FormData) {
  const cookieStore = cookies();
  const supabase = createClient(cookieStore);

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

  return redirect('/');
}

export async function register(prevState: any, formData: FormData) {
  const cookieStore = cookies();
  const supabase = createClient(cookieStore);

  const name = formData.get('name') as string;
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  
  if (!name || !email || !password) {
    return { success: false, message: "Todos os campos são obrigatórios." };
  }

  // Desabilita a confirmação por e-mail, conforme solicitado.
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${process.env.NEXTAUTH_URL}/`,
      data: {
        full_name: name,
        avatar_url: `https://api.dicebear.com/8.x/initials/svg?seed=${name}`,
      },
    },
  });

  if (error || !data.user) {
    console.error('[REGISTER_ACTION] Erro no Supabase:', error);
    return { success: false, message: error?.message || "Ocorreu um erro durante o registro. Tente novamente."};
  }

  // O trigger do banco de dados (na tabela auth.users) irá copiar o novo usuário
  // para a tabela public.users automaticamente.

  // Redireciona para a página de login com um parâmetro de sucesso
  return redirect('/login?registered=true');
}

export async function signOut() {
  const cookieStore = cookies();
  const supabase = createClient(cookieStore);
  await supabase.auth.signOut();
  return redirect('/login');
}
