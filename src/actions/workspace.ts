
'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

export async function createWorkspaceAction(
  prevState: string | null,
  formData: FormData
): Promise<string | null> {
  const supabase = createClient();

  const workspaceName = formData.get('workspaceName') as string;

  if (!workspaceName) {
    return 'O nome do workspace é obrigatório.';
  }

  // A lógica de owner_id e de associação do usuário agora é tratada por triggers no banco de dados.
  // Basta inserir o nome do workspace.
  const { data: workspaceData, error } = await supabase
    .from('workspaces')
    .insert({ name: workspaceName })
    .select()
    .single();
    
  if (error) {
    console.error('Error creating workspace:', error);
    if (error.code === '42501') { 
        // 42501 é RLS violation
        return 'Erro de permissão. Você não tem autorização para criar um workspace.';
    }
    return `Não foi possível criar o workspace: ${error.message}`;
  }

  // Após criar, define o novo workspace como o ativo
  if (workspaceData) {
      await switchWorkspaceAction(workspaceData.id);
  }

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
    
    // A política RLS garante que apenas o dono pode alterar
    const { error } = await supabase
        .from('workspaces')
        .update({ name: workspaceName })
        .eq('id', workspaceId);
        // A checagem de owner_id é feita pela política de segurança (RLS) no banco

     if (error) {
        console.error('Error updating workspace:', error);
         if (error.code === '42501') { // RLS violation
            return 'Erro de permissão. Você não tem autorização para alterar este workspace.';
        }
        return `Não foi possível atualizar o workspace: ${error.message}`;
    }

    revalidatePath('/', 'layout');
    revalidatePath('/settings/workspace');

    return null;
}

export async function switchWorkspaceAction(workspaceId: string) {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        console.error("User not authenticated");
        return;
    }

    const { error } = await supabase
        .from('users')
        .update({ last_active_workspace_id: workspaceId })
        .eq('id', user.id);

    if (error) {
        console.error("Error switching workspace:", error);
        return;
    }
    
    revalidatePath('/', 'layout');
}
