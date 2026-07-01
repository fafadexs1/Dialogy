'use server';

import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { withDebug } from '@/lib/observability/logger';
import { applyReferralToUser } from '@/lib/referrals-server';
import { redirect } from 'next/navigation';
import type { User } from '@/lib/types';
import { headers } from 'next/headers';
import { getLoginErrorMessage } from '@/lib/auth/login-errors';

export const login = withDebug(
  'login',
  async function login(prevState: any, formData: FormData) {
    const supabase = await createClient();

    const email = formData.get('email') as string;
    const password = formData.get('password') as string;

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    const redirectTo = formData.get('redirectTo') as string;

    if (error) {
      console.error('[LOGIN_ACTION] Erro:', error);
      return { success: false, message: getLoginErrorMessage(error.code, error.message) };
    }

    // if (redirectTo && redirectTo.startsWith('/')) {
    //   return redirect(redirectTo);
    // }
    return redirect('/inbox');
  },
  {
    contextResolver: (_prevState, formData) => ({
      payload: { email: formData.get('email') || null },
    }),
  }
);

export const register = withDebug(
  'register',
  async function register(
    prevState: any,
    formData: FormData
  ): Promise<{ success: boolean; message: string | null; user: User | null; requiresEmailConfirmation: boolean }> {
    const supabase = await createClient();

    const firstName = formData.get('name') as string;
    const lastName = formData.get('lastname') as string;
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;
    const phone = formData.get('phone') as string;
    const referralCode = formData.get('referralCode') as string | null;

    if (!firstName || !lastName || !email || !password || !phone) {
      return { success: false, message: "Todos os campos sao obrigatorios.", user: null, requiresEmailConfirmation: false };
    }

    const fullName = `${firstName} ${lastName}`;

    try {
      // This will create the user in `auth.users` and our trigger `handle_new_user` will create them in `public.users`
      const { data, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${(await headers()).get('origin') || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/auth/confirm?next=/inbox`,
          data: {
            full_name: fullName,
            avatar_url: `https://api.dicebear.com/8.x/initials/svg?seed=${encodeURIComponent(fullName)}`,
            phone: phone,
          },
        },
      });

      if (authError) {
        console.error('[REGISTER_ACTION] Erro no Supabase Auth:', authError);
        if (authError.message.includes('User already registered') || authError.message.includes('users_email_key')) {
          throw new Error("Este e-mail ja esta em uso. Por favor, tente fazer login ou use um e-mail diferente.");
        }
        throw authError;
      }

      if (!data.user) {
        throw new Error("Falha ao receber os dados do usuario da autenticacao.");
      }

      await db.query(
        `
          INSERT INTO users (id, full_name, email, avatar_url, phone)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (id) DO UPDATE
          SET
            full_name = COALESCE(users.full_name, EXCLUDED.full_name),
            email = COALESCE(users.email, EXCLUDED.email),
            avatar_url = COALESCE(users.avatar_url, EXCLUDED.avatar_url),
            phone = COALESCE(users.phone, EXCLUDED.phone),
            updated_at = NOW()
        `,
        [
          data.user.id,
          fullName,
          data.user.email,
          data.user.user_metadata?.avatar_url || `https://api.dicebear.com/8.x/initials/svg?seed=${encodeURIComponent(fullName)}`,
          phone,
        ]
      );

      await applyReferralToUser(data.user.id, referralCode);

      // On success, simply return a success state. The client will handle the redirect.
      const user: User = {
        id: data.user.id,
        email: data.user.email,
        name: fullName,
        firstName: firstName,
        lastName: lastName,
        avatar_url: data.user.user_metadata?.avatar_url || `https://api.dicebear.com/8.x/initials/svg?seed=${encodeURIComponent(fullName)}`,
        phone: phone
      };

      // On success, simply return a success state. The client will handle the redirect.
      const requiresEmailConfirmation = !data.session;
      return {
        success: true,
        message: requiresEmailConfirmation
          ? 'Enviamos um link de ativação para seu e-mail. Abra o link para liberar a conta.'
          : null,
        user,
        requiresEmailConfirmation,
      };
    } catch (error: any) {
      console.error('[REGISTER_ACTION] Erro no registro:', error);
      return {
        success: false,
        message: error.message || "Ocorreu um erro durante o registro.",
        user: null,
        requiresEmailConfirmation: false,
      };
    }
  },
  {
    contextResolver: (_prevState, formData) => ({
      payload: { email: formData.get('email') || null },
    }),
  }
);

export const signOut = withDebug('sign_out', async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return redirect('/login');
});
