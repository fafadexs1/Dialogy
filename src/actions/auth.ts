
'use server';

import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import bcrypt from 'bcryptjs';

// A função de login foi removida pois o fluxo agora é gerenciado
// inteiramente pelo NextAuth e pelo formulário do lado do cliente.
// Manter uma Server Action para isso era redundante e adicionava complexidade.

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

    // A senha é criptografada aqui antes de salvar
    const hashedPassword = await bcrypt.hash(password, 10);
    
    await db.query('INSERT INTO public.users (full_name, email, password_hash) VALUES ($1, $2, $3)', [name, email, hashedPassword]);
    console.log(`[REGISTER_ACTION] Usuário ${email} registrado com sucesso.`);

  } catch(error) {
     console.error('[REGISTER_ACTION] Erro:', error);
     return "Ocorreu um erro durante o registro. Tente novamente.";
  }
  
  // Redireciona para a página de login com um parâmetro de sucesso
  redirect('/login?registered=true');
}

// A ação de signOut foi removida. A lógica agora está no lado do cliente
// (no componente Sidebar) para garantir um redirecionamento correto
// e uma experiência de usuário mais fluida, usando o hook `signOut` do next-auth/react.
