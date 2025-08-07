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

  // Com os triggers no banco de dados, só precisamos inserir o nome.
  // O owner_id será definido pelo trigger `set_workspace_owner_trigger`.
  // A vinculação em `user_workspaces` será feita pelo trigger `add_creator_to_workspace_trigger`.
  const { error } = await supabase
    .from('workspaces')
    .insert({ name: workspaceName });

  if (error) {
    console.error('Error creating workspace:', error);
    if (error.code === '42501') { // permission_denied
        return 'Erro de permissão. Você não tem autorização para criar um workspace.';
    }
    return `Não foi possível criar o workspace: ${error.message}`;
  }

  // Revalida a home page para refletir o novo estado e acionar o redirecionamento.
  revalidatePath('/', 'layout');

  return null;
}
