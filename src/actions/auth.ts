'use server';

import { signIn, signOut } from '@/auth';
import prisma from '@/lib/db';
import { AuthError } from 'next-auth';
import { redirect } from 'next/navigation';
import bcrypt from 'bcrypt';

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
          return 'Algo deu errado. Tente novamente.';
      }
    }
    throw error;
  }
  // Adicionado para garantir o redirecionamento após o login
  redirect('/');
}

export async function register(
  prevState: string | undefined,
  formData: FormData
) {
  try {
    const name = formData.get('name') as string;
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;

    if (!name || !email || !password) {
      return 'Por favor, preencha todos os campos.';
    }

    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return 'Este e-mail já está em uso.';
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
      },
    });
  } catch (error) {
    console.error(error);
    return 'Não foi possível concluir o registro. Tente novamente.';
  }

  redirect('/login?registered=true');
}

export async function signOutAction() {
  await signOut();
}
