'use server';

import { redirect } from 'next/navigation';
import { signIn } from '@/app/api/auth/[...nextauth]/route';
import { AuthError } from 'next-auth';
import { db } from '@/lib/db';
import bcrypt from 'bcryptjs';

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
  try {
    const name = formData.get('name') as string;
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;

    if (!name || !email || !password) {
        return "Todos os campos são obrigatórios.";
    }

    const existingUser = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
        return "Este e-mail já está em uso.";
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    
    await db.query('INSERT INTO users (full_name, email, password_hash) VALUES ($1, $2, $3)', [name, email, hashedPassword]);

  } catch(error) {
     console.error(error);
     return "Ocorreu um erro durante o registro. Tente novamente.";
  }
  
  redirect('/login?registered=true');
}

export async function signOutAction() {
    // Mock sign out - redirect to login
    redirect('/login');
}
