
'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export async function createWorkspaceAction(
  prevState: string | null,
  formData: FormData
): Promise<string | null> {
  const supabase = createClient();

  const workspaceName = formData.get('workspaceName') as string;
  const userId = formData.get('userId') as string;

  if (!workspaceName) {
    return 'O nome do workspace é obrigatório.';
  }
  if (!userId) {
    return 'ID do usuário não encontrado. Por favor, tente novamente.'
  }

  // Etapa 1: Inserir o novo workspace
  const { data: workspaceData, error: workspaceError } = await supabase
    .from('workspaces')
    .insert({ name: workspaceName })
    .select()
    .single();

  if (workspaceError || !workspaceData) {
    console.error('Error creating workspace:', workspaceError);
    if (workspaceError?.message.includes('violates row-level security policy')) {
        return 'Erro de permissão. Você não tem autorização para criar um workspace.';
    }
    return `Não foi possível criar o workspace: ${workspaceError?.message || 'Erro desconhecido.'}`;
  }

  // Etapa 2: Vincular o usuário criador ao novo workspace
  const { error: linkError } = await supabase
    .from('user_workspaces')
    .insert({ user_id: userId, workspace_id: workspaceData.id });

  if (linkError) {
      console.error('Error linking user to workspace:', linkError);
      // Opcional: Tentar deletar o workspace criado se o vínculo falhar
      // await supabase.from('workspaces').delete().eq('id', workspaceData.id);
      return `Workspace criado, mas falha ao vincular o usuário: ${linkError.message}`;
  }


  // Revalida a home page para refletir o novo estado e acionar o redirecionamento.
  revalidatePath('/', 'layout');

  return null;
}
