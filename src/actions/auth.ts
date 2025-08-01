'use server';

import { signIn, signOut } from '@/auth';
import { AuthError } from 'next-auth';
import { redirect } from 'next/navigation';

export async function authenticate(
  prevState: string | undefined,
  formData: FormData
) {
  try {
    await signIn('credentials', formData);
  } catch (error) {
    if (error instanceof AuthError) {
      switch (error.type) {
        case 'CredentialsSignin':
          return 'Credenciais inválidas.';
        default:
          return 'Algo deu errado.';
      }
    }
    throw error;
  }
}

export async function register(
  prevState: string | undefined,
  formData: FormData
) {
  // Por enquanto, esta é uma simulação.
  // Em um aplicativo real, você adicionaria o usuário a um banco de dados aqui.
  const name = formData.get('name');
  const email = formData.get('email');
  const password = formData.get('password');

  if (!name || !email || !password) {
    return 'Por favor, preencha todos os campos.';
  }

  console.log('Novo registro:', { name, email });

  // Redireciona para a página de login após o registro "bem-sucedido"
  redirect('/login?registered=true');
}


export async function signOutAction() {
  await signOut();
}
