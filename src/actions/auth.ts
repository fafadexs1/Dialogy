'use server';

import { redirect } from 'next/navigation';

export async function authenticate(
  prevState: string | undefined,
  formData: FormData
) {
  // Mock authentication - redirect to home on any attempt
  redirect('/');
}

export async function register(
  prevState: string | undefined,
  formData: FormData
) {
  // Mock registration - redirect to login with a success message
  redirect('/login?registered=true');
}

export async function signOutAction() {
    // Mock sign out - redirect to login
    redirect('/login');
}
