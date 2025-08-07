'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export async function createWorkspaceAction(
  prevState: string | null,
  formData: FormData
): Promise<string | null> {
  const supabase = createClient();

  const workspaceName = formData.get('workspaceName') as string;

  if (!workspaceName) {
    return 'O nome do workspace é obrigatório.';
  }

  const { data: workspaceData, error: insertError } = await supabase
    .from('workspaces')
    .insert({ name: workspaceName })
    .select('id')
    .single();

  if (insertError) {
    console.error('Error creating workspace:', insertError);
    if (insertError.code === '42501') { 
        return 'Erro de permissão. Você não tem autorização para criar um workspace.';
    }
    return `Não foi possível criar o workspace: ${insertError.message}`;
  }

  // O trigger `add_creator_to_workspace_trigger` já cuida da inserção
  // na tabela `user_workspaces` após a criação do workspace.

  revalidatePath('/', 'layout');
  revalidatePath('/settings/workspace');

  return null;
}


export async function updateWorkspaceAction(
  prevState: string | null,
  formData: FormData
): Promise<string | null> {
    const supabase = createClient();

    const workspaceId = formData.get('workspaceId') as string;
    const workspaceName = formData.get('workspaceName') as string;

    if (!workspaceName) {
        return 'O nome do workspace é obrigatório.';
    }
     if (!workspaceId) {
        return 'ID do workspace não encontrado.';
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return 'Usuário não autenticado.';
    }
    
    const { error } = await supabase
        .from('workspaces')
        .update({ name: workspaceName })
        .eq('id', workspaceId)
        .eq('owner_id', user.id); // Garante que apenas o dono pode alterar

     if (error) {
        console.error('Error updating workspace:', error);
         if (error.code === '42501') { 
            return 'Erro de permissão. Você não tem autorização para alterar este workspace.';
        }
        return `Não foi possível atualizar o workspace: ${error.message}`;
    }

    revalidatePath('/', 'layout');
    revalidatePath('/settings/workspace');

    return null;
}