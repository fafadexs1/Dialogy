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

  // Etapa 1: Inserir o novo workspace. A coluna 'owner_id' será preenchida automaticamente
  // pelo valor padrão (auth.uid()) definido no banco de dados.
  // Usamos .select('id').single() para obter o ID do workspace recém-criado.
  const { data: workspaceData, error: workspaceError } = await supabase
    .from('workspaces')
    .insert({ name: workspaceName })
    .select('id')
    .single();

  if (workspaceError || !workspaceData) {
    console.error('Error creating workspace:', workspaceError);
    if (workspaceError?.message.includes('violates row-level security policy')) {
        return 'Erro de permissão. Você não tem autorização para criar um workspace.';
    }
    return `Não foi possível criar o workspace: ${workspaceError?.message || 'Erro desconhecido.'}`;
  }

  // Etapa 2: Vincular o usuário criador ao novo workspace na tabela de junção.
  const { error: linkError } = await supabase
    .from('user_workspaces')
    .insert({ user_id: userId, workspace_id: workspaceData.id });

  if (linkError) {
      console.error('Error linking user to workspace:', linkError);
      // Se a vinculação falhar, é uma boa prática deletar o workspace que ficou órfão.
      await supabase.from('workspaces').delete().eq('id', workspaceData.id);
      return `Workspace não pôde ser criado devido a um erro de vinculação de usuário: ${linkError.message}`;
  }

  // Revalida a home page para refletir o novo estado e acionar o redirecionamento.
  revalidatePath('/', 'layout');

  return null;
}
