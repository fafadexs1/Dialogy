
'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { redirect } from 'next/navigation';

export async function createWorkspaceAction(
  prevState: string | null,
  formData: FormData
): Promise<string | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return 'Usuário não autenticado.';
  }
  const userId = session.user.id;
  const workspaceName = formData.get('workspaceName') as string;

  if (!workspaceName) {
    return 'O nome do workspace é obrigatório.';
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // 1. Inserir o novo workspace
    const workspaceRes = await client.query(
      'INSERT INTO workspaces (name, owner_id) VALUES ($1, $2) RETURNING id',
      [workspaceName, userId]
    );
    const newWorkspaceId = workspaceRes.rows[0].id;

    // O trigger 'add_creator_to_workspace_trigger' já cuida da inserção na tabela 'user_workspaces'.

    // 2. Atualizar o workspace ativo do usuário
    await client.query(
        'UPDATE users SET last_active_workspace_id = $1 WHERE id = $2',
        [newWorkspaceId, userId]
    );

    await client.query('COMMIT');
    
    console.log(`[CREATE_WORKSPACE] Workspace "${workspaceName}" (ID: ${newWorkspaceId}) criado e definido como ativo para o usuário ID: ${userId}.`);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[CREATE_WORKSPACE] Erro:', error);
    return 'Ocorreu um erro no servidor ao criar o workspace.';
  } finally {
    client.release();
  }

  // Revalida os dados para garantir que a UI seja atualizada
  revalidatePath('/', 'layout');
  revalidatePath('/settings/workspace');

  // Retorna nulo em caso de sucesso para o useActionState
  return null;
}


export async function updateWorkspaceAction(
  prevState: string | null,
  formData: FormData
): Promise<string | null> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return 'Usuário não autenticado.';
    }

    const workspaceId = formData.get('workspaceId') as string;
    const workspaceName = formData.get('workspaceName') as string;

    if (!workspaceName) {
        return 'O nome do workspace é obrigatório.';
    }
     if (!workspaceId) {
        return 'ID do workspace não encontrado.';
    }
    
    try {
        await db.query('UPDATE workspaces SET name = $1 WHERE id = $2', [workspaceName, workspaceId]);
        console.log(`[UPDATE_WORKSPACE] Workspace ${workspaceId} atualizado para o nome "${workspaceName}".`);
    } catch (error) {
        console.error('[UPDATE_WORKSPACE] Erro:', error);
        return "Ocorreu um erro no servidor ao atualizar o workspace.";
    }

    revalidatePath('/', 'layout');
    revalidatePath('/settings/workspace');

    return null;
}

export async function switchWorkspaceAction(workspaceId: string) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        console.error('[SWITCH_WORKSPACE] Usuário não autenticado.');
        return;
    }
    const userId = session.user.id;
    
    try {
        await db.query('UPDATE users SET last_active_workspace_id = $1 WHERE id = $2', [workspaceId, userId]);
        console.log(`[SWITCH_WORKSPACE] Usuário ${userId} trocou para o workspace ${workspaceId}.`);
    } catch (error) {
        console.error('[SWITCH_WORKSPACE] Erro:', error);
    }
    
    revalidatePath('/', 'layout');
    // A página será recarregada no cliente para buscar os novos dados
}
