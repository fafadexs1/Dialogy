'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export async function authenticate(
  prevState: string | undefined,
  formData: FormData
) {
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  const supabase = createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return 'Credenciais inválidas.';
  }

  revalidatePath('/', 'layout');
  redirect('/');
}

export async function register(
  prevState: string | undefined,
  formData: FormData
) {
  const name = formData.get('name') as string;
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  const supabase = createClient();

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: name,
      },
    },
  });

  if (error) {
    if (error.message.includes('User already registered')) {
        return 'Este e-mail já está em uso.';
    }
    return 'Não foi possível concluir o registro. Verifique os dados e tente novamente.';
  }

  redirect('/login?registered=true');
}

export async function signOutAction() {
    const supabase = createClient();
    await supabase.auth.signOut();
    redirect('/login');
}
