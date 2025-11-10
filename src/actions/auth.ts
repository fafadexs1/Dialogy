
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

export async function register(prevState: any, formData: FormData): Promise<{ success: boolean; message: string | null; user: User | null }> {
    const supabase = createClient();
    const client = await db.connect();

    const firstName = formData.get('name') as string;
    const lastName = formData.get('lastname') as string;
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;
    const phone = formData.get('phone') as string;
    const workspaceName = formData.get('workspaceName') as string;

    if (!firstName || !lastName || !email || !password || !phone || !workspaceName) {
        return { success: false, message: "Todos os campos são obrigatórios.", user: null };
    }

    const fullName = `${firstName} ${lastName}`;

    try {
        await client.query('BEGIN');

        // 1. Create Supabase Auth user
        const { data, error: authError } = await supabase.auth.signUp({
            email,
            password,
            options: {
                emailRedirectTo: `${process.env.NEXTAUTH_URL}/`,
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
                throw new Error("Este e-mail já está em uso. Por favor, tente fazer login ou use um e-mail diferente.");
            }
            throw authError;
        }
        
        if (!data.user) {
            throw new Error("Falha ao receber os dados do usuário da autenticação.");
        }
        
        const newUserId = data.user.id;

        // The on_auth_user_created trigger will run here, creating the entry in public.users

        // 2. Create Workspace and associate user
        const workspaceRes = await client.query(
            'INSERT INTO workspaces (name, owner_id) VALUES ($1, $2) RETURNING id',
            [workspaceName, newUserId]
        );
        const newWorkspaceId = workspaceRes.rows[0].id;
        
        // 3. Create default roles for the new workspace
        const adminRoleRes = await client.query(
            `INSERT INTO roles (workspace_id, name, description, is_default) VALUES ($1, 'Administrador', 'Acesso total a todas as funcionalidades e configurações.', FALSE) RETURNING id`,
            [newWorkspaceId]
        );
        await client.query(
            `INSERT INTO roles (workspace_id, name, description, is_default) VALUES ($1, 'Membro', 'Acesso às funcionalidades principais, mas com permissões limitadas.', TRUE)`,
            [newWorkspaceId]
        );
        const adminRoleId = adminRoleRes.rows[0].id;
        
        // 4. Assign all permissions to the admin role
        const permissionsRes = await client.query('SELECT id::text FROM permissions');
        if (permissionsRes.rows.length > 0) {
            const rolePermissionValues = permissionsRes.rows.map(p => `('${adminRoleId}', '${p.id}')`).join(',');
            await client.query(`INSERT INTO role_permissions (role_id, permission_id) VALUES ${rolePermissionValues}`);
        }

        // 5. Associate the creator with the admin role for this workspace
        await client.query(
            'INSERT INTO user_workspace_roles (user_id, workspace_id, role_id) VALUES ($1, $2, $3)',
            [newUserId, newWorkspaceId, adminRoleId]
        );

        // 6. Set this as the user's active workspace
        await client.query(
            'UPDATE users SET last_active_workspace_id = $1 WHERE id = $2',
            [newWorkspaceId, newUserId]
        );

        // 7. Commit transaction
        await client.query('COMMIT');
        
        // 8. Fetch the final user object to return to client
        const finalUserQuery = await db.query('SELECT * FROM users WHERE id = $1', [newUserId]);
        const dbUser = finalUserQuery.rows[0];

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

    } catch (error: any) {
        await client.query('ROLLBACK');
        console.error('[REGISTER_ACTION] Erro na transação de registro:', error);
        return { success: false, message: error.message || "Ocorreu um erro durante o registro.", user: null };
    } finally {
        client.release();
    }
}


export async function signOut() {
  const supabase = createClient();
  await supabase.auth.signOut();
  return redirect('/login');
}
