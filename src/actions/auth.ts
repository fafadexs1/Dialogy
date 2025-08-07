
'use server';

import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { signOut } from 'next-auth/react';
import { auth, handler as nextAuthHandler } from '@/app/api/auth/[...nextauth]/route';


// This function is no longer used for login, but we keep it as a reference or for other purposes.
// The login flow is now handled client-side in login-form.tsx to correctly use next-auth/react.
export async function authenticate(
  prevState: string | undefined,
  formData: FormData
) {
  // This is a placeholder. The actual logic is now in the client component.
  // We keep the shell to avoid breaking anything that might still reference it,
  // but it should ideally be removed if not used elsewhere.
  return 'This action is deprecated. Login is handled client-side.';
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
    
    await db.query('INSERT INTO public.users (full_name, email, password_hash) VALUES ($1, $2, $3)', [name, email, hashedPassword]);

  } catch(error) {
     console.error(error);
     return "Ocorreu um erro durante o registro. Tente novamente.";
  }
  
  redirect('/login?registered=true');
}

export async function signOutAction() {
    // Correctly sign out by redirecting to the NextAuth signout API endpoint.
    // This endpoint handles cookie clearing and session termination securely.
    redirect('/api/auth/signout');
}
