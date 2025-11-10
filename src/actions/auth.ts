
'use server';

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import type { User } from '@/lib/types';
import { db } from '@/lib/db';

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

  const firstName = formData.get('name') as string;
  const lastName = formData.get('lastname') as string;
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  const phone = formData.get('phone') as string;
  
  if (!firstName || !lastName || !email || !password || !phone) {
    return { success: false, message: "Todos os campos são obrigatórios.", user: null };
  }

  const fullName = `${firstName} ${lastName}`;

  // Desabilita a confirmação por e-mail, conforme solicitado.
  // A opção 'data' permite passar metadados que serão usados pelo trigger do DB.
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${process.env.NEXTAUTH_URL}/`, // Mantido para referência futura, mas o e-mail não será enviado.
      data: {
        full_name: fullName,
        avatar_url: `https://api.dicebear.com/8.x/initials/svg?seed=${encodeURIComponent(fullName)}`,
        phone: phone, // Passando o telefone para os metadados
      },
    },
  });

  if (error || !data.user) {
    console.error('[REGISTER_ACTION] Erro no Supabase:', error);
    return { success: false, message: error?.message || "Ocorreu um erro durante o registro. Tente novamente.", user: null };
  }

  // A função on_auth_user_created fará a cópia para a tabela `users`.
  // O trigger foi atualizado para incluir o campo de telefone.
  // Buscamos o usuário recém-criado para confirmar que tudo está correto.
  const newUserQuery = await db.query('SELECT * FROM users WHERE id = $1', [data.user.id]);
  
  if (newUserQuery.rowCount === 0) {
      // Isso pode acontecer se o trigger do DB demorar ou falhar.
      // Adicionamos uma pequena espera e retentativa.
      await new Promise(resolve => setTimeout(resolve, 1000)); // Espera 1s pela replicação
      const retryQuery = await db.query('SELECT * FROM users WHERE id = $1', [data.user.id]);
      if (retryQuery.rowCount === 0) {
        console.error(`[REGISTER_ACTION] Falha ao sincronizar usuário. ID: ${data.user.id}`);
        return { success: false, message: "Database error saving new user", user: null };
      }
      const dbUser = retryQuery.rows[0];
        const userForClient: User = {
        id: dbUser.id,
        name: dbUser.full_name,
        email: dbUser.email,
        avatar: dbUser.avatar_url,
        firstName: dbUser.full_name.split(' ')[0] || '',
        lastName: dbUser.full_name.split(' ').slice(1).join(' ') || '',
        phone: dbUser.phone
      };
      return { success: true, message: null, user: userForClient };
  }
  
  const dbUser = newUserQuery.rows[0];

  const user: User = {
    id: dbUser.id,
    name: dbUser.full_name,
    email: dbUser.email,
    avatar: dbUser.avatar_url,
    firstName: dbUser.full_name.split(' ')[0] || '',
    lastName: dbUser.full_name.split(' ').slice(1).join(' ') || '',
    phone: dbUser.phone
  };

  return { success: true, message: null, user };
}

export async function signOut() {
  const supabase = createClient();
  await supabase.auth.signOut();
  return redirect('/login');
}
