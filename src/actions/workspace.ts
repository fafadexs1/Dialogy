
'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export async function createWorkspaceAction(
  prevState: string | null,
  formData: FormData
): Promise<string | null> {
  const supabase = createClient();

  const workspaceName = formData.get('workspaceName') as string;
  
  // O userId não é mais necessário aqui, pois o gatilho usará auth.uid()
  // const userId = formData.get('userId') as string;

  if (!workspaceName) {
    return 'O nome do workspace é obrigatório.';
  }

  // A lógica agora é mais simples. Apenas inserimos o workspace.
  // O gatilho no banco de dados (`link_creator_to_workspace`)
  // cuidará de adicionar o criador à tabela user_workspaces.
  const { data: workspaceData, error: workspaceError } = await supabase
    .from('workspaces')
    .insert({ name: workspaceName })
    .select()
    .single();

  if (workspaceError || !workspaceData) {
    console.error('Error creating workspace:', workspaceError);
    // Fornecer uma mensagem de erro mais clara para o usuário
    if (workspaceError?.message.includes('violates row-level security policy')) {
        return 'Erro de permissão. Você não tem autorização para criar um workspace.';
    }
    return `Não foi possível criar o workspace: ${workspaceError?.message || 'Erro desconhecido.'}`;
  }

  // A segunda etapa de vincular o usuário foi movida para um gatilho de banco de dados,
  // tornando esta ação mais simples e segura.

  // Revalida a home page para refletir o novo estado e acionar o redirecionamento.
  revalidatePath('/', 'layout');

  return null;
}
