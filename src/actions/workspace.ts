
'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';

export async function createWorkspaceAction(
  prevState: any,
  formData: FormData
): Promise<{ success: boolean; error: string | null }> {
  const cookieStore = cookies();
  const supabase = createClient(cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: 'Usuário não autenticado.' };
  }
  const userId = user.id;
  const workspaceName = formData.get('workspaceName') as string;

  if (!workspaceName) {
    return { success: false, error: 'O nome do workspace é obrigatório.' };
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // 1. Inserir o novo workspace.
    const workspaceRes = await client.query(
      'INSERT INTO workspaces (name, owner_id) VALUES ($1, $2) RETURNING id',
      [workspaceName, userId]
    );
    const newWorkspaceId = workspaceRes.rows[0].id;

    // 2. Criar os papéis (roles) padrão para o novo workspace.
    const adminRoleRes = await client.query(
        `INSERT INTO roles (workspace_id, name, description, is_default) VALUES ($1, 'Administrador', 'Acesso total a todas as funcionalidades e configurações.', FALSE) RETURNING id`,
        [newWorkspaceId]
    );
    // CRIAÇÃO DO PAPEL DE MEMBRO - CORREÇÃO
    await client.query(
        `INSERT INTO roles (workspace_id, name, description, is_default) VALUES ($1, 'Membro', 'Acesso às funcionalidades principais, mas com permissões limitadas.', TRUE)`,
        [newWorkspaceId]
    );
    const adminRoleId = adminRoleRes.rows[0].id;

    // 3. Buscar todas as permissões disponíveis no sistema.
    const permissionsRes = await client.query('SELECT id FROM permissions');
    const permissions = permissionsRes.rows;

    // 4. Atribuir TODAS as permissões ao papel de Administrador recém-criado.
    if (permissions.length > 0) {
      const rolePermissionValues = permissions.map(p => `('${adminRoleId}', '${p.id}')`).join(',');
      await client.query(`INSERT INTO role_permissions (role_id, permission_id) VALUES ${rolePermissionValues}`);
    } else {
      console.warn(`[CREATE_WORKSPACE] Nenhuma permissão encontrada no banco de dados para atribuir ao Administrador.`);
    }

    // 5. Associar o usuário criador ao papel de Administrador.
    await client.query(
      'INSERT INTO user_workspace_roles (user_id, workspace_id, role_id) VALUES ($1, $2, $3)',
      [userId, newWorkspaceId, adminRoleId]
    );

    // 6. Atualizar o workspace ativo do usuário
    await client.query(
        'UPDATE users SET last_active_workspace_id = $1 WHERE id = $2',
        [newWorkspaceId, userId]
    );

    await client.query('COMMIT');
    
    console.log(`[CREATE_WORKSPACE] Workspace "${workspaceName}" (ID: ${newWorkspaceId}) criado, usuário ${userId} definido como Administrador com ${permissions.length} permissões.`);

  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('[CREATE_WORKSPACE] Erro:', error);
    // Retorna a mensagem de erro específica do banco de dados
    return { success: false, error: error.message || 'Ocorreu um erro desconhecido no servidor.' };
  } finally {
    client.release();
  }

  revalidatePath('/', 'layout');
  
  // Return success state instead of redirecting
  return { success: true, error: null };
}


export async function updateWorkspaceAction(
  prevState: any,
  formData: FormData
): Promise<{ success: boolean; error: string | null }> {
    const cookieStore = cookies();
    const supabase = createClient(cookieStore);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return { success: false, error: 'Usuário não autenticado.' };
    }

    const workspaceId = formData.get('workspaceId') as string;
    const workspaceName = formData.get('workspaceName') as string;

    if (!workspaceName) {
        return { success: false, error: 'O nome do workspace é obrigatório.' };
    }
     if (!workspaceId) {
        return { success: false, error: 'ID do workspace não encontrado.' };
    }
    
    // Futuramente: Adicionar verificação de permissão 'workspace:settings:edit'
    
    try {
        await db.query('UPDATE workspaces SET name = $1 WHERE id = $2', [workspaceName, workspaceId]);
        console.log(`[UPDATE_WORKSPACE] Workspace ${workspaceId} atualizado para o nome "${workspaceName}".`);
    } catch (error) {
        console.error('[UPDATE_WORKSPACE] Erro:', error);
        return { success: false, error: "Ocorreu um erro no servidor ao atualizar o workspace." };
    }

    revalidatePath('/', 'layout');
    revalidatePath('/settings/workspace');

    return { success: true, error: null };
}

export async function switchWorkspaceAction(workspaceId: string) {
    const cookieStore = cookies();
    const supabase = createClient(cookieStore);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        console.error('[SWITCH_WORKSPACE] Usuário não autenticado.');
        return;
    }
    const userId = user.id;
    
    try {
        await db.query('UPDATE users SET last_active_workspace_id = $1 WHERE id = $2', [workspaceId, userId]);
        console.log(`[SWITCH_WORKSPACE] Usuário ${userId} trocou para o workspace ${workspaceId}.`);
    } catch (error) {
        console.error('[SWITCH_WORKSPACE] Erro:', error);
    }
    
    revalidatePath('/', 'layout');
}
