'use server';

import { redirect } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { AuthError } from 'next-auth';
import { db } from '@/lib/db';
import bcrypt from 'bcryptjs';

export async function authenticate(
  prevState: string | undefined,
  formData: FormData
) {
 try {
    await signIn('credentials', {
      ...Object.fromEntries(formData),
      redirect: false, 
    });
  } catch (error) {
    // The error object in this case is an instance of AuthError, but because
    // of a Next.js bug, `instanceof AuthError` will return false.
    // We can check the error type directly on the object.
    if ((error as any).type === 'CredentialsSignin') {
        return 'Credenciais inválidas.';
    }
    // If it's not a credentials error, we re-throw it.
    throw error;
  }
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
