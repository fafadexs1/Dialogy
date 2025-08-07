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
    // Note: The signIn function from next-auth/react in a server action
    // will trigger a redirect, so the catch block might not be hit
    // in the same way as a direct server-side call.
    // The error handling is kept for cases where it might throw before redirecting.
    await signIn('credentials', {
      ...Object.fromEntries(formData),
      redirect: false, // Important to handle the response manually
    });
    // If signIn doesn't throw, it means success in this context
    // but next-auth handles the redirect logic. We might need to redirect manually if needed.
    // For this form, next-auth middleware will handle the redirect on successful login.
  } catch (error) {
    if (error instanceof AuthError) {
      switch (error.type) {
        case 'CredentialsSignin':
          return 'Credenciais inválidas.';
        default:
          return 'Algo deu errado.';
      }
    }
    // Re-throw other errors to be caught by the framework
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
